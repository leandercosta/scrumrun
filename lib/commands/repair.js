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

const TASK_FILE = /^TASK-\d{3,}\.md$/;
const RUN_FILE = /^RUN-\d{3,}\.md$/;
const FEAT_FILE = /^FEAT-\d{3,}\.md$/;
const SPRINT_FILE = /^SPRINT-\d{3,}\.md$/;
const MEMORY_FILE = /^(K|DEC|INS|DOS)-\d{3,}\.md$/;
const TASK_REF = /^TASK-\d{3,}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const FEAT_REF = /^FEAT-\d{3,}$/;
const SLUG_REF = /^[a-z0-9][a-z0-9-]*$/;

const TASK_STATUS_ALIAS = {
  done: "completed",
  todo: "backlog",
  complete: "completed",
  in_progress: "executing"
};

const RUN_STATUS_ALIAS = {
  complete: "completed",
  in_progress: "executing",
  done: "completed"
};

const GUARDRAIL_SCOPES = new Set(["all", "intake", "execution", "mutation", "canonical", "memory", "migration", "validation", "learning", "completion", "commit", "release", "logs"]);

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
  const entries = [];
  const orphanRuns = planOrphanRuns(scrumDir, taskIds);

  const guardrailPlan = planGuardrails(scrumDir);
  if (guardrailPlan) entries.push(guardrailPlan);

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

function apply(scrumDir, plan) {
  const backupRoot = path.join(scrumDir, ".migration-backup", "repair");
  fs.mkdirSync(backupRoot, { recursive: true });
  const applied = [];
  for (const entry of plan.entries) {
    const relative = path.relative(scrumDir, entry.file);
    const backupPath = path.join(backupRoot, relative);
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    if (!fs.existsSync(backupPath)) fs.writeFileSync(backupPath, entry.originalText);
    fs.writeFileSync(entry.file, entry.nextText);
    applied.push({ file: relative, backup: path.relative(scrumDir, backupPath), changes: entry.changes });
  }
  // Also normalize legacy Run ledgers (empty/broken) — same safety guarantee: byte-exact backup.
  let ledgerResult = null;
  try {
    ledgerResult = normalizeLegacyRuns(scrumDir, { dryRun: false });
  } catch {
    ledgerResult = { plan: { malformed: 0 }, applied: [] };
  }
  // Quarantine orphan Runs (Task ref missing/invalid — schema requires TASK-NNN). Move byte-exact
  // to backup so nothing is deleted; the orphan can be manually re-linked or discarded later.
  const orphanBackup = path.join(scrumDir, ".migration-backup", "repair", "orphan-runs");
  const quarantined = [];
  for (const orphan of plan.orphanRuns || []) {
    fs.mkdirSync(orphanBackup, { recursive: true });
    const target = path.join(orphanBackup, path.basename(orphan.file));
    if (!fs.existsSync(target)) fs.writeFileSync(target, orphan.originalText);
    fs.rmSync(orphan.file, { force: true });
    quarantined.push({ id: path.basename(orphan.file, ".md"), reason: orphan.reason, backup: path.relative(scrumDir, target) });
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
