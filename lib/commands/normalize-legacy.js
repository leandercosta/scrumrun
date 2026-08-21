"use strict";

// `sc plan run --normalize-legacy [--dry-run]`
//
// Reads every Run under `.scrumrun/runs/` and validates its ledger
// against the current schema. When a Run fails validation (invalid
// event type, unknown evidence kind, missing snapshot, bad transition,
// empty ledger, etc.), the whole ledger is collapsed into a single
// snapshot event that preserves the fact of the Run without inventing
// transitions. The original body is preserved byte-exact under
// `.scrumrun/.migration-backup/runs/RUN-NNN.md` (append `.NN` when a
// backup already exists so history is never overwritten).
//
// This is coherent with ADR-021: ambiguous history becomes evidence,
// never invented transitions.

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const { parseRunLedger, validateRunLedger, renderRunEvent } = require("../runtime/run-ledger");
const { RUN_LEDGER_VERSION } = require("../v2/schema");

const RUN_FILENAME_PATTERN = /^RUN-\d{3,}\.md$/;
const TASK_REF_PATTERN = /^TASK-\d{3,}$/;

function readFrontmatterAndBody(text) {
  const match = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { frontmatter: {}, header: "", body: String(text || "") };
  const header = match[1];
  const body = match[2] || "";
  const frontmatter = {};
  for (const line of header.split(/\r?\n/)) {
    const kv = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/i);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === "null" || value === "") value = null;
    else if (/^-?\d+$/.test(value)) value = Number(value);
    frontmatter[kv[1]] = value;
  }
  return { frontmatter, header, body };
}

function extractTitle(body, fallback) {
  const match = String(body || "").match(/^# ([^\r\n]+)$/m);
  return match ? match[1] : fallback;
}

function serializeFrontmatter(frontmatter) {
  const lines = Object.entries(frontmatter).map(([key, value]) => {
    if (value === null || value === undefined) return `${key}: null`;
    return `${key}: ${value}`;
  });
  return `---\n${lines.join("\n")}\n---`;
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function reserveBackupPath(backupDir, runId) {
  ensureDir(backupDir);
  const base = path.join(backupDir, `${runId}.md`);
  if (!fs.existsSync(base)) return base;
  for (let n = 1; n <= 99; n++) {
    const candidate = path.join(backupDir, `${runId}.md.${String(n).padStart(2, "0")}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`Cannot reserve backup slot for ${runId}: 100 backups already exist.`);
}

function needsNormalization(record, body) {
  if (!record) return { needs: true, reason: "frontmatter is malformed or missing" };
  if (typeof record.task === "string" && record.task && !TASK_REF_PATTERN.test(record.task)) {
    return { needs: true, reason: `task field does not match TASK-NNN (was ${JSON.stringify(record.task)})` };
  }
  const result = validateRunLedger(record, body);
  const errors = result.errors || [];
  if (errors.length) return { needs: true, reason: `ledger validation failed (${errors.length} error${errors.length === 1 ? "" : "s"})`, errors };
  return { needs: false };
}

function buildNormalizedBody({ record, originalBody, backupRelative, reason, errors }) {
  const title = extractTitle(originalBody, `Run ${record.id}`);
  const sha = crypto.createHash("sha256").update(originalBody).digest("hex");
  const snapshotDate = record.created || new Date().toISOString().slice(0, 10);
  const normalizedRecord = {
    id: record.id,
    kind: "run",
    status: record.status || "partial",
    created: record.created,
    updated: snapshotDate,
    method: "2.0.0",
    task: TASK_REF_PATTERN.test(record.task || "") ? record.task : null,
    sprint: record.sprint || null,
    attempt: record.attempt || 1,
    ledger: RUN_LEDGER_VERSION
  };
  const evidence = [
    { kind: "legacy", ref: backupRelative, summary: `byte-exact original preserved (sha256:${sha.slice(0, 12)}…)` },
    { kind: "note", summary: reason }
  ];
  if (errors && errors.length) {
    const sampled = errors.slice(0, 5).map((error) => `- ${error}`).join("; ");
    evidence.push({ kind: "note", summary: `Pre-normalization validation errors: ${sampled}${errors.length > 5 ? `; +${errors.length - 5} more` : ""}` });
  }
  const event = {
    schema: RUN_LEDGER_VERSION,
    id: `${record.id}-EVT-001`,
    sequence: 1,
    type: "snapshot",
    occurred_at: `${snapshotDate}T00:00:00.000Z`,
    timestamp_precision: "date",
    actor: "migration",
    from: null,
    to: normalizedRecord.status,
    reason: `Legacy Run ledger normalized to preserve history without inventing canonical transitions. See ${backupRelative}.`,
    evidence
  };
  const front = serializeFrontmatter(normalizedRecord);
  const bodyText = `# ${title}\n\n## Events\n\n${renderRunEvent(event)}\n`;
  return `${front}\n\n${bodyText}`;
}

function scanRuns(scrumDir) {
  const runsDir = path.join(scrumDir, "runs");
  if (!fs.existsSync(runsDir) || !fs.lstatSync(runsDir).isDirectory()) return [];
  return fs
    .readdirSync(runsDir)
    .filter((name) => RUN_FILENAME_PATTERN.test(name))
    .sort()
    .map((name) => path.join(runsDir, name));
}

function analyze(scrumDir) {
  const plan = { runs: [], safe: 0, malformed: 0 };
  for (const file of scanRuns(scrumDir)) {
    const raw = fs.readFileSync(file, "utf8");
    const { frontmatter } = readFrontmatterAndBody(raw);
    const check = needsNormalization(frontmatter, raw);
    plan.runs.push({ id: frontmatter.id || path.basename(file, ".md"), file, needs: check.needs, reason: check.reason || "ledger validates", errors: check.errors || [] });
    if (check.needs) plan.malformed += 1;
    else plan.safe += 1;
  }
  return plan;
}

function apply(scrumDir, plan) {
  const backupDir = path.join(scrumDir, ".migration-backup", "runs");
  const applied = [];
  for (const entry of plan.runs) {
    if (!entry.needs) continue;
    const raw = fs.readFileSync(entry.file, "utf8");
    const { frontmatter } = readFrontmatterAndBody(raw);
    const backupPath = reserveBackupPath(backupDir, entry.id);
    fs.writeFileSync(backupPath, raw);
    const backupRelative = path.relative(scrumDir, backupPath);
    const normalized = buildNormalizedBody({
      record: frontmatter,
      originalBody: raw,
      backupRelative,
      reason: entry.reason,
      errors: entry.errors
    });
    fs.writeFileSync(entry.file, normalized);
    applied.push({ id: entry.id, backup: backupRelative, reason: entry.reason });
  }
  return applied;
}

function renderReport(plan, applied) {
  const lines = [];
  lines.push("## Run ledger normalization plan");
  lines.push("");
  lines.push(`Runs scanned:      ${plan.runs.length}`);
  lines.push(`Already valid:     ${plan.safe}`);
  lines.push(`Needs normalize:   ${plan.malformed}`);
  if (plan.malformed) {
    lines.push("");
    lines.push("Malformed Runs:");
    for (const entry of plan.runs) {
      if (!entry.needs) continue;
      lines.push(`  - ${entry.id}: ${entry.reason}`);
    }
  }
  if (applied) {
    lines.push("");
    lines.push("Applied:");
    if (!applied.length) lines.push("  (no changes)");
    for (const entry of applied) {
      lines.push(`  - ${entry.id} → normalized (backup ${entry.backup})`);
    }
  }
  return lines.join("\n");
}

function normalizeLegacyRuns(scrumDir, { dryRun = false } = {}) {
  if (!fs.existsSync(scrumDir) || !fs.lstatSync(scrumDir).isDirectory()) {
    throw new Error(".scrumrun/ not found; run this inside a ScrumRun project.");
  }
  const plan = analyze(scrumDir);
  if (dryRun) return { plan, applied: null };
  const applied = apply(scrumDir, plan);
  return { plan, applied };
}

module.exports = {
  normalizeLegacyRuns,
  analyze,
  apply,
  renderReport,
  buildNormalizedBody,
  needsNormalization,
  scanRuns
};
