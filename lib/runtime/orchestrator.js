"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  ARTIFACT_TYPES,
  ArtifactRepository,
  METHOD_VERSION,
  atomicWrite,
  parseArtifact,
  serializeArtifact,
  sha256,
  transitionArtifact,
  validateArtifact,
  withArtifactLock
} = require("../v2/artifacts");
const { buildContextPackage } = require("./context");
const { artifactSnapshot, canonicalFingerprint, canonicalWatchSnapshot } = require("./canonical-snapshot");
const { decodeApproval } = require("./request-engine");
const { extractLearningCandidates } = require("../code-intel/learning");
const { appendRunEvent, createRunBody, instant } = require("./run-ledger");
const { recoverPendingTransactions, runKernelTransaction } = require("../v2/transaction");

const TERMINAL = new Set(["completed", "failed", "cancelled", "resolved", "rejected", "deprecated", "invalidated", "archived", "passed"]);

function date() {
  return new Date().toISOString().slice(0, 10);
}

function nextId(repository, kind) {
  const type = ARTIFACT_TYPES[kind];
  const max = repository.list(kind).reduce((highest, artifact) => {
    const match = artifact.record && artifact.record.id.match(/-(\d+)$/);
    return match ? Math.max(highest, Number(match[1])) : highest;
  }, 0);
  return `${type.prefix}-${String(max + 1).padStart(3, "0")}`;
}

function titleFor(request) {
  const firstLine = request.split(/\r?\n/)[0].trim();
  return firstLine.length > 100 ? `${firstLine.slice(0, 97)}...` : firstLine;
}

function stateFingerprint(repository) {
  return canonicalFingerprint(repository.scrumDir, artifactSnapshot(repository.scrumDir).hashes);
}

function stateProjection(repository) {
  const snapshot = artifactSnapshot(repository.scrumDir);
  const linesFor = (kinds) => kinds.flatMap((kind) => (snapshot.records[kind] || [])
    .filter((record) => record.id && !TERMINAL.has(record.status))
    .map((record) => `- ${record.id} | ${kind} | ${record.status} | ${record.title || record.id}`));
  const work = linesFor(["feature", "task", "sprint", "run", "review"]);
  const memory = linesFor(["decision", "knowledge", "insight", "dossier"]);
  const sourceFingerprint = canonicalFingerprint(repository.scrumDir, snapshot.hashes);
  const watch = canonicalWatchSnapshot(repository.scrumDir);
  const content = `# ScrumRun State\n\nProjection schema: 1\nGenerated: ${new Date().toISOString()}\nSource fingerprint: ${sourceFingerprint}\nWatch fingerprint: ${watch.fingerprint}\nAuthority: none; rebuild from canonical artifacts.\n\n## Active Work\n\n${work.length ? work.join("\n") : "- No active canonical work."}\n\n## Relevant Memory\n\n${memory.length ? memory.join("\n") : "- No active canonical memory."}\n`;
  return { content, sourceFingerprint, watchFingerprint: watch.fingerprint, sourceFiles: watch.files };
}

function renderState(repository) {
  return stateProjection(repository).content;
}

function refreshState(scrumDir) {
  const repository = new ArtifactRepository(scrumDir);
  const projection = stateProjection(repository);
  atomicWrite(path.join(scrumDir, "state.md"), projection.content);
  return projection;
}

function stateIsStale(scrumDir) {
  const content = fs.existsSync(path.join(scrumDir, "state.md")) ? fs.readFileSync(path.join(scrumDir, "state.md"), "utf8") : "";
  const stored = (content.match(/^Source fingerprint:\s*([a-f0-9]{64})$/m) || [])[1];
  if (!stored) return true;
  const watched = (content.match(/^Watch fingerprint:\s*([a-f0-9]{64})$/m) || [])[1];
  if (watched && watched === canonicalWatchSnapshot(scrumDir).fingerprint) return false;
  return stored !== stateFingerprint(new ArtifactRepository(scrumDir));
}

function approvalExisting(repository, approvalId) {
  const task = repository.list("task").find((artifact) => artifact.record && artifact.record.approval_id === approvalId);
  if (!task) return null;
  const run = repository.list("run").find((artifact) => artifact.record && artifact.record.approval_id === approvalId);
  return { task: task.record, run: run ? run.record : null };
}

function approveRequestUnlocked(projectRoot, token, { failurePoint = null, interruptPoint = null } = {}) {
  const payload = decodeApproval(token);
  if (payload.policy.status !== "passed" || payload.policy.violations.length) throw new Error("Blocked intake cannot be approved.");
  const issued = Date.parse(payload.issuedAt);
  if (!Number.isFinite(issued) || Date.now() - issued > 24 * 60 * 60 * 1000) throw new Error("Approval token expired; run intake again.");
  const scrumDir = path.join(projectRoot, ".scrumrun");
  recoverPendingTransactions(scrumDir);
  const repository = new ArtifactRepository(scrumDir);
  const approvalId = sha256(token).slice(0, 20);
  const existing = approvalExisting(repository, approvalId);
  if (existing) return { status: "already-approved", ...existing };
  const currentContext = buildContextPackage(projectRoot, payload.request);
  if (currentContext.fingerprint !== payload.fingerprint) {
    throw new Error("Project context changed after planning; run intake again before approval.");
  }

  const created = date();
  const taskId = nextId(repository, "task");
  const runId = nextId(repository, "run");
  const task = {
    id: taskId,
    kind: "task",
    type: payload.classification.taskType,
    status: "running",
    created,
    updated: created,
    method: METHOD_VERSION,
    feature: null,
    sprint: null,
    approval_id: approvalId,
    context_fingerprint: payload.fingerprint,
    risk: payload.risk.level
  };
  const run = {
    id: runId,
    kind: "run",
    status: "executing",
    created,
    updated: created,
    method: METHOD_VERSION,
    task: taskId,
    sprint: null,
    attempt: 1,
    ledger: 1,
    approval_id: approvalId
  };
  const taskBody = `# ${titleFor(payload.request)}\n\n## Request\n\n${payload.request}\n\n## Classification\n\n- Type: ${payload.classification.type}\n- Reason: ${payload.classification.reason}\n- Risk: ${payload.risk.level}\n\n## Approval\n\n- Explicit approval token: ${approvalId}\n- Context fingerprint: ${payload.fingerprint}`;
  const runBody = createRunBody(run, { approvalId }).body;
  try {
    runKernelTransaction(scrumDir, "approve-task-run", [
      { file: repository.pathFor(task), previous: null, next: serializeArtifact(task, taskBody) },
      { file: repository.pathFor(run), previous: null, next: serializeArtifact(run, runBody) }
    ], {
      failurePoint: failurePoint === "after-task" ? "after-1" : failurePoint === "after-run" ? "after-2" : null,
      interruptPoint
    });
  } catch (error) {
    if (failurePoint === "after-task") throw new Error(`Injected approval failure after Task creation: ${error.message}`);
    if (failurePoint === "after-run") throw new Error(`Injected approval failure after Run creation: ${error.message}`);
    throw error;
  }
  refreshState(scrumDir);
  return { status: "approved", task, run };
}

function approveRequest(projectRoot, token, options = {}) {
  return withArtifactLock(path.join(projectRoot, ".scrumrun"), "approval", () => approveRequestUnlocked(projectRoot, token, options));
}

function transitionedArtifactContent(content, kind, nextStatus, updated) {
  const parsed = parseArtifact(content);
  const errors = [...parsed.errors, ...validateArtifact(parsed.record, kind)];
  if (errors.length) throw new Error(`Invalid ${kind} artifact: ${errors.join("; ")}`);
  const nextRecord = transitionArtifact(parsed.record, nextStatus, updated);
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/);
  let frontmatter = frontmatterMatch[1]
    .replace(/^status:\s*.*$/m, `status: ${nextStatus}`)
    .replace(/^updated:\s*.*$/m, `updated: ${nextRecord.updated}`);
  const next = `---\n${frontmatter}\n---${frontmatterMatch[2]}`;
  const validated = parseArtifact(next);
  const nextErrors = [...validated.errors, ...validateArtifact(validated.record, kind)];
  if (nextErrors.length) throw new Error(`Transition validation failed: ${nextErrors.join("; ")}`);
  return { content: next, record: validated.record };
}

function transitionedRunContent(content, nextStatus, options = {}) {
  const parsed = parseArtifact(content);
  const errors = [...parsed.errors, ...validateArtifact(parsed.record, "run")];
  if (errors.length) throw new Error(`Invalid run artifact: ${errors.join("; ")}`);
  const occurredAt = options.occurredAt ? instant(options.occurredAt) : instant();
  const updated = occurredAt.slice(0, 10);
  const nextRecord = transitionArtifact(parsed.record, nextStatus, updated);
  const ledger = appendRunEvent(parsed.record, parsed.body, nextRecord, { ...options, occurredAt });
  return {
    content: serializeArtifact(nextRecord, ledger.body),
    record: nextRecord,
    event: ledger.event
  };
}

function transitionRunUnlocked(projectRoot, runId, nextStatus, { note = null, evidence = [], actor = "agent", occurredAt = null, failurePoint = null, interruptPoint = null } = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const recovered = recoverPendingTransactions(scrumDir);
  const repository = new ArtifactRepository(scrumDir);
  const runArtifact = repository.read("run", runId);
  if (!runArtifact) throw new Error(`Run not found: ${runId}`);
  const taskArtifact = repository.read("task", runArtifact.record.task);
  if (!taskArtifact) throw new Error(`Task not found for ${runId}: ${runArtifact.record.task}`);
  if (runArtifact.record.status === nextStatus && recovered.some((item) => item.action === "verified")) {
    refreshState(scrumDir);
    return { run: runArtifact.record, task: taskArtifact.record, learning: null, recovered };
  }
  const taskStatuses = {
    validating: "validating",
    learning: "learning",
    completed: "completed",
    failed: "failed",
    blocked: "blocked",
    executing: "running"
  };
  const nextTaskStatus = taskStatuses[nextStatus];
  if (!nextTaskStatus) throw new Error(`Run status cannot synchronize a Task: ${nextStatus}`);
  const runPrevious = fs.readFileSync(runArtifact.file, "utf8");
  const taskPrevious = fs.readFileSync(taskArtifact.file, "utf8");
  const runNext = transitionedRunContent(runPrevious, nextStatus, { note, evidence, actor, occurredAt });
  const taskNext = transitionedArtifactContent(taskPrevious, "task", nextTaskStatus, runNext.record.updated);
  try {
    runKernelTransaction(scrumDir, "transition-run-task", [
      { file: runArtifact.file, previous: runPrevious, next: runNext.content },
      { file: taskArtifact.file, previous: taskPrevious, next: taskNext.content }
    ], { failurePoint, interruptPoint });
  } catch (error) {
    if (failurePoint) throw new Error(`Injected transition failure: ${error.message}`);
    throw error;
  }
  refreshState(scrumDir);
  let learning = null;
  if (nextStatus === "learning") {
    try {
      learning = extractLearningCandidates(projectRoot, runId);
    } catch (error) {
      learning = { created: [], warnings: [`Learning extraction did not block the Run: ${error.message}`] };
    }
    refreshState(scrumDir);
  }
  return { run: runNext.record, task: taskNext.record, learning, recovered };
}

function transitionRun(projectRoot, runId, nextStatus, options = {}) {
  return withArtifactLock(path.join(projectRoot, ".scrumrun"), `run-${String(runId).toLowerCase()}`, () => transitionRunUnlocked(projectRoot, runId, nextStatus, options));
}

function retryTaskUnlocked(projectRoot, taskId, { note = "Retry explicitly approved.", failurePoint = null, interruptPoint = null } = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const recovered = recoverPendingTransactions(scrumDir);
  const repository = new ArtifactRepository(scrumDir);
  const taskArtifact = repository.read("task", taskId);
  if (!taskArtifact) throw new Error(`Task not found: ${taskId}`);
  if (taskArtifact.record.status === "running" && recovered.some((item) => item.action === "verified")) {
    const latest = repository.list("run")
      .filter((artifact) => artifact.record && artifact.record.task === taskId)
      .sort((left, right) => right.record.attempt - left.record.attempt)[0];
    if (latest) {
      refreshState(scrumDir);
      return { run: latest.record, task: taskArtifact.record, content: fs.readFileSync(latest.file, "utf8"), recovered };
    }
  }
  if (!["failed", "blocked", "partial"].includes(taskArtifact.record.status)) {
    throw new Error(`Task ${taskId} is ${taskArtifact.record.status}; retry requires failed, blocked, or partial.`);
  }
  const attempts = repository.list("run")
    .filter((artifact) => artifact.record && artifact.record.task === taskId)
    .map((artifact) => Number(artifact.record.attempt) || 0);
  const run = {
    id: nextId(repository, "run"),
    kind: "run",
    status: "executing",
    created: date(),
    updated: date(),
    method: METHOD_VERSION,
    task: taskId,
    sprint: taskArtifact.record.sprint || null,
    attempt: attempts.length ? Math.max(...attempts) + 1 : 1,
    ledger: 1,
    approval_id: taskArtifact.record.approval_id || null
  };
  const runBody = createRunBody(run, {
    title: `Retry for ${taskId}`,
    actor: "owner",
    reason: note,
    evidence: [{ kind: "approval", summary: note }]
  }).body;
  const runContent = serializeArtifact(run, runBody);
  const taskPrevious = fs.readFileSync(taskArtifact.file, "utf8");
  const taskNext = transitionedArtifactContent(taskPrevious, "task", "running", date());
  try {
    runKernelTransaction(scrumDir, "retry-task-run", [
      { file: repository.pathFor(run), previous: null, next: runContent },
      { file: taskArtifact.file, previous: taskPrevious, next: taskNext.content }
    ], {
      failurePoint: failurePoint === "after-run" ? "after-1" : failurePoint,
      interruptPoint
    });
  } catch (error) {
    if (failurePoint === "after-run") throw new Error(`Injected retry failure after Run creation: ${error.message}`);
    throw error;
  }
  refreshState(scrumDir);
  return { run, task: taskNext.record, content: runContent, recovered };
}

function retryTask(projectRoot, taskId, options = {}) {
  return withArtifactLock(path.join(projectRoot, ".scrumrun"), `task-${String(taskId).toLowerCase()}`, () => retryTaskUnlocked(projectRoot, taskId, options));
}

module.exports = { approveRequest, nextId, refreshState, renderState, retryTask, stateFingerprint, stateIsStale, transitionRun };
