"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ArtifactRepository } = require("./artifacts");
const { ARTIFACT_TYPES, METHOD_VERSION, RUN_LEDGER_VERSION } = require("./schema");
const { stateIsStale } = require("../runtime/orchestrator");
const { validateRunLedger } = require("../runtime/run-ledger");
const { indexStatus, mapStatus } = require("../memory/index");
const { extractEvidence } = require("../memory/markdown");
const { resolveEvidence } = require("../memory/service");
const { containsSecret } = require("../security/secrets");
const { pendingTransactionStatus } = require("./transaction");
const { configWeakeningAttempts, validateGuardrailDocument } = require("../runtime/policy-engine");

const INVARIANTS = Object.freeze([
  { id: "I-01", summary: "pre-approval work is read-only", tests: ["intake builds bounded context without writing"] },
  { id: "I-02", summary: "approval creates Task and Run atomically", tests: ["explicit approval creates exactly one linked Task and Run", "approval failure injection rolls back"] },
  { id: "I-03", summary: "Task is atomic and Sprint only groups evidenced batches", tests: ["migration apply creates linked v2 artifacts", "artifact repository builds explicit Feature Task Sprint Run graph"] },
  { id: "I-04", summary: "retry preserves prior Runs", tests: ["retry creates a new Run and preserves"] },
  { id: "I-05", summary: "state transitions are declared, evidenced, ordered, and recoverable", tests: ["run state machine follows", "Run ledger uses stable event ids", "paired transition failure restores"] },
  { id: "I-06", summary: "guardrails are canonical and cannot be weakened", tests: ["guardrails build preserves canonical v2 rules", "Policy Engine reports exact Guardrail ids"] },
  { id: "I-07", summary: "Markdown is canonical and indexes are disposable", tests: ["SQLite index is disposable"] },
  { id: "I-08", summary: "AI memory remains candidate", tests: ["AI insights stay candidate"] },
  { id: "I-09", summary: "confirmed claims require evidence", tests: ["confirmed facts reject missing"] },
  { id: "I-10", summary: "inactive memory is not active truth", tests: ["stale and expired memory are labeled"] },
  { id: "I-11", summary: "vault values never leave the vault boundary", tests: ["migration dry-run is read-only and never renders vault", "SQLite index is disposable"] },
  { id: "I-12", summary: "canonical schemas and identities are valid", tests: ["v2 artifact schemas round-trip", "malformed and mismatched artifacts are rejected"] },
  { id: "I-13", summary: "generated state exposes staleness", tests: ["generated state includes structured decisions", "approval rejects tampered or stale plans", "state staleness uses metadata fast path", "generated map status refuses stale projection"] },
  { id: "I-14", summary: "context and retrieval are bounded", tests: ["lean context stays within twenty-five percent", "semantic query caps relation output", "semantic index staleness uses metadata fast path"] },
  { id: "I-15", summary: "migration and ordinary update are read-only by default", tests: ["migration dry-run is read-only", "update preflights an ongoing v1 project"] },
  { id: "I-16", summary: "migration is hashed, idempotent, and reversible", tests: ["migration apply is idempotent and rollback restores", "Run ledger migration failure and rollback restore"] },
  { id: "I-17", summary: "ambiguous migration is preserved and warned", tests: ["partial v1 layout is preserved"] },
  { id: "I-18", summary: "unsafe and partial writes fail safely", tests: ["canonical writes reject traversal and symlink paths", "repository refuses conflicting overwrite", "interrupted kernel transaction is recovered"] },
  { id: "I-19", summary: "code intelligence is derived and fingerprinted", tests: ["language adapters are replaceable", "moves remap by fingerprint"] },
  { id: "I-20", summary: "learning candidates never block execution", tests: ["post-validation extraction creates candidate insights"] }
]);

function finding(severity, code, message, file = null) {
  return { severity, code, message, ...(file ? { file } : {}) };
}

function auditProject(projectRoot) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const findings = [];
  if (!fs.existsSync(scrumDir) || !fs.lstatSync(scrumDir).isDirectory()) {
    findings.push(finding("critical", "PROJECT_MISSING", ".scrumrun/ is missing or is not a directory."));
    return { method: METHOD_VERSION, passed: false, findings, counts: {} };
  }
  const marker = path.join(scrumDir, "method.json");
  let methodMarker = null;
  try {
    if (!fs.existsSync(marker) || !fs.lstatSync(marker).isFile()) throw new Error("marker is missing, not a regular file, or is a symbolic link");
    methodMarker = JSON.parse(fs.readFileSync(marker, "utf8"));
    if (methodMarker.method !== METHOD_VERSION) findings.push(finding("critical", "METHOD_VERSION", `method.json must declare ${METHOD_VERSION}.`, marker));
  } catch (error) {
    findings.push(finding("critical", "METHOD_MARKER", `method.json is missing or malformed: ${error.message}`, marker));
  }
  for (const relative of ["core.md", "guardrails.md", "config.md", "project.md"]) {
    const file = path.join(scrumDir, relative);
    if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) findings.push(finding("high", "CANONICAL_MISSING", `${relative} is missing or unsafe.`, file));
  }
  const guardrailsFile = path.join(scrumDir, "guardrails.md");
  const guardrails = fs.existsSync(guardrailsFile) && fs.lstatSync(guardrailsFile).isFile() ? fs.readFileSync(guardrailsFile, "utf8") : "";
  const guardrailValidation = validateGuardrailDocument(guardrails);
  if (!guardrailValidation.records.length) findings.push(finding("high", "GUARDRAILS_EMPTY", "No stable-id Guardrail is defined."));
  if (!guardrailValidation.records.some((record) => record.status === "active")) findings.push(finding("high", "GUARDRAILS_INACTIVE", "No active stable-id Guardrail is defined."));
  for (const error of guardrailValidation.errors) findings.push(finding("high", "GUARDRAIL_INVALID", error, guardrailsFile));
  const configFile = path.join(scrumDir, "config.md");
  const config = fs.existsSync(configFile) && fs.lstatSync(configFile).isFile() ? fs.readFileSync(configFile, "utf8") : "";
  for (const error of configWeakeningAttempts(config)) findings.push(finding("high", "CONFIG_WEAKENS_POLICY", error, configFile));

  const repository = new ArtifactRepository(scrumDir);
  const counts = {};
  const ids = new Set();
  const records = {};
  for (const kind of Object.keys(ARTIFACT_TYPES)) {
    try {
      const artifacts = repository.list(kind);
      records[kind] = artifacts;
      counts[kind] = artifacts.length;
      for (const artifact of artifacts) {
        for (const error of artifact.errors) findings.push(finding("high", "ARTIFACT_INVALID", `${path.basename(artifact.file)}: ${error}`, artifact.file));
        if (containsSecret(fs.readFileSync(artifact.file, "utf8"))) findings.push(finding("critical", "SECRET_CANONICAL", `Secret-like content detected in ${path.relative(scrumDir, artifact.file)}.`, artifact.file));
        if (artifact.record && ids.has(artifact.record.id)) findings.push(finding("critical", "ID_DUPLICATE", `Duplicate artifact id: ${artifact.record.id}`));
        if (artifact.record) ids.add(artifact.record.id);
      }
    } catch (error) {
      findings.push(finding("critical", "ARTIFACT_PATH", `${kind}: ${error.message}`));
    }
  }
  for (const run of records.run || []) {
    const task = run.record ? repository.read("task", run.record.task) : null;
    if (run.record && (!task || task.errors.length)) findings.push(finding("high", "RUN_TASK_MISSING", `${run.record.id} references missing or invalid ${run.record.task}.`, run.file));
    if (run.record && task && !task.errors.length && (run.record.sprint || null) !== (task.record.sprint || null)) {
      findings.push(finding("high", "RUN_SPRINT_MISMATCH", `${run.record.id}.sprint must match ${task.record.id}.sprint.`, run.file));
    }
    if (run.record && run.record.ledger === RUN_LEDGER_VERSION) {
      const ledger = validateRunLedger(run.record, run.body);
      for (const error of ledger.errors) findings.push(finding("high", "RUN_LEDGER_INVALID", `${run.record.id}: ${error}`, run.file));
    } else if (run.record) {
      const declared = methodMarker && methodMarker.schemas && methodMarker.schemas.run_ledger === RUN_LEDGER_VERSION;
      findings.push(finding(declared ? "high" : "warning", "RUN_LEDGER_LEGACY", `${run.record.id} requires the Run ledger ${RUN_LEDGER_VERSION} migration.`, run.file));
    }
  }
  const byId = new Map(Object.values(records).flat().filter((artifact) => artifact.record).map((artifact) => [artifact.record.id, artifact]));
  for (const task of records.task || []) {
    for (const [field, prefix] of [["feature", "FEAT"], ["sprint", "SPRINT"]]) {
      const target = task.record && task.record[field];
      if (target && (!target.startsWith(`${prefix}-`) || !byId.has(target))) findings.push(finding("high", "RELATION_MISSING", `${task.record.id}.${field} references missing ${target}.`, task.file));
    }
  }
  for (const run of records.run || []) {
    const sprint = run.record && run.record.sprint;
    if (sprint && !byId.has(sprint)) findings.push(finding("high", "RELATION_MISSING", `${run.record.id}.sprint references missing ${sprint}.`, run.file));
  }
  const attemptsByTask = new Map();
  for (const run of records.run || []) {
    if (!run.record || run.errors.length) continue;
    if (!attemptsByTask.has(run.record.task)) attemptsByTask.set(run.record.task, []);
    attemptsByTask.get(run.record.task).push(run.record.attempt);
  }
  for (const [taskId, attempts] of attemptsByTask) {
    const ordered = [...attempts].sort((a, b) => a - b);
    const expected = ordered.map((_, index) => index + 1);
    if (ordered.length !== new Set(ordered).size || ordered.some((attempt, index) => attempt !== expected[index])) {
      findings.push(finding("high", "RUN_ATTEMPT_SEQUENCE", `${taskId} Run attempts must be unique and contiguous from 1; found ${ordered.join(", ")}.`));
    }
  }
  for (const task of records.task || []) {
    if (!task.record || task.errors.length) continue;
    const attempts = (records.run || [])
      .filter((run) => run.record && !run.errors.length && run.record.task === task.record.id)
      .sort((left, right) => right.record.attempt - left.record.attempt);
    if (!attempts.length) continue;
    const latest = attempts[0].record;
    const taskStatuses = {
      executing: "running",
      validating: "validating",
      learning: "learning",
      completed: "completed",
      failed: "failed",
      blocked: "blocked",
      partial: "partial"
    };
    if (taskStatuses[latest.status] && task.record.status !== taskStatuses[latest.status]) {
      findings.push(finding("high", "TASK_RUN_STATUS_MISMATCH", `${task.record.id}.status ${task.record.status} disagrees with latest ${latest.id}.status ${latest.status}.`, task.file));
    }
  }
  for (const sprint of records.sprint || []) {
    if (!sprint.record || sprint.errors.length) continue;
    const heading = /^## Tasks[ \t]*$/m.exec(sprint.body);
    let taskSection = "";
    if (heading) {
      const tail = sprint.body.slice(heading.index + heading[0].length);
      const nextHeading = /^## [^\r\n]+$/m.exec(tail);
      taskSection = nextHeading ? tail.slice(0, nextHeading.index) : tail;
    }
    const listed = new Set([...taskSection.matchAll(/^-\s+(TASK-\d{3,})\s*$/gm)].map((match) => match[1]));
    const expected = new Set((records.task || [])
      .filter((task) => task.record && !task.errors.length && task.record.sprint === sprint.record.id)
      .map((task) => task.record.id));
    const missing = [...expected].filter((id) => !listed.has(id));
    const extra = [...listed].filter((id) => !expected.has(id));
    if (missing.length || extra.length) {
      findings.push(finding("high", "SPRINT_MEMBERSHIP_MISMATCH", `${sprint.record.id} Tasks projection disagrees with Task.sprint (missing: ${missing.join(", ") || "none"}; extra: ${extra.join(", ") || "none"}).`, sprint.file));
    }
  }
  const confirmed = new Set(["approved", "confirmed", "resolved", "active"]);
  for (const kind of ["knowledge", "decision", "insight", "dossier"]) {
    for (const artifact of records[kind] || []) {
      if (!artifact.record || !confirmed.has(artifact.record.status)) continue;
      const evidence = extractEvidence(artifact.body);
      if (!evidence.length) {
        findings.push(finding("high", "EVIDENCE_MISSING", `${artifact.record.id} is active truth without evidence.`, artifact.file));
        continue;
      }
      for (const reference of evidence) {
        const result = resolveEvidence(projectRoot, repository, reference);
        if (!result.resolved) findings.push(finding("high", "EVIDENCE_UNRESOLVED", `${artifact.record.id}: ${reference} (${result.reason}).`, artifact.file));
      }
    }
  }
  const ignoreFile = path.join(scrumDir, ".gitignore");
  const ignore = fs.existsSync(ignoreFile) && fs.lstatSync(ignoreFile).isFile() ? fs.readFileSync(ignoreFile, "utf8") : "";
  for (const pattern of [".cache/", "vault.local.md"]) {
    if (!ignore.split(/\r?\n/).includes(pattern)) findings.push(finding("high", "IGNORE_MISSING", `${pattern} must be ignored by .scrumrun/.gitignore.`));
  }
  try {
    if (stateIsStale(scrumDir)) findings.push(finding("warning", "STATE_STALE", "state.md is missing or stale; rebuild it before relying on the view."));
  } catch (error) {
    findings.push(finding("high", "STATE_UNSAFE", `state cannot be rebuilt safely: ${error.message}`));
  }
  try {
    const semantic = indexStatus(projectRoot);
    if (semantic.exists && semantic.stale) findings.push(finding("warning", "INDEX_STALE", "semantic-index.sqlite is stale and will be rebuilt on query."));
    const map = mapStatus(projectRoot, { semanticStatus: semantic });
    if (semantic.exists && map.stale) findings.push(finding("warning", "MAP_STALE", `map.md is stale: ${map.reason || map.error || "unknown reason"}.`));
  } catch (error) {
    findings.push(finding("high", "INDEX_UNSAFE", `semantic index cannot inspect canonical sources safely: ${error.message}`));
  }
  const transactions = pendingTransactionStatus(scrumDir);
  if (transactions.error) {
    findings.push(finding("high", "TRANSACTION_JOURNAL_UNSAFE", transactions.error));
  } else {
    for (const transaction of transactions.pending) {
      findings.push(finding("high", "TRANSACTION_PENDING", `${transaction.id} (${transaction.name}) is ${transaction.status}; run the approved operation again or recover explicitly before trusting canonical state.`));
    }
  }
  const blocking = findings.filter((item) => ["critical", "high"].includes(item.severity));
  return { method: METHOD_VERSION, passed: blocking.length === 0, findings, counts, invariants: INVARIANTS.length };
}

module.exports = { INVARIANTS, auditProject };
