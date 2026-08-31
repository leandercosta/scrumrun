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
const { agentIdentity, evaluatePolicy } = require("./policy-engine");
const { artifactSnapshot, canonicalFingerprint, canonicalWatchSnapshot } = require("./canonical-snapshot");
const { decodeApproval, materializeRequest } = require("./request-engine");
const { containsSecret } = require("../security/secrets");
const { currentBranch } = require("./workspace-state");
const { extractLearningCandidates } = require("../code-intel/learning");
const { appendRunEvent, appendTechnicalSummary, createRunBody, instant } = require("./run-ledger");
const { generateBriefing, generateErrorsReport } = require("./briefing");
const { assertCanonicalWrite, policyState, prepareCompletion, prepareSessionCompletion, publicWorkspace, verifyWorkspaceIntegrity, workspaceState } = require("./mutation-gateway");
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

function initiativeBody(title, request, created, taskId) {
  return `# ${title}\n\n## Purpose\n\n${request}\n\n## Linked Tasks\n\n- ${taskId} — ${title}\n\n## Exit Criteria\n\n- [ ] Define the initiative success condition before completion.\n\n## Source\n\n- ${created}: materialized automatically from approved intake.\n`;
}

function sprintBody(title, request, created, taskId) {
  return `# ${title}\n\n## Timebox\n\n${request}\n\n## Tasks\n\n- ${taskId}\n\n## Exit Gate\n\n- [ ] Define the batch completion condition before completion.\n\n## Source\n\n- ${created}: materialized automatically from approved intake. The linked Task represents Sprint planning until the requested work is decomposed into atomic Tasks.\n`;
}

function buildTaskBody(request, classification, approvalId, fingerprint, risk, previewSection, links = {}) {
  const featureSection = links.feature ? `\n## Feature\n\n- ${links.feature}\n` : "";
  const sprintSection = links.sprint ? `\n## Sprint\n\n- ${links.sprint}\n` : "";
  return `# ${titleFor(request)}\n\n## Request\n\n${request}\n\n## Acceptance Criteria\n\n- [ ] _Define what "done" means before execution._\n${previewSection}${featureSection}${sprintSection}\n## Classification\n\n- Type: ${classification.type}\n- Reason: ${classification.reason}\n- Risk: ${risk.level}\n\n## Approval\n\n- Explicit approval token: ${approvalId}\n- Context fingerprint: ${fingerprint}`;
}

function stateFingerprint(repository) {
  return canonicalFingerprint(repository.scrumDir, artifactSnapshot(repository.scrumDir).hashes);
}

function stateProjection(repository) {
  return generateBriefing(repository.scrumDir, repository);
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

function refreshErrors(scrumDir) {
  const repository = new ArtifactRepository(scrumDir);
  const report = generateErrorsReport(scrumDir, repository);
  atomicWrite(path.join(scrumDir, "errors.md"), report.content);
  return report;
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
  const workspace = workspaceState(projectRoot);
  if (!payload.workspaceFingerprint || workspace.fingerprint !== payload.workspaceFingerprint) {
    throw new Error("Project workspace changed after planning; run intake again before approval.");
  }

  const created = date();
  const enforceablePolicy = policyState(projectRoot);
  const baseline = publicWorkspace(workspace);
  const branch = currentBranch(projectRoot);
  const materialization = materializeRequest(payload.classification);
  const createFeature = materialization.links.feature;
  const createSprint = materialization.links.sprint;
  const featureId = createFeature ? nextId(repository, "feature") : null;
  const sprintId = createSprint ? nextId(repository, "sprint") : null;
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
    feature: featureId,
    sprint: sprintId,
    branch,
    assignee: agentIdentity(scrumDir) || "agent",
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
    feature: featureId,
    sprint: sprintId,
    branch,
    attempt: 1,
    ledger: 1,
    guardrails: 1,
    workspace: 1,
    execution: "session",
    approval_id: approvalId
  };
  const taskLinks = { feature: featureId, sprint: sprintId };
  const previewSection = payload.preview ? `\n\n## Preview\n\n${payload.preview}\n` : "";
  const taskContent = buildTaskBody(payload.request, payload.classification, approvalId, payload.fingerprint, payload.risk, previewSection, taskLinks);
  const featureRecord = featureId ? {
    id: featureId,
    kind: "feature",
    status: "active",
    created,
    updated: created,
    method: METHOD_VERSION,
    branch,
    type: "initiative"
  } : null;
  const featureBody = featureId ? initiativeBody(titleFor(payload.request), payload.request, created, taskId) : null;
  const sprintRecord = sprintId ? {
    id: sprintId,
    kind: "sprint",
    status: "running",
    created,
    updated: created,
    method: METHOD_VERSION,
    branch,
    type: null,
    feature: featureId
  } : null;
  const sprintBodyText = sprintId ? sprintBody(titleFor(payload.request), payload.request, created, taskId) : null;
  const runBody = createRunBody(run, {
    approvalId,
    obligations: payload.policy.obligations || [],
    policyFingerprint: enforceablePolicy.fingerprint,
    workspaceBaseline: baseline
  }).body;
  const featurePath = featureRecord ? repository.pathFor(featureRecord) : null;
  const sprintPath = sprintRecord ? repository.pathFor(sprintRecord) : null;
  const taskPath = repository.pathFor(task);
  const runPath = repository.pathFor(run);
  const writes = [];
  if (featureRecord) writes.push({ file: featurePath, previous: null, next: serializeArtifact(featureRecord, featureBody) });
  if (sprintRecord) writes.push({ file: sprintPath, previous: null, next: serializeArtifact(sprintRecord, sprintBodyText) });
  writes.push(
    { file: taskPath, previous: null, next: serializeArtifact(task, taskContent) },
    { file: runPath, previous: null, next: serializeArtifact(run, runBody) }
  );
  const failureTarget = {
    "after-task": `after-${writes.findIndex((entry) => entry.file === taskPath) + 1}`,
    "after-run": `after-${writes.findIndex((entry) => entry.file === runPath) + 1}`
  };
  try {
    runKernelTransaction(scrumDir, "approve-task-run", writes, {
      failurePoint: failureTarget[failurePoint] || failurePoint,
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
  return withArtifactLock(path.join(projectRoot, ".scrumrun"), "create", () => approveRequestUnlocked(projectRoot, token, options));
}

function transitionedArtifactContent(content, kind, nextStatus, updated, assignee = null) {
  const parsed = parseArtifact(content);
  const errors = [...parsed.errors, ...validateArtifact(parsed.record, kind)];
  if (errors.length) throw new Error(`Invalid ${kind} artifact: ${errors.join("; ")}`);
  const nextRecord = transitionArtifact(parsed.record, nextStatus, updated);
  const frontmatterMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/);
  let frontmatter = frontmatterMatch[1]
    .replace(/^status:\s*.*$/m, `status: ${nextStatus}`)
    .replace(/^updated:\s*.*$/m, `updated: ${nextRecord.updated}`);
  if (assignee) {
    frontmatter = /^assignee:/m.test(frontmatter)
      ? frontmatter.replace(/^assignee:\s*.*$/m, `assignee: ${assignee}`)
      : `${frontmatter}\nassignee: ${assignee}`;
  }
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

function sectionBody(markdown, heading) {
  const match = new RegExp(`^## ${heading}[ \\t]*\\r?\\n\\r?\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(markdown || "");
  return match ? match[1].trim() : null;
}

// Human-authored evidence stays beside the work in the Task, rather than
// forcing a separate CLI invocation for every guardrail. The single final
// checkpoint parses it deterministically and rejects malformed entries.
//
// - GR-005 | review | REV-001 | Scoped architecture review passed.
// - GR-006 | migration | db/migrations/20260831.sql | Migration verified.
// - GR-007 | note | Request authorization confirmed.
function finalGuardrailEvidence(taskBody) {
  const content = sectionBody(taskBody, "Guardrail Evidence");
  if (!content) return {};
  const result = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const raw = line.match(/^\s*-\s*(GR-\d{3,})\s*\|\s*([a-z-]+)\s*\|\s*(.*?)\s*$/i);
    if (!raw) throw new Error(`Invalid Guardrail Evidence entry: ${line.trim()}`);
    const [, guardrail, kind, remainder] = raw;
    const parts = remainder.split("|").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) throw new Error(`${guardrail} needs evidence content.`);
    const allowed = new Set(["approval", "command", "test", "file", "review", "decision", "insight", "risk", "note", "migration", "legacy", "guardrail", "mutation"]);
    if (!allowed.has(kind)) throw new Error(`${guardrail} has unsupported evidence kind: ${kind}.`);
    const evidence = { kind };
    if (parts.length > 1) evidence.ref = parts.shift();
    evidence.summary = parts.join(" | ") || (evidence.ref ? `${kind} evidence: ${evidence.ref}` : null);
    if (!evidence.summary) throw new Error(`${guardrail} needs an evidence summary.`);
    if (!result[guardrail]) result[guardrail] = [];
    result[guardrail].push(evidence);
  }
  return result;
}

function finalizeRunUnlocked(projectRoot, runId, { note = null, summary = null, actor = "agent", occurredAt = null } = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  recoverPendingTransactions(scrumDir);
  const repository = new ArtifactRepository(scrumDir);
  const runArtifact = repository.read("run", runId);
  if (!runArtifact || runArtifact.errors.length) throw new Error(`Run not found or invalid: ${runId}`);
  if (runArtifact.record.status !== "executing") throw new Error(`Lightweight finalization requires an executing Run; ${runId} is ${runArtifact.record.status}.`);
  const taskArtifact = repository.read("task", runArtifact.record.task);
  if (!taskArtifact || taskArtifact.errors.length) throw new Error(`Task not found or invalid for ${runId}.`);
  const technicalSummary = summary || sectionBody(taskArtifact.body, "Technical Summary");
  if (!technicalSummary) throw new Error(`TASK_SUMMARY_REQUIRED: add ## Technical Summary to ${taskArtifact.record.id}, or pass --summary.`);
  const effectiveActor = actor === "agent" ? (agentIdentity(scrumDir) || "agent") : actor;
  const prepared = prepareSessionCompletion(projectRoot, runArtifact, {
    note,
    actor: effectiveActor,
    occurredAt,
    guardrailEvidence: finalGuardrailEvidence(taskArtifact.body)
  });
  let runContent = serializeArtifact(prepared.record, prepared.body);
  for (const [status, evidence] of [
    ["validating", [{ kind: "test", summary: "Final session integrity audit passed." }]],
    ["learning", [{ kind: "insight", summary: "Learning extraction scheduled from the completed session." }]],
    ["completed", [{ kind: "note", summary: note || "Completed through the final session checkpoint." }]]
  ]) {
    runContent = transitionedRunContent(runContent, status, { actor: effectiveActor, occurredAt, note, evidence }).content;
  }
  runContent = appendTechnicalSummary(parseArtifact(runContent).record, runContent, technicalSummary);
  const taskPrevious = fs.readFileSync(taskArtifact.file, "utf8");
  let taskContent = taskPrevious;
  let taskNext = null;
  for (const status of ["validating", "learning", "completed"]) {
    taskNext = transitionedArtifactContent(taskContent, "task", status, new Date().toISOString().slice(0, 10));
    taskContent = taskNext.content;
  }
  runKernelTransaction(scrumDir, "finalize-lightweight-session", [
    { file: runArtifact.file, previous: fs.readFileSync(runArtifact.file, "utf8"), next: runContent },
    { file: taskArtifact.file, previous: taskPrevious, next: taskNext.content }
  ]);
  refreshState(scrumDir);
  let learning = null;
  try {
    learning = extractLearningCandidates(projectRoot, runId);
  } catch (error) {
    learning = { created: [], warnings: [`Learning extraction did not block finalization: ${error.message}`] };
  }
  refreshState(scrumDir);
  return { run: parseArtifact(runContent).record, task: taskNext.record, changes: prepared.changes.length, resolved: prepared.resolved, learning };
}

function finalizeRun(projectRoot, runId, options = {}) {
  return withArtifactLock(path.join(projectRoot, ".scrumrun"), `run-${String(runId).toLowerCase()}`, () => finalizeRunUnlocked(projectRoot, runId, options));
}

function transitionRunUnlocked(projectRoot, runId, nextStatus, { note = null, evidence = [], actor = "agent", occurredAt = null, summary = null, failurePoint = null, interruptPoint = null } = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const effectiveActor = actor === "agent" ? (agentIdentity(scrumDir) || "agent") : actor;
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
  if (runArtifact.record.guardrails === 1 && runArtifact.record.workspace === 1 && ["validating", "learning"].includes(nextStatus)) {
    verifyWorkspaceIntegrity(projectRoot, runArtifact);
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
  const prepared = nextStatus === "completed" ? prepareCompletion(projectRoot, runArtifact, { occurredAt }) : null;
  const transitionSource = prepared ? serializeArtifact(prepared.record, prepared.body) : runPrevious;
  const runNext = transitionedRunContent(transitionSource, nextStatus, { note, evidence, actor: effectiveActor, occurredAt });
  let runContent = runNext.content;
  if (nextStatus === "completed" && summary) {
    runContent = appendTechnicalSummary(runNext.record, runContent, summary);
  }
  const taskNext = transitionedArtifactContent(taskPrevious, "task", nextTaskStatus, runNext.record.updated);
  try {
    runKernelTransaction(scrumDir, "transition-run-task", [
      { file: runArtifact.file, previous: runPrevious, next: runContent },
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

function retryTaskUnlocked(projectRoot, taskId, { note = "Retry explicitly approved.", reassign = false, failurePoint = null, interruptPoint = null } = {}) {
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
  const identity = agentIdentity(scrumDir) || "agent";
  const currentAssignee = taskArtifact.record.assignee;
  if (currentAssignee && currentAssignee !== "agent" && currentAssignee !== identity && !reassign) {
    throw new Error(`Task ${taskId} is assigned to ${currentAssignee}; retry requires reassignment (--reassign).`);
  }
  const attempts = repository.list("run")
    .filter((artifact) => artifact.record && artifact.record.task === taskId)
    .map((artifact) => Number(artifact.record.attempt) || 0);
  const requestMatch = taskArtifact.body.match(/^## Request[ \t]*\r?\n\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  const request = requestMatch ? requestMatch[1].trim() : `Retry ${taskId}`;
  const context = buildContextPackage(projectRoot, request);
  const policy = evaluatePolicy(context);
  if (policy.status !== "passed") throw new Error(`Retry is blocked by current policy: ${policy.violations.join("; ")}`);
  const enforceablePolicy = policyState(projectRoot);
  const baseline = publicWorkspace(workspaceState(projectRoot));
  const run = {
    id: nextId(repository, "run"),
    kind: "run",
    status: "executing",
    created: date(),
    updated: date(),
    method: METHOD_VERSION,
    task: taskId,
    sprint: taskArtifact.record.sprint || null,
    branch: currentBranch(projectRoot),
    attempt: attempts.length ? Math.max(...attempts) + 1 : 1,
    ledger: 1,
    guardrails: 1,
    workspace: 1,
    execution: "session",
    approval_id: taskArtifact.record.approval_id || null
  };
  const runBody = createRunBody(run, {
    title: `Retry for ${taskId}`,
    actor: "owner",
    reason: note,
    evidence: [{ kind: "approval", summary: note }],
    obligations: policy.obligations || [],
    policyFingerprint: enforceablePolicy.fingerprint,
    workspaceBaseline: baseline
  }).body;
  const runContent = serializeArtifact(run, runBody);
  const taskPrevious = fs.readFileSync(taskArtifact.file, "utf8");
  const taskNext = transitionedArtifactContent(taskPrevious, "task", "running", date(), reassign ? identity : null);
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
  return withArtifactLock(path.join(projectRoot, ".scrumrun"), "create", () => retryTaskUnlocked(projectRoot, taskId, options));
}

function nextBacklogTask(repository) {
  const artifact = repository.list("task")
    .find((entry) => entry.record && !entry.errors.length && entry.record.status === "backlog");
  return artifact ? artifact.record : null;
}

function startBacklogTaskUnlocked(projectRoot, taskId, { note = "Backlog Task started.", failurePoint = null, interruptPoint = null } = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const recovered = recoverPendingTransactions(scrumDir);
  const repository = new ArtifactRepository(scrumDir);
  const taskArtifact = repository.read("task", taskId);
  if (!taskArtifact) throw new Error(`Task not found: ${taskId}`);
  if (taskArtifact.record.status !== "backlog") {
    throw new Error(`Task ${taskId} is ${taskArtifact.record.status}; start requires backlog.`);
  }
  const identity = agentIdentity(scrumDir) || "agent";
  const requestMatch = taskArtifact.body.match(/^## Request[ \t]*\r?\n\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  const request = requestMatch ? requestMatch[1].trim() : `Start ${taskId}`;
  const context = buildContextPackage(projectRoot, request);
  const policy = evaluatePolicy(context);
  if (policy.status !== "passed") throw new Error(`Start is blocked by current policy: ${policy.violations.join("; ")}`);
  const enforceablePolicy = policyState(projectRoot);
  const baseline = publicWorkspace(workspaceState(projectRoot));
  const run = {
    id: nextId(repository, "run"),
    kind: "run",
    status: "executing",
    created: date(),
    updated: date(),
    method: METHOD_VERSION,
    task: taskId,
    sprint: taskArtifact.record.sprint || null,
    branch: currentBranch(projectRoot),
    attempt: 1,
    ledger: 1,
    guardrails: 1,
    workspace: 1,
    execution: "session",
    approval_id: taskArtifact.record.approval_id || null
  };
  const runBody = createRunBody(run, {
    title: `Run for ${taskId}`,
    actor: identity,
    reason: note,
    evidence: [{ kind: "approval", summary: note }],
    obligations: policy.obligations || [],
    policyFingerprint: enforceablePolicy.fingerprint,
    workspaceBaseline: baseline
  }).body;
  const runContent = serializeArtifact(run, runBody);
  const taskPrevious = fs.readFileSync(taskArtifact.file, "utf8");
  const taskNext = transitionedArtifactContent(taskPrevious, "task", "running", date(), identity);
  try {
    runKernelTransaction(scrumDir, "start-backlog-task", [
      { file: repository.pathFor(run), previous: null, next: runContent },
      { file: taskArtifact.file, previous: taskPrevious, next: taskNext.content }
    ], {
      failurePoint: failurePoint === "after-run" ? "after-1" : failurePoint,
      interruptPoint
    });
  } catch (error) {
    if (failurePoint === "after-run") throw new Error(`Injected start failure after Run creation: ${error.message}`);
    throw error;
  }
  refreshState(scrumDir);
  return { run, task: taskNext.record, content: runContent, recovered };
}

function startBacklogTask(projectRoot, taskId, options = {}) {
  return withArtifactLock(path.join(projectRoot, ".scrumrun"), "create", () => startBacklogTaskUnlocked(projectRoot, taskId, options));
}

const ADDABLE_PLAN_KINDS = new Set(["task", "feature", "sprint"]);
const ADD_PLAN_DEFAULTS = Object.freeze({
  task: { status: "backlog", type: "task" },
  feature: { status: "backlog", type: "initiative" },
  sprint: { status: "proposed", type: null }
});
const ADD_PLAN_INITIAL_STATUS = Object.freeze({
  task: ["backlog", "proposed"],
  feature: ["backlog", "proposed"],
  sprint: ["proposed"]
});
const TASK_TYPES = new Set(["task", "fix", "docs", "discovery"]);

function planArtifactBody(kind, title, created) {
  const source = `- ${created}: created via CLI (\`scrumrun plan ${kind} --add\`).`;
  if (kind === "task") {
    return [
      `# ${title}`,
      "",
      "## Request",
      "",
      title,
      "",
      "## Acceptance Criteria",
      "",
      '- [ ] _Define what "done" means before execution._',
      "",
      "## Source",
      "",
      source
    ].join("\n");
  }
  if (kind === "feature") {
    return [
      `# ${title}`,
      "",
      "## Motivation",
      "",
      title,
      "",
      "## Exit criteria",
      "",
      '- [ ] _Define what success looks like._',
      "",
      "## Source",
      "",
      source
    ].join("\n");
  }
  return [
    `# ${title}`,
    "",
    "## Tasks",
    "",
    "_Pending: add Task ids here._",
    "",
    "## Exit Gate",
    "",
    '- [ ] _Define the batch completion condition._',
    "",
    "## Source",
    "",
    source
  ].join("\n");
}

function addPlanArtifactUnlocked(projectRoot, kind, label, { type = null, status = null } = {}) {
  if (!ADDABLE_PLAN_KINDS.has(kind)) throw new Error(`Unsupported plan kind: ${kind}`);
  const scrumDir = path.join(projectRoot, ".scrumrun");
  recoverPendingTransactions(scrumDir);
  const repository = new ArtifactRepository(scrumDir);
  const title = String(label || "").trim();
  if (!title) throw new Error(`A non-empty title is required for ${kind} --add.`);
  if (/\r|\n/.test(title)) throw new Error(`${kind} title must be one line.`);
  if (title.length > 200) throw new Error(`${kind} title exceeds the 200 character limit.`);
  if (containsSecret(title)) throw new Error("Secret-like content is forbidden outside the local vault.");
  const chosenStatus = status || ADD_PLAN_DEFAULTS[kind].status;
  if (!ADD_PLAN_INITIAL_STATUS[kind].includes(chosenStatus)) {
    throw new Error(`Invalid ${kind} status: ${chosenStatus}. Allowed for --add: ${ADD_PLAN_INITIAL_STATUS[kind].join(", ")}.`);
  }
  let chosenType = ADD_PLAN_DEFAULTS[kind].type;
  if (kind === "task" && type) {
    if (!TASK_TYPES.has(type)) throw new Error(`Invalid task --type: ${type}. Valid: ${[...TASK_TYPES].join(", ")}.`);
    chosenType = type;
  }
  const created = date();
  const record = {
    id: nextId(repository, kind),
    kind,
    status: chosenStatus,
    created,
    updated: created,
    method: METHOD_VERSION,
    branch: currentBranch(projectRoot)
  };
  if (kind === "task") {
    record.type = chosenType;
    record.feature = null;
    record.sprint = null;
  } else if (kind === "feature") {
    record.type = chosenType;
  }
  const body = planArtifactBody(kind, title, created);
  assertCanonicalWrite(projectRoot, `add-${kind}`, [title, body]);
  repository.write(record, body);
  return repository.read(kind, record.id);
}

function addPlanArtifact(projectRoot, kind, label, options = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const methodFile = path.join(scrumDir, "method.json");
  if (!fs.existsSync(methodFile) || !fs.lstatSync(methodFile).isFile()) {
    throw new Error(`ScrumRun project not found in ${projectRoot}. Run \`scrumrun init\` there, or run this command from inside the project.`);
  }
  return withArtifactLock(scrumDir, "create", () => addPlanArtifactUnlocked(projectRoot, kind, label, options));
}

module.exports = { addPlanArtifact, approveRequest, finalizeRun, nextBacklogTask, nextId, refreshErrors, refreshState, renderState, retryTask, startBacklogTask, stateFingerprint, stateIsStale, transitionRun };
