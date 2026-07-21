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
const { decodeApproval } = require("./request-engine");
const { extractLearningCandidates } = require("../code-intel/learning");

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
  const hashes = [];
  for (const kind of Object.keys(ARTIFACT_TYPES)) {
    for (const artifact of repository.list(kind)) {
      hashes.push(`${path.relative(repository.scrumDir, artifact.file)}\0${sha256(fs.readFileSync(artifact.file))}`);
    }
  }
  for (const relative of ["guardrails.md", "config.md", "project.md", "method.json"]) {
    const file = path.join(repository.scrumDir, relative);
    hashes.push(`${relative}\0${fs.existsSync(file) ? sha256(fs.readFileSync(file)) : "missing"}`);
  }
  return sha256(hashes.sort().join("\n"));
}

function renderState(repository) {
  const linesFor = (kinds) => kinds.flatMap((kind) => repository.list(kind)
    .filter((artifact) => artifact.record && !TERMINAL.has(artifact.record.status))
    .map((artifact) => {
      const title = ((artifact.body || "").match(/^# ([^\r\n]+)/m) || [])[1] || artifact.record.id;
      return `- ${artifact.record.id} | ${kind} | ${artifact.record.status} | ${title}`;
    }));
  const work = linesFor(["feature", "task", "sprint", "run", "review"]);
  const memory = linesFor(["decision", "knowledge", "insight", "dossier"]);
  return `# ScrumRun State\n\nGenerated: ${date()}\nSource fingerprint: ${stateFingerprint(repository)}\nAuthority: none; rebuild from canonical artifacts.\n\n## Active Work\n\n${work.length ? work.join("\n") : "- No active canonical work."}\n\n## Relevant Memory\n\n${memory.length ? memory.join("\n") : "- No active canonical memory."}\n`;
}

function refreshState(scrumDir) {
  const repository = new ArtifactRepository(scrumDir);
  atomicWrite(path.join(scrumDir, "state.md"), renderState(repository));
}

function stateIsStale(scrumDir) {
  const content = fs.existsSync(path.join(scrumDir, "state.md")) ? fs.readFileSync(path.join(scrumDir, "state.md"), "utf8") : "";
  const stored = (content.match(/^Source fingerprint:\s*([a-f0-9]{64})$/m) || [])[1];
  if (!stored) return true;
  return stored !== stateFingerprint(new ArtifactRepository(scrumDir));
}

function approvalExisting(repository, approvalId) {
  const task = repository.list("task").find((artifact) => artifact.record && artifact.record.approval_id === approvalId);
  if (!task) return null;
  const run = repository.list("run").find((artifact) => artifact.record && artifact.record.approval_id === approvalId);
  return { task: task.record, run: run ? run.record : null };
}

function approveRequestUnlocked(projectRoot, token, { failurePoint = null } = {}) {
  const payload = decodeApproval(token);
  if (payload.policy.status !== "passed" || payload.policy.violations.length) throw new Error("Blocked intake cannot be approved.");
  const issued = Date.parse(payload.issuedAt);
  if (!Number.isFinite(issued) || Date.now() - issued > 24 * 60 * 60 * 1000) throw new Error("Approval token expired; run intake again.");
  const scrumDir = path.join(projectRoot, ".scrumrun");
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
    approval_id: approvalId
  };
  const taskBody = `# ${titleFor(payload.request)}\n\n## Request\n\n${payload.request}\n\n## Classification\n\n- Type: ${payload.classification.type}\n- Reason: ${payload.classification.reason}\n- Risk: ${payload.risk.level}\n\n## Approval\n\n- Explicit approval token: ${approvalId}\n- Context fingerprint: ${payload.fingerprint}`;
  const runBody = `# Run for ${taskId}\n\n## Transition Log\n\n- ${created}: created → executing — explicit approval accepted.\n\n## Validation\n\n- Pending.\n\n## Learning\n\n- Pending.`;
  let taskWritten = false;
  let runWritten = false;
  try {
    taskWritten = repository.write(task, taskBody).status === "written";
    if (failurePoint === "after-task") throw new Error("Injected approval failure after Task creation.");
    runWritten = repository.write(run, runBody).status === "written";
    if (failurePoint === "after-run") throw new Error("Injected approval failure after Run creation.");
  } catch (error) {
    if (runWritten) fs.rmSync(repository.pathFor(run), { force: true });
    if (taskWritten) fs.rmSync(repository.pathFor(task), { force: true });
    throw error;
  }
  refreshState(scrumDir);
  return { status: "approved", task, run };
}

function approveRequest(projectRoot, token, options = {}) {
  return withArtifactLock(path.join(projectRoot, ".scrumrun"), "approval", () => approveRequestUnlocked(projectRoot, token, options));
}

function transitionedContent(content, kind, nextStatus, note) {
  const parsed = parseArtifact(content);
  const errors = [...parsed.errors, ...validateArtifact(parsed.record, kind)];
  if (errors.length) throw new Error(`Invalid ${kind} artifact: ${errors.join("; ")}`);
  const nextRecord = transitionArtifact(parsed.record, nextStatus, date());
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/);
  let frontmatter = frontmatterMatch[1]
    .replace(/^status:\s*.*$/m, `status: ${nextStatus}`)
    .replace(/^updated:\s*.*$/m, `updated: ${nextRecord.updated}`);
  const transition = `\n\n## Transition ${date()} · ${parsed.record.status}-to-${nextStatus}\n\n- ${note || "State transition requested through ScrumRun."}\n`;
  const next = `---\n${frontmatter}\n---${frontmatterMatch[2].trimEnd()}${transition}`;
  const validated = parseArtifact(next);
  const nextErrors = [...validated.errors, ...validateArtifact(validated.record, kind)];
  if (nextErrors.length) throw new Error(`Transition validation failed: ${nextErrors.join("; ")}`);
  return { content: next, record: validated.record };
}

function writePairWithRollback(changes, failurePoint = null) {
  const written = [];
  try {
    for (let index = 0; index < changes.length; index++) {
      const change = changes[index];
      atomicWrite(change.file, change.next);
      written.push(change);
      if (failurePoint === `after-${index + 1}`) throw new Error(`Injected transition failure after write ${index + 1}.`);
    }
  } catch (error) {
    for (const change of written.reverse()) atomicWrite(change.file, change.previous);
    throw error;
  }
}

function transitionRunUnlocked(projectRoot, runId, nextStatus, { note = null, failurePoint = null } = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const repository = new ArtifactRepository(scrumDir);
  const runArtifact = repository.read("run", runId);
  if (!runArtifact) throw new Error(`Run not found: ${runId}`);
  const taskArtifact = repository.read("task", runArtifact.record.task);
  if (!taskArtifact) throw new Error(`Task not found for ${runId}: ${runArtifact.record.task}`);
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
  const runNext = transitionedContent(runPrevious, "run", nextStatus, note);
  const taskNext = transitionedContent(taskPrevious, "task", nextTaskStatus, `Synchronized from ${runId}: ${note || nextStatus}.`);
  writePairWithRollback([
    { file: runArtifact.file, previous: runPrevious, next: runNext.content },
    { file: taskArtifact.file, previous: taskPrevious, next: taskNext.content }
  ], failurePoint);
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
  return { run: runNext.record, task: taskNext.record, learning };
}

function transitionRun(projectRoot, runId, nextStatus, options = {}) {
  return withArtifactLock(path.join(projectRoot, ".scrumrun"), `run-${String(runId).toLowerCase()}`, () => transitionRunUnlocked(projectRoot, runId, nextStatus, options));
}

function retryTaskUnlocked(projectRoot, taskId, { note = "Retry explicitly approved.", failurePoint = null } = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const repository = new ArtifactRepository(scrumDir);
  const taskArtifact = repository.read("task", taskId);
  if (!taskArtifact) throw new Error(`Task not found: ${taskId}`);
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
    approval_id: taskArtifact.record.approval_id || null
  };
  const runContent = serializeArtifact(run, `# Retry for ${taskId}\n\n## Transition Log\n\n- ${date()}: created → executing — ${note}`);
  const taskPrevious = fs.readFileSync(taskArtifact.file, "utf8");
  const taskNext = transitionedContent(taskPrevious, "task", "running", `${run.id} created: ${note}`);
  let runWritten = false;
  try {
    runWritten = repository.write(run, `# Retry for ${taskId}\n\n## Transition Log\n\n- ${date()}: created → executing — ${note}`).status === "written";
    if (failurePoint === "after-run") throw new Error("Injected retry failure after Run creation.");
    atomicWrite(taskArtifact.file, taskNext.content);
  } catch (error) {
    if (runWritten) fs.rmSync(repository.pathFor(run), { force: true });
    atomicWrite(taskArtifact.file, taskPrevious);
    throw error;
  }
  refreshState(scrumDir);
  return { run, task: taskNext.record, content: runContent };
}

function retryTask(projectRoot, taskId, options = {}) {
  return withArtifactLock(path.join(projectRoot, ".scrumrun"), `task-${String(taskId).toLowerCase()}`, () => retryTaskUnlocked(projectRoot, taskId, options));
}

module.exports = { approveRequest, nextId, refreshState, renderState, retryTask, stateFingerprint, stateIsStale, transitionRun };
