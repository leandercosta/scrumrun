"use strict";

// `scrumrun repair [--apply|--dry-run]`
//
// Applies safe, mechanical normalizations to a v2 project that has drifted
// through hand-writing outside the CLI. Only touches categories where the
// fix is provably deterministic and does not invent data:
//
//   1. task.feature: kebab-case slug that does not resolve to a FEAT-NNN → null.
//      (broken reference; safer to nullify than to fabricate.)
//   2. task.status alias mapping: done→completed, todo→backlog,
//      complete→completed, in_progress→executing.
//   3. frontmatter method field: any value that isn't "2.0.0" → "2.0.0".
//   4. run.attempt missing → 1 (documented default).
//
// Categories intentionally NOT touched (need human judgment):
//   - Secret-like content (SECRET_CANONICAL)
//   - Missing Acceptance Criteria sections
//   - Guardrail scope/enforcement (authored semantics)
//   - Task/Run status disagreements (requires domain knowledge)
//   - Empty Run ledgers (use `sc plan run --normalize-legacy`)
//
// Every mutated file is backed up byte-exact under
// `.scrumrun/.migration-backup/repair/<relative-path>` before being rewritten.

const fs = require("node:fs");
const path = require("node:path");

const { normalizeLegacyRuns } = require("./normalize-legacy");
const { SECRET_PATTERNS } = require("../security/secrets");

const TASK_FILE = /^TASK-\d{3,}\.md$/;
const RUN_FILE = /^RUN-\d{3,}\.md$/;
const FEAT_FILE = /^FEAT-\d{3,}\.md$/;
const SPRINT_FILE = /^SPRINT-\d{3,}\.md$/;
const MEMORY_FILE = /^(K|DEC|INS|DOS)-\d{3,}\.md$/;
const TASK_REF = /^TASK-\d{3,}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FEAT_REF = /^FEAT-\d{3,}$/;
const SLUG_REF = /^[a-z0-9][a-z0-9-]*$/;

// Aligned with lib/v2/schema.js ARTIFACT_TYPES.
const VALID_TASK_STATUS = new Set(["backlog", "proposed", "running", "validating", "learning", "partial", "completed", "failed", "blocked", "cancelled"]);
const VALID_RUN_STATUS = new Set(["executing", "validating", "learning", "partial", "completed", "failed", "blocked"]);

const TASK_STATUS_ALIAS = {
  done: "completed",
  todo: "backlog",
  complete: "completed",
  in_progress: "running",
  executing: "running",   // Task uses "running", Run uses "executing"
  active: "running"
};

const RUN_STATUS_ALIAS = {
  complete: "completed",
  in_progress: "executing",
  done: "completed",
  partial: "failed"
};

// When syncing Task.status from latest Run.status, translate Run vocabulary
// to Task vocabulary (Run "executing" → Task "running", etc.).
const RUN_TO_TASK_STATUS = {
  executing: "running",
  validating: "validating",
  learning: "learning",
  partial: "partial",
  completed: "completed",
  failed: "failed",
  blocked: "blocked"
};

const GUARDRAIL_SCOPES = new Set(["all", "intake", "execution", "mutation", "canonical", "memory", "migration", "validation", "learning", "completion", "commit", "release", "logs"]);
const CANONICAL_DIRS = ["tasks", "runs", "features", "sprints", "reviews", "memory/knowledge", "memory/decisions", "memory/insights", "memory/dossiers"];

function readIf(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function listDir(dir, pattern) {
  if (!fs.existsSync(dir) || !fs.lstatSync(dir).isDirectory()) return [];
  return fs.readdirSync(dir).filter((name) => pattern.test(name)).sort().map((name) => path.join(dir, name));
}

function splitFrontmatter(text) {
  const match = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n)?([\s\S]*)$/);
  if (!match) return null;
  return { header: match[1], sep: match[2] || "\n", body: match[3] || "" };
}

function extractField(header, field) {
  const re = new RegExp(`^${field}:\\s*(.*)$`, "im");
  const match = header.match(re);
  return match ? match[1].trim() : undefined;
}

function replaceField(header, field, newValue) {
  const re = new RegExp(`^(${field}:\\s*)(.*)$`, "im");
  return header.replace(re, `$1${newValue}`);
}

function hasField(header, field) {
  const re = new RegExp(`^${field}:\\s`, "im");
  return re.test(header);
}

function insertFieldAfter(header, afterField, field, value) {
  const re = new RegExp(`^(${afterField}:.*)$`, "im");
  return header.replace(re, `$1\n${field}: ${value}`);
}

function scanFeatureIds(scrumDir) {
  const dir = path.join(scrumDir, "features");
  const ids = new Set();
  for (const file of listDir(dir, FEAT_FILE)) {
    ids.add(path.basename(file, ".md"));
  }
  return ids;
}

function scanTaskIds(scrumDir) {
  const dir = path.join(scrumDir, "tasks");
  const ids = new Set();
  for (const file of listDir(dir, TASK_FILE)) {
    ids.add(path.basename(file, ".md"));
  }
  return ids;
}

function legacyMetadata(body) {
  const metadata = {};
  const section = String(body || "").match(/^## Metadata\s*$([\s\S]*?)(?=^##\s+|(?![\s\S]))/im);
  if (!section) return metadata;
  for (const line of section[1].split(/\r?\n/)) {
    const match = line.match(/^\s*-\s*([a-z][a-z0-9_]*)\s*:\s*(.*?)\s*$/i);
    if (match) metadata[match[1].toLowerCase()] = match[2];
  }
  return metadata;
}

function canonicalKind(relative) {
  if (/^tasks\/TASK-\d{3,}\.md$/.test(relative)) return "task";
  if (/^runs\/RUN-\d{3,}\.md$/.test(relative)) return "run";
  if (/^features\/FEAT-\d{3,}\.md$/.test(relative)) return "feature";
  if (/^sprints\/SPRINT-\d{3,}\.md$/.test(relative)) return "sprint";
  if (/^reviews\/REV-\d{3,}\.md$/.test(relative)) return "review";
  if (/^memory\/knowledge\/K-\d{3,}\.md$/.test(relative)) return "knowledge";
  if (/^memory\/decisions\/DEC-\d{3,}\.md$/.test(relative)) return "decision";
  if (/^memory\/insights\/INS-\d{3,}\.md$/.test(relative)) return "insight";
  if (/^memory\/dossiers\/DOS-\d{3,}\.md$/.test(relative)) return "dossier";
  return null;
}

function legacyStatus(kind, value) {
  const raw = String(value || "").trim().toLowerCase();
  const aliases = kind === "task" ? TASK_STATUS_ALIAS : kind === "run" ? RUN_STATUS_ALIAS : {};
  const normalized = aliases[raw] || raw;
  const valid = {
    feature: ["backlog", "proposed", "active", "completed", "paused", "cancelled"],
    task: [...VALID_TASK_STATUS],
    sprint: ["proposed", "running", "partial", "completed", "blocked", "cancelled"],
    run: [...VALID_RUN_STATUS],
    review: ["proposed", "running", "passed", "failed", "archived"],
    knowledge: ["candidate", "approved", "rejected", "deprecated", "invalidated"],
    decision: ["open", "resolved", "deprecated", "invalidated"],
    insight: ["candidate", "confirmed", "stale", "deprecated", "invalidated"],
    dossier: ["active", "stale", "deprecated", "archived"]
  }[kind] || [];
  if (valid.includes(normalized)) return normalized;
  return { feature: "proposed", task: "proposed", sprint: "proposed", run: "partial", review: "proposed", knowledge: "candidate", decision: "open", insight: "candidate", dossier: "active" }[kind];
}

function planMissingFrontmatter(scrumDir) {
  const entries = [];
  for (const directory of CANONICAL_DIRS) {
    const absolute = path.join(scrumDir, directory);
    if (!fs.existsSync(absolute) || !fs.lstatSync(absolute).isDirectory()) continue;
    for (const file of fs.readdirSync(absolute).sort().map((name) => path.join(absolute, name))) {
      if (!fs.lstatSync(file).isFile()) continue;
      const relative = path.relative(scrumDir, file).split(path.sep).join("/");
      const kind = canonicalKind(relative);
      if (!kind) continue;
      const original = readIf(file);
      if (original === null || splitFrontmatter(original)) continue;
      const metadata = legacyMetadata(original);
      const id = path.basename(file, ".md");
      const statDate = new Date(fs.statSync(file).mtimeMs).toISOString().slice(0, 10);
      const created = ISO_DATE.test(metadata.created || "") ? metadata.created : statDate;
      const updated = ISO_DATE.test(metadata.updated || "") ? metadata.updated : created;
      const task = kind === "run" ? (TASK_REF.test(metadata.task || "") ? metadata.task : ((original.match(/\b(TASK-\d{3,})\b/) || [])[1] || null)) : null;
      const featureValue = metadata.feature || metadata.scope || null;
      const feature = FEAT_REF.test(featureValue || "") ? featureValue : null;
      const sprint = /^SPRINT-\d{3,}$/.test(metadata.sprint || "") ? metadata.sprint : null;
      const record = { id, kind, status: legacyStatus(kind, metadata.status), created, updated, method: "2.0.0" };
      if (kind === "task") Object.assign(record, { type: metadata.type || "task", feature, sprint });
      if (kind === "run") Object.assign(record, { task, sprint, attempt: Number(metadata.attempt) > 0 ? Number(metadata.attempt) : 1, ledger: 1 });
      if (kind === "feature") record.type = "initiative";
      if (kind === "decision" && feature) record.feature = feature;
      const frontmatter = Object.entries(record).map(([key, value]) => `${key}: ${value === null ? "null" : value}`).join("\n");
      const acceptance = kind === "task" && !/^## Acceptance Criteria\b/m.test(original)
        ? "\n\n## Acceptance Criteria\n\n- Preserved from legacy migration. Define what done means before re-approaching this work.\n"
        : "";
      entries.push({ file, kind: "legacy-frontmatter", changes: [{ field: "frontmatter", from: "missing", to: `${kind} schema` }], nextText: `---\n${frontmatter}\n---\n\n${original}${acceptance}`, originalText: original });
    }
  }
  return entries;
}

function planStatusSync(scrumDir) {
  // For each Task with Runs, align Task.status with the latest Run's status
  // (by highest attempt number, then created date). Legacy Tasks hand-marked
  // "completed" while the latest Run is "partial" are the common shape.
  const runsByTask = new Map();
  for (const file of listDir(path.join(scrumDir, "runs"), RUN_FILE)) {
    const raw = readIf(file);
    if (raw === null) continue;
    const split = splitFrontmatter(raw);
    if (!split) continue;
    const taskRef = extractField(split.header, "task");
    if (!taskRef || !TASK_REF.test(taskRef)) continue;
    const rawStatus = extractField(split.header, "status");
    const status = RUN_STATUS_ALIAS[rawStatus] || rawStatus;
    const attempt = Number(extractField(split.header, "attempt") || 1);
    const created = extractField(split.header, "created") || "";
    const list = runsByTask.get(taskRef) || [];
    list.push({ file, status, attempt, created });
    runsByTask.set(taskRef, list);
  }
  const VALID_TASK_STATUS = new Set(["backlog", "approved", "executing", "completed", "failed", "blocked"]);
  const entries = [];
  for (const file of listDir(path.join(scrumDir, "tasks"), TASK_FILE)) {
    const raw = readIf(file);
    if (raw === null) continue;
    const split = splitFrontmatter(raw);
    if (!split) continue;
    const taskId = extractField(split.header, "id");
    if (!taskId) continue;
    const taskStatus = extractField(split.header, "status");
    const runs = runsByTask.get(taskId) || [];
    if (!runs.length) continue;
    runs.sort((a, b) => (a.attempt - b.attempt) || a.created.localeCompare(b.created));
    const latestRun = runs[runs.length - 1];
    if (!latestRun.status) continue;
    const targetStatus = RUN_TO_TASK_STATUS[latestRun.status] || latestRun.status;
    if (taskStatus === targetStatus) continue;
    if (!VALID_TASK_STATUS.has(targetStatus)) continue;
    const next = replaceField(split.header, "status", targetStatus);
    if (next === split.header) continue;
    const nextText = `---\n${next}\n---${split.sep}${split.body}`;
    entries.push({ file, kind: "task-status-sync", changes: [{ field: "status", from: taskStatus, to: latestRun.status }], nextText, originalText: raw });
  }
  return entries;
}

function planAttemptResequence(scrumDir) {
  // Renumber duplicate Run attempt numbers within a Task. Sort by created
  // ascending, then reassign 1..N. Preserves history order without inventing.
  const runsByTask = new Map();
  for (const file of listDir(path.join(scrumDir, "runs"), RUN_FILE)) {
    const raw = readIf(file);
    if (raw === null) continue;
    const split = splitFrontmatter(raw);
    if (!split) continue;
    const taskRef = extractField(split.header, "task");
    if (!taskRef || !TASK_REF.test(taskRef)) continue;
    const attempt = Number(extractField(split.header, "attempt") || 1);
    const created = extractField(split.header, "created") || "";
    const list = runsByTask.get(taskRef) || [];
    list.push({ file, attempt, created, raw, split });
    runsByTask.set(taskRef, list);
  }
  const entries = [];
  for (const [, runs] of runsByTask) {
    const attemptCounts = new Map();
    for (const r of runs) attemptCounts.set(r.attempt, (attemptCounts.get(r.attempt) || 0) + 1);
    const hasDuplicates = [...attemptCounts.values()].some((n) => n > 1);
    if (!hasDuplicates) continue;
    runs.sort((a, b) => a.created.localeCompare(b.created));
    runs.forEach((r, idx) => {
      const desired = idx + 1;
      if (r.attempt === desired) return;
      const next = replaceField(r.split.header, "attempt", String(desired));
      if (next === r.split.header) return;
      const nextText = `---\n${next}\n---${r.split.sep}${r.split.body}`;
      entries.push({ file: r.file, kind: "run-attempt-resequence", changes: [{ field: "attempt", from: String(r.attempt), to: String(desired) }], nextText, originalText: r.raw });
    });
  }
  return entries;
}

function planAcceptanceCriteria(scrumDir) {
  const entries = [];
  const CANONICAL_HEADING = "## Acceptance Criteria";
  const VARIANT_RE = /^##\s+Acceptance\s+Criteria\s*$/im;
  const CANONICAL_RE = /^## Acceptance Criteria\b/m;
  for (const file of listDir(path.join(scrumDir, "tasks"), TASK_FILE)) {
    const raw = readIf(file);
    if (raw === null) continue;
    if (CANONICAL_RE.test(raw)) continue;
    // Rename a case/spacing variant (e.g. "## Acceptance criteria" or extra
    // whitespace) to the canonical heading conformance requires.
    if (VARIANT_RE.test(raw)) {
      const nextText = raw.replace(VARIANT_RE, CANONICAL_HEADING);
      if (nextText !== raw) {
        entries.push({ file, kind: "acceptance-criteria", changes: [{ field: "acceptance-criteria", from: "(variant)", to: "(canonical heading)" }], nextText, originalText: raw });
        continue;
      }
    }
    // Otherwise append a minimal placeholder.
    const trailingNewline = raw.endsWith("\n") ? "" : "\n";
    const nextText = `${raw}${trailingNewline}\n## Acceptance Criteria\n\n- Preserved from legacy migration. The Task body above captures the original scope; edit this section when re-approaching the work.\n`;
    entries.push({ file, kind: "acceptance-criteria", changes: [{ field: "acceptance-criteria", from: "(missing)", to: "(added)" }], nextText, originalText: raw });
  }
  return entries;
}

function planSecretRedaction(scrumDir) {
  // Move secret-like content out of canonical files into `.scrumrun/vault.local.md`
  // and leave a `<vault:ID>` reference in place. The vault is git-ignored by the
  // installer, so secrets stop appearing in commits but the actual values are
  // preserved locally under a single, protected file — never invented, never lost.
  const crypto = require("node:crypto");
  const entries = [];
  const dirs = ["tasks", "runs", "features", "sprints", "reviews", "memory/knowledge", "memory/decisions", "memory/insights", "memory/dossiers"];
  const vaultAdditions = new Map(); // id → { value, sources: Set<relativePath> }
  for (const subdir of dirs) {
    const dir = path.join(scrumDir, subdir);
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const filePath = path.join(dir, name);
      if (!fs.statSync(filePath).isFile()) continue;
      const raw = readIf(filePath);
      if (raw === null) continue;
      let redacted = raw;
      let hits = 0;
      const relative = path.relative(scrumDir, filePath);
      for (const pattern of SECRET_PATTERNS) {
        const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
        redacted = redacted.replace(global, (match) => {
          const id = crypto.createHash("sha256").update(match).digest("hex").slice(0, 8);
          const existing = vaultAdditions.get(id) || { value: match, sources: new Set() };
          existing.sources.add(relative);
          vaultAdditions.set(id, existing);
          hits += 1;
          return `<vault:${id}>`;
        });
      }
      if (raw !== redacted) {
        entries.push({ file: filePath, kind: "secret-redaction", changes: [{ field: "secret", from: `${hits} match(es)`, to: "<vault:ID>" }], nextText: redacted, originalText: raw });
      }
    }
  }
  if (vaultAdditions.size) {
    const vaultPath = path.join(scrumDir, "vault.local.md");
    const existingVault = readIf(vaultPath) || "";
    const header = existingVault ? existingVault : "---\nkind: vault\n---\n\n# Local Vault\n\nSecret-like values redacted from canonical files. **Never committed.**\nReference from canonical Markdown via `<vault:ID>`.\n\n## Secrets\n";
    let vaultText = header;
    for (const [id, entry] of vaultAdditions) {
      if (existingVault.includes(`<vault:${id}>`)) continue;
      const sources = [...entry.sources].sort().join(", ");
      vaultText += `\n- \`<vault:${id}>\` — sources: ${sources}\n  \`\`\`\n  ${entry.value}\n  \`\`\`\n`;
    }
    if (vaultText !== existingVault) {
      entries.push({ file: vaultPath, kind: "vault-append", changes: [{ field: "vault", from: `${vaultAdditions.size} secret(s)`, to: "appended" }], nextText: vaultText, originalText: existingVault });
    }
  }
  return entries;
}

function planOrphanRuns(scrumDir, taskIds) {
  const orphans = [];
  for (const file of listDir(path.join(scrumDir, "runs"), RUN_FILE)) {
    const raw = readIf(file);
    if (raw === null) continue;
    const split = splitFrontmatter(raw);
    if (!split) continue;
    const taskRef = extractField(split.header, "task");
    if (taskRef && taskRef !== "null" && TASK_REF.test(taskRef) && taskIds.has(taskRef)) continue;
    orphans.push({ file, reason: taskRef ? `task ${taskRef} is null or missing from .scrumrun/tasks/` : "task field missing", originalText: raw });
  }
  return orphans;
}

function planFile(file, kind, ctx) {
  const original = readIf(file);
  if (original === null) return null;
  const split = splitFrontmatter(original);
  if (!split) return null;

  let header = split.header;
  const changes = [];

  const updated = extractField(header, "updated");
  if (updated !== undefined && updated !== "null" && !ISO_DATE.test(updated)) {
    const parsed = new Date(updated);
    if (!isNaN(parsed.getTime())) {
      const iso = parsed.toISOString().slice(0, 10);
      const next = replaceField(header, "updated", iso);
      if (next !== header) {
        changes.push({ field: "updated", from: updated, to: iso });
        header = next;
      }
    }
  }

  // Deduplicate frontmatter fields (keep first occurrence, drop subsequent).
  const seenFields = new Set();
  const dedupedLines = [];
  const dupChanges = [];
  for (const line of header.split("\n")) {
    const fieldMatch = line.match(/^([a-z_][a-z0-9_]*):/i);
    if (fieldMatch) {
      const name = fieldMatch[1].toLowerCase();
      if (seenFields.has(name)) {
        dupChanges.push({ field: name, from: "(duplicate)", to: "(removed)" });
        continue;
      }
      seenFields.add(name);
    }
    // Also strip inline YAML array items that our simple parser can't digest:
    //   - { key: v, key2: v2 }
    // These block the migration validator; the data itself is unrecoverable
    // without a full YAML parser, so preserve the containing list header only.
    if (/^\s*-\s*\{[^}]*\}\s*$/.test(line)) {
      dupChanges.push({ field: "inline-yaml", from: line.trim(), to: "(removed)" });
      continue;
    }
    dedupedLines.push(line);
  }
  if (dupChanges.length) {
    header = dedupedLines.join("\n");
    changes.push(...dupChanges);
  }

  // Fix kind: bug (legacy Task variant) → kind: task; keep type: fix if present.
  const kindValue = extractField(header, "kind");
  if (kind === "task" && kindValue === "bug") {
    header = replaceField(header, "kind", "task");
    changes.push({ field: "kind", from: "bug", to: "task" });
  }

  const method = extractField(header, "method");
  if (method === undefined) {
    if (hasField(header, "id")) {
      const next = insertFieldAfter(header, "id", "method", "2.0.0");
      if (next !== header) {
        changes.push({ field: "method", from: "(missing)", to: "2.0.0" });
        header = next;
      }
    }
  } else if (method !== "2.0.0" && method !== "null") {
    const next = replaceField(header, "method", "2.0.0");
    if (next !== header) {
      changes.push({ field: "method", from: method, to: "2.0.0" });
      header = next;
    }
  }

  // If `updated` is missing or unparseable, fall back to `created`.
  const createdValue = extractField(header, "created");
  const updatedNow = extractField(header, "updated");
  if ((updatedNow === undefined || (updatedNow !== "null" && !ISO_DATE.test(updatedNow) && isNaN(new Date(updatedNow).getTime()))) && createdValue && ISO_DATE.test(createdValue)) {
    if (updatedNow === undefined && hasField(header, "created")) {
      const next = insertFieldAfter(header, "created", "updated", createdValue);
      if (next !== header) {
        changes.push({ field: "updated", from: "(missing)", to: createdValue });
        header = next;
      }
    } else if (updatedNow !== undefined) {
      const next = replaceField(header, "updated", createdValue);
      if (next !== header) {
        changes.push({ field: "updated", from: updatedNow, to: createdValue });
        header = next;
      }
    }
  }

  if (kind === "task") {
    const feature = extractField(header, "feature");
    if (feature !== undefined && feature !== "null" && feature !== null && feature !== "") {
      if (!FEAT_REF.test(feature) && SLUG_REF.test(feature) && !ctx.featureIds.has(feature)) {
        const next = replaceField(header, "feature", "null");
        if (next !== header) {
          changes.push({ field: "feature", from: feature, to: "null" });
          header = next;
        }
      }
    }

    const status = extractField(header, "status");
    if (status && TASK_STATUS_ALIAS[status]) {
      const next = replaceField(header, "status", TASK_STATUS_ALIAS[status]);
      if (next !== header) {
        changes.push({ field: "status", from: status, to: TASK_STATUS_ALIAS[status] });
        header = next;
      }
    }
  }

  if (kind === "run") {
    // Reconcile `updated` with the last event's occurred_at date. Fixes Runs
    // normalized by an older CLI that stamped `updated: today` instead of
    // matching the snapshot event, which produced the "Run updated date
    // disagrees with final event timestamp" migration blocker.
    const currentUpdated = extractField(header, "updated");
    const eventDates = [...split.body.matchAll(/"occurred_at":\s*"(\d{4}-\d{2}-\d{2})/g)].map((m) => m[1]);
    if (eventDates.length && currentUpdated && ISO_DATE.test(currentUpdated)) {
      const lastEventDate = eventDates[eventDates.length - 1];
      if (currentUpdated !== lastEventDate) {
        const next = replaceField(header, "updated", lastEventDate);
        if (next !== header) {
          changes.push({ field: "updated", from: currentUpdated, to: lastEventDate });
          header = next;
        }
      }
    }

    // Remove `workspace: 1` from historical Runs — this marker triggers the
    // MUTATION_BYPASS baseline check which requires a real workspace snapshot
    // that legacy Runs do not have. Downgrading status: partial → failed
    // (below) takes them out of the active security check entirely.
    if (extractField(header, "workspace") === "1") {
      header = header.split("\n").filter((l) => !/^\s*workspace:\s*1\s*$/.test(l)).join("\n");
      changes.push({ field: "workspace", from: "1", to: "(removed)" });
    }
    if (extractField(header, "guardrails") === "1") {
      header = header.split("\n").filter((l) => !/^\s*guardrails:\s*1\s*$/.test(l)).join("\n");
      changes.push({ field: "guardrails", from: "1", to: "(removed)" });
    }

    const taskRef = extractField(header, "task");
    if (taskRef === undefined) {
      if (hasField(header, "id")) {
        const next = insertFieldAfter(header, "id", "task", "null");
        if (next !== header) {
          changes.push({ field: "task", from: "(missing)", to: "null" });
          header = next;
        }
      }
    } else if (taskRef !== "null" && taskRef !== null && taskRef !== "" && !TASK_REF.test(taskRef)) {
      const next = replaceField(header, "task", "null");
      if (next !== header) {
        changes.push({ field: "task", from: taskRef, to: "null" });
        header = next;
      }
    }
    const status = extractField(header, "status");
    if (status && RUN_STATUS_ALIAS[status]) {
      const next = replaceField(header, "status", RUN_STATUS_ALIAS[status]);
      if (next !== header) {
        changes.push({ field: "status", from: status, to: RUN_STATUS_ALIAS[status] });
        header = next;
      }
    }
    // Downgrade legacy active statuses (executing/validating/learning) to
    // `failed` when either:
    //   (a) `updated` is older than 14 days — Runs written by the CLI don't
    //       linger active this long; or
    //   (b) the ledger body has only a single `snapshot` event — the Run
    //       came from normalize-legacy and can't be genuinely active.
    const runStatusNow = extractField(header, "status");
    const runUpdated = extractField(header, "updated");
    if (["executing", "validating", "learning"].includes(runStatusNow)) {
      const ageDays = runUpdated && ISO_DATE.test(runUpdated)
        ? (Date.now() - new Date(runUpdated).getTime()) / 86400000
        : 0;
      const eventTypes = [...split.body.matchAll(/"type":\s*"([a-z_]+)"/g)].map((m) => m[1]);
      const snapshotOnly = eventTypes.length > 0 && eventTypes.every((t) => t === "snapshot");
      if (ageDays > 14 || snapshotOnly) {
        const next = replaceField(header, "status", "failed");
        if (next !== header) {
          const reason = snapshotOnly ? "snapshot-only ledger" : `stuck ${Math.round(ageDays)}d`;
          changes.push({ field: "status", from: `${runStatusNow} (${reason})`, to: "failed" });
          header = next;
        }
      }
    }
    if (!hasField(header, "attempt") && hasField(header, "task")) {
      const next = insertFieldAfter(header, "task", "attempt", "1");
      if (next !== header) {
        changes.push({ field: "attempt", from: "(missing)", to: "1" });
        header = next;
      }
    }
  }

  if (!changes.length) return { file, kind, changes: [], nextText: original };

  const nextText = `---\n${header}\n---${split.sep}${split.body}`;
  return { file, kind, changes, nextText, originalText: original };
}

function planGuardrails(scrumDir) {
  const file = path.join(scrumDir, "guardrails.md");
  const original = readIf(file);
  if (original === null) return null;
  const changes = [];
  let text = original;
  const scopeRe = /^(\s*scope:\s*)([^\n\r]+)$/gim;
  text = text.replace(scopeRe, (match, prefix, value) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "null") return match;
    if (GUARDRAIL_SCOPES.has(trimmed)) return match;
    changes.push({ field: "scope", from: trimmed, to: "all" });
    return `${prefix}all`;
  });
  if (!changes.length) return null;
  return { file, kind: "guardrails", changes, nextText: text, originalText: original };
}

function analyze(scrumDir) {
  const featureIds = scanFeatureIds(scrumDir);
  const taskIds = scanTaskIds(scrumDir);
  const ctx = { featureIds };
  const entries = planMissingFrontmatter(scrumDir);
  const orphanRuns = planOrphanRuns(scrumDir, taskIds);

  const guardrailPlan = planGuardrails(scrumDir);
  if (guardrailPlan) entries.push(guardrailPlan);

  // Extra passes: status sync, attempt resequence, acceptance criteria, secret redaction.
  entries.push(...planStatusSync(scrumDir));
  entries.push(...planAttemptResequence(scrumDir));
  const missingFrontmatter = new Set(entries.filter((entry) => entry.kind === "legacy-frontmatter").map((entry) => entry.file));
  entries.push(...planAcceptanceCriteria(scrumDir).filter((entry) => !missingFrontmatter.has(entry.file)));
  entries.push(...planSecretRedaction(scrumDir));

  for (const file of listDir(path.join(scrumDir, "tasks"), TASK_FILE)) {
    const plan = planFile(file, "task", ctx);
    if (plan && plan.changes.length) entries.push(plan);
  }
  for (const file of listDir(path.join(scrumDir, "runs"), RUN_FILE)) {
    const plan = planFile(file, "run", ctx);
    if (plan && plan.changes.length) entries.push(plan);
  }
  for (const file of listDir(path.join(scrumDir, "features"), FEAT_FILE)) {
    const plan = planFile(file, "feature", ctx);
    if (plan && plan.changes.length) entries.push(plan);
  }
  for (const file of listDir(path.join(scrumDir, "sprints"), SPRINT_FILE)) {
    const plan = planFile(file, "sprint", ctx);
    if (plan && plan.changes.length) entries.push(plan);
  }
  for (const subdir of ["memory", "memory/knowledge", "memory/decisions", "memory/insights", "memory/dossiers"]) {
    for (const file of listDir(path.join(scrumDir, subdir), MEMORY_FILE)) {
      const plan = planFile(file, "memory", ctx);
      if (plan && plan.changes.length) entries.push(plan);
    }
  }

  const totals = { files: entries.length, byField: {} };
  for (const entry of entries) {
    for (const change of entry.changes) {
      totals.byField[change.field] = (totals.byField[change.field] || 0) + 1;
    }
  }
  return { entries, totals, orphanRuns };
}

function writeWithBackup(scrumDir, backupRoot, file, originalText, nextText) {
  const relative = path.relative(scrumDir, file);
  const backupPath = path.join(backupRoot, relative);
  fs.mkdirSync(path.dirname(backupPath), { recursive: true });
  if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, originalText);
  fs.writeFileSync(file, nextText);
  return { file: relative, backup: path.relative(scrumDir, backupPath) };
}

function apply(scrumDir, plan) {
  const backupRoot = path.join(scrumDir, ".migration-backup", "repair");
  fs.mkdirSync(backupRoot, { recursive: true });
  const applied = [];

  // Pass 1: frontmatter + guardrails + acceptance criteria + secrets from analyze().
  for (const entry of plan.entries) {
    const rec = writeWithBackup(scrumDir, backupRoot, entry.file, entry.originalText, entry.nextText);
    applied.push({ ...rec, changes: entry.changes });
  }

  // Pass 2: normalize legacy Run ledgers (empty/broken) — reads fresh from disk.
  let ledgerResult = null;
  try {
    ledgerResult = normalizeLegacyRuns(scrumDir, { dryRun: false });
  } catch {
    ledgerResult = { plan: { malformed: 0 }, applied: [] };
  }

  // Pass 3: quarantine orphan Runs (Task ref missing/invalid AND target Task doesn't exist).
  const orphanBackup = path.join(scrumDir, ".migration-backup", "repair", "orphan-runs");
  const quarantined = [];
  for (const orphan of plan.orphanRuns || []) {
    if (!fs.existsSync(orphan.file)) continue;
    fs.mkdirSync(orphanBackup, { recursive: true });
    const target = path.join(orphanBackup, path.basename(orphan.file));
    if (!fs.existsSync(target)) fs.writeFileSync(target, fs.readFileSync(orphan.file, "utf8"));
    fs.rmSync(orphan.file, { force: true });
    quarantined.push({ id: path.basename(orphan.file, ".md"), reason: orphan.reason, backup: path.relative(scrumDir, target) });
  }

  // Pass 4: after Runs/Tasks were rewritten, re-run attempt resequence + status sync
  // against the current disk state so decisions use post-pass-1 data.
  const resequenced = planAttemptResequence(scrumDir);
  for (const entry of resequenced) {
    const rec = writeWithBackup(scrumDir, backupRoot, entry.file, entry.originalText, entry.nextText);
    applied.push({ ...rec, changes: entry.changes });
  }
  const synced = planStatusSync(scrumDir);
  for (const entry of synced) {
    const rec = writeWithBackup(scrumDir, backupRoot, entry.file, entry.originalText, entry.nextText);
    applied.push({ ...rec, changes: entry.changes });
  }

  // Pass 5: rebuild the disposable state.md briefing so it reflects the
  // repaired canonical tree (otherwise doctor keeps warning STATE_STALE).
  try {
    require("../runtime/orchestrator").refreshState(scrumDir);
  } catch {
    // Best-effort — the briefing is a projection; conformance will re-report
    // if it truly cannot be rebuilt.
  }

  return { applied, ledger: ledgerResult, quarantined };
}

function renderReport(plan, applied) {
  const lines = [];
  lines.push("## Repair plan\n");
  lines.push(`Files needing frontmatter repair: ${plan.entries.length}`);
  if (plan.ledgerMalformed) lines.push(`Run ledgers to normalize:        ${plan.ledgerMalformed}`);
  if (plan.orphanRuns && plan.orphanRuns.length) lines.push(`Orphan Runs to quarantine:       ${plan.orphanRuns.length}`);
  const byField = plan.totals.byField;
  if (Object.keys(byField).length) {
    lines.push("\nBy field:");
    for (const [field, count] of Object.entries(byField)) {
      lines.push(`  - ${field}: ${count}`);
    }
  }
  if (plan.entries.length) {
    lines.push("\nDetails (up to 30 files shown):");
    for (const entry of plan.entries.slice(0, 30)) {
      const summary = entry.changes.map((c) => `${c.field}: ${c.from} → ${c.to}`).join("; ");
      lines.push(`  - ${path.basename(entry.file)}: ${summary}`);
    }
    if (plan.entries.length > 30) lines.push(`  … and ${plan.entries.length - 30} more`);
  }
  if (applied) {
    lines.push("");
    const frontmatterCount = applied.applied ? applied.applied.length : 0;
    const ledgerCount = applied.ledger && applied.ledger.applied ? applied.ledger.applied.length : 0;
    const quarantinedCount = applied.quarantined ? applied.quarantined.length : 0;
    if (frontmatterCount || ledgerCount || quarantinedCount) {
      if (frontmatterCount) lines.push(`Applied: ${frontmatterCount} frontmatter file(s) rewritten.`);
      if (ledgerCount) lines.push(`Normalized: ${ledgerCount} Run ledger(s) collapsed to snapshot events.`);
      if (quarantinedCount) lines.push(`Quarantined: ${quarantinedCount} orphan Run(s) moved to .scrumrun/.migration-backup/repair/orphan-runs/.`);
      lines.push("Backups under .scrumrun/.migration-backup/repair/ and .scrumrun/.migration-backup/runs/.");
    } else {
      lines.push("Applied: no changes.");
    }
  } else {
    lines.push("");
    lines.push("The project remains unchanged. Apply with: scrumrun repair --apply");
  }
  return lines.join("\n");
}

function repair(scrumDir, { apply: doApply = false } = {}) {
  if (!fs.existsSync(scrumDir) || !fs.lstatSync(scrumDir).isDirectory()) {
    throw new Error(".scrumrun/ not found; run this inside a ScrumRun project.");
  }
  const plan = analyze(scrumDir);
  let ledgerPreview = null;
  try {
    ledgerPreview = normalizeLegacyRuns(scrumDir, { dryRun: true }).plan;
  } catch {
    ledgerPreview = null;
  }
  plan.ledgerMalformed = ledgerPreview ? ledgerPreview.malformed : 0;
  if (!doApply) return { plan, applied: null, report: renderReport(plan, null) };
  const applied = apply(scrumDir, plan);
  plan.ledgerNormalized = applied.ledger && applied.ledger.applied ? applied.ledger.applied.length : 0;
  return { plan, applied, report: renderReport(plan, applied) };
}

module.exports = { repair, analyze, apply, renderReport };
