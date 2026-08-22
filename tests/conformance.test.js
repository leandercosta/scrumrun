const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { nouns } = require("../lib/commands/manifest");
const { ArtifactRepository } = require("../lib/v2/artifacts");
const { ARTIFACT_TRANSITIONS, ARTIFACT_TYPES, METHOD_VERSION } = require("../lib/v2/schema");
const { INVARIANTS, auditProject } = require("../lib/v2/conformance");
const { planRequest } = require("../lib/runtime/request-engine");
const { addPlanArtifact, approveRequest, nextBacklogTask, retryTask, startBacklogTask, transitionRun } = require("../lib/runtime/orchestrator");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

test("SPEC, CORE, README, skill, templates, and package declare one v2 contract", () => {
  assert.equal(METHOD_VERSION, "2.0.0");
  const packageMetadata = require("../package.json");
  assert.match(packageMetadata.version, /^\d+\.\d+\.\d+$/, "package.json version must be valid semver");
  assert.equal(packageMetadata.engines.node, ">=22.13.0");
  const versionEscaped = packageMetadata.version.replace(/\./g, "\\.");
  assert.match(read("README.md"), new RegExp(`Package:\\*\\* \`${versionEscaped}\``), "README badge must match package.json version");
  for (const file of ["SPEC.md", "CORE.md", "README.md", "templates/shared/skills/scrumrun/SKILL.md"]) {
    const content = read(file);
    assert.match(content, /2\.0(?:\.0)?/, `${file} must declare v2`);
    assert.match(content, /Feature/);
    assert.match(content, /Task/);
    assert.match(content, /Sprint/);
    assert.match(content, /Run/);
    assert.match(content, /guardrails\.md/);
    assert.doesNotMatch(content, /Version: `method 1\.0`|Six nouns/);
  }
  assert.deepEqual(Object.keys(nouns), ["plan", "knowledge", "rules", "review", "config"]);
  assert.equal(JSON.parse(read("templates/project/.scrumrun/method.json")).method, METHOD_VERSION);
  for (const directory of ["features", "tasks", "sprints", "runs", "reviews", "memory/knowledge", "memory/decisions", "memory/insights", "memory/dossiers"]) {
    assert.equal(fs.statSync(path.join(root, "templates", "project", ".scrumrun", directory)).isDirectory(), true);
  }
  for (const legacy of ["golden-rules.md", "backlog.md", "fixes.md", "knowledge.md"]) {
    assert.equal(fs.existsSync(path.join(root, "templates", "project", ".scrumrun", legacy)), false);
  }
  const legacyGoals = path.join(root, "templates", "project", ".scrumrun", "goals");
  if (fs.existsSync(legacyGoals)) assert.deepEqual(fs.readdirSync(path.join(legacyGoals, "main")), []);
});

test("every declared transition starts and ends in the schema for its kind", () => {
  for (const [kind, transitions] of Object.entries(ARTIFACT_TRANSITIONS)) {
    const statuses = new Set(ARTIFACT_TYPES[kind].statuses);
    for (const [from, targets] of Object.entries(transitions)) {
      assert.ok(statuses.has(from), `${kind}.${from} is not a declared status`);
      for (const target of targets) assert.ok(statuses.has(target), `${kind}.${from} targets unknown ${target}`);
      assert.equal(new Set(targets).size, targets.length, `${kind}.${from} contains duplicate transitions`);
    }
  }
});

test("all twenty-four normative invariants point to executable test evidence", () => {
  const specIds = [...read("SPEC.md").matchAll(/\*\*(I-\d{2})\*\*/g)].map((match) => match[1]);
  assert.deepEqual(specIds, Array.from({ length: 24 }, (_, index) => `I-${String(index + 1).padStart(2, "0")}`));
  assert.deepEqual(INVARIANTS.map((item) => item.id), specIds);
  const testSources = fs.readdirSync(path.join(root, "tests"))
    .filter((name) => name.endsWith(".test.js"))
    .map((name) => fs.readFileSync(path.join(root, "tests", name), "utf8"))
    .join("\n");
  for (const invariant of INVARIANTS) {
    assert.ok(invariant.tests.length, `${invariant.id} has no evidence`);
    for (const evidence of invariant.tests) assert.ok(testSources.includes(evidence), `${invariant.id} missing executable evidence: ${evidence}`);
  }
});

test("artifact conformance review passes a clean v2 project and fails unsafe canonical paths", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-conformance-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const audit = auditProject(project);
  assert.equal(audit.passed, true, JSON.stringify(audit.findings));
  assert.equal(audit.invariants, 24);
  const cli = JSON.parse(execFileSync(process.execPath, [bin, "sc", "review", "artifact", "--run"], { cwd: project, encoding: "utf8" }));
  assert.equal(cli.passed, true);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-conformance-outside-"));
  fs.rmSync(path.join(project, ".scrumrun", "tasks"), { recursive: true });
  fs.symlinkSync(outside, path.join(project, ".scrumrun", "tasks"));
  const unsafe = auditProject(project);
  assert.equal(unsafe.passed, false);
  assert.ok(unsafe.findings.some((finding) => finding.code === "ARTIFACT_PATH"));
});

test("artifact conformance enforces Run attempts, Task/Sprint agreement, and Sprint membership projection", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-conformance-relations-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const repository = new ArtifactRepository(path.join(project, ".scrumrun"));
  const common = { created: "2026-07-21", updated: "2026-07-21", method: METHOD_VERSION };
  repository.write({ ...common, id: "SPRINT-001", kind: "sprint", status: "running" }, "# Batch\n\n## Tasks\n\n- TASK-999");
  repository.write({ ...common, id: "TASK-001", kind: "task", status: "running", sprint: "SPRINT-001" }, "# Work");
  repository.write({ ...common, id: "RUN-001", kind: "run", status: "executing", task: "TASK-001", sprint: null, attempt: 1 }, "# First attempt");
  repository.write({ ...common, id: "RUN-002", kind: "run", status: "executing", task: "TASK-001", sprint: "SPRINT-001", attempt: 3 }, "# Third attempt");

  const audit = auditProject(project);
  assert.equal(audit.passed, false);
  assert.ok(audit.findings.some((finding) => finding.code === "RUN_SPRINT_MISMATCH"));
  assert.ok(audit.findings.some((finding) => finding.code === "RUN_ATTEMPT_SEQUENCE"));
  assert.ok(audit.findings.some((finding) => finding.code === "SPRINT_MEMBERSHIP_MISMATCH"));
});

test("artifact conformance validates Run event continuity, evidence, and final status", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-conformance-ledger-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const approved = approveRequest(project, planRequest(project, "Implement deterministic totals").approvalToken);
  transitionRun(project, approved.run.id, "validating", { note: "Unit tests passed." });
  assert.equal(auditProject(project).passed, true);

  const repository = new ArtifactRepository(path.join(project, ".scrumrun"));
  const run = repository.read("run", approved.run.id);
  const content = fs.readFileSync(run.file, "utf8").replace('"from": "executing",\n  "to": "validating"', '"from": "learning",\n  "to": "validating"');
  fs.writeFileSync(run.file, content);
  const audit = auditProject(project);
  assert.equal(audit.passed, false);
  assert.ok(audit.findings.some((finding) => finding.code === "RUN_LEDGER_INVALID" && /\.from must be executing/.test(finding.message)));
});

test("approved Task body includes Acceptance Criteria section", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-acceptance-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const approved = approveRequest(project, planRequest(project, "Fix pricing rounding").approvalToken);
  const repository = new ArtifactRepository(path.join(project, ".scrumrun"));
  const task = repository.read("task", approved.task.id);
  assert.match(task.body, /## Acceptance Criteria/);
});

test("conformance warns when an active Task lacks Acceptance Criteria", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-acceptance-warn-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const repository = new ArtifactRepository(path.join(project, ".scrumrun"));
  const common = { created: "2026-07-21", updated: "2026-07-21", method: METHOD_VERSION };
  repository.write({ ...common, id: "TASK-001", kind: "task", status: "running" }, "# Work\n\nNo criteria here.");
  const audit = auditProject(project);
  assert.ok(audit.findings.some((f) => f.code === "ACCEPTANCE_CRITERIA_MISSING" && f.severity === "warning"));
});

test("completing a Run with --summary stores it and context surfaces it", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-summary-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const approved = approveRequest(project, planRequest(project, "Move pricing to checkout").approvalToken);
  transitionRun(project, approved.run.id, "validating", { note: "Tests passed.", evidence: [{ kind: "test", summary: "npm test: passed" }] });
  transitionRun(project, approved.run.id, "learning", { note: "No new insights.", evidence: [{ kind: "insight", ref: "INS:none" }] });
  const summaryText = "Moved calculateFinalPrice to checkout/pricing.ts and updated 3 call sites.";
  transitionRun(project, approved.run.id, "completed", { note: "Done.", evidence: [{ kind: "review", ref: "REV-001" }], summary: summaryText });
  const repository = new ArtifactRepository(path.join(project, ".scrumrun"));
  const run = repository.read("run", approved.run.id);
  assert.match(run.body, /## Technical Summary/);
  const { buildContextPackage } = require("../lib/runtime/context");
  const context = buildContextPackage(project, "Next task: update tax calculation");
  assert.ok(context.history.recentSummaries && context.history.recentSummaries.length, "context should surface recent technical summaries");
  assert.equal(context.history.recentSummaries[0].run, approved.run.id);
  assert.ok(context.history.recentSummaries[0].summary.includes("Moved calculateFinalPrice"));
});

test("--type override sets the classification explicitly", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-type-override-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const plan = planRequest(project, "Redesign the pricing module", { typeOverride: "feature" });
  assert.equal(plan.classification.taskType, "feature");
  assert.equal(plan.classification.reason, "explicitly specified by agent");
});

test("--type override rejects invalid values", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-type-invalid-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  assert.throws(() => planRequest(project, "Some work", { typeOverride: "bogus" }), /Invalid --type/);
});

test("--preview is stored in the plan and Task body after approval", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-preview-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const previewText = "Rounding error in checkout/pricing.ts:28. Move Math.round after tax calc.";
  const plan = planRequest(project, "Fix pricing rounding", { preview: previewText });
  assert.equal(plan.preview, previewText);
  const approved = approveRequest(project, plan.approvalToken);
  const repository = new ArtifactRepository(path.join(project, ".scrumrun"));
  const task = repository.read("task", approved.task.id);
  assert.match(task.body, /## Preview/);
  assert.ok(task.body.includes(previewText));
});

test("--preview rejects secret-like content", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-preview-secret-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  assert.throws(() => planRequest(project, "Fix auth", { preview: "api_key=super-secret-value" }), /secret-like/);
});

test("state.md is a structured briefing with progressive disclosure pointers", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-briefing-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const stateContent = fs.readFileSync(path.join(project, ".scrumrun", "state.md"), "utf8");
  assert.match(stateContent, /^# ScrumRun Briefing/m);
  assert.match(stateContent, /## Now/);
  assert.match(stateContent, /## Recent/);
  assert.match(stateContent, /## Where to look/);
  assert.match(stateContent, /Progressive disclosure/);
  assert.match(stateContent, /Source fingerprint:\s*[a-f0-9]{64}/);
  assert.match(stateContent, /Watch fingerprint:\s*[a-f0-9]{64}/);
});

test("briefing surfaces active work and technical summaries after completion", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-briefing-work-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const approved = approveRequest(project, planRequest(project, "Move pricing to checkout").approvalToken);
  transitionRun(project, approved.run.id, "validating", { note: "Tests passed.", evidence: [{ kind: "test", summary: "passed" }] });
  transitionRun(project, approved.run.id, "learning", { note: "Done.", evidence: [{ kind: "insight", ref: "INS:none" }] });
  transitionRun(project, approved.run.id, "completed", { note: "Done.", evidence: [{ kind: "review", ref: "REV-001" }], summary: "Moved calculateFinalPrice to checkout and updated 3 call sites." });
  const stateContent = fs.readFileSync(path.join(project, ".scrumrun", "state.md"), "utf8");
  assert.ok(stateContent.includes("Moved calculateFinalPrice to checkout"), "briefing should include technical summary");
  assert.match(stateContent, /## Where to look/);
});

test("context package includes a briefing field for agents", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-briefing-context-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const { buildContextPackage } = require("../lib/runtime/context");
  const context = buildContextPackage(project, "Next task");
  assert.ok(context.briefing, "context package must include a briefing field");
  assert.match(context.briefing, /ScrumRun Briefing/);
  assert.match(context.briefing, /## Now/);
});

test("nextBacklogTask returns the oldest backlog Task", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-next-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const repository = new ArtifactRepository(path.join(project, ".scrumrun"));
  const common = { created: "2026-07-21", updated: "2026-07-21", method: METHOD_VERSION };
  repository.write({ ...common, id: "TASK-001", kind: "task", status: "backlog" }, "# First\n\n## Request\n\nDo first thing.");
  repository.write({ ...common, id: "TASK-002", kind: "task", status: "backlog" }, "# Second\n\n## Request\n\nDo second thing.");
  const next = nextBacklogTask(repository);
  assert.equal(next.id, "TASK-001", "oldest backlog task first");
});

test("startBacklogTask promotes the Task and creates a Run with assignee", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-start-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const repository = new ArtifactRepository(path.join(project, ".scrumrun"));
  const common = { created: "2026-07-21", updated: "2026-07-21", method: METHOD_VERSION };
  repository.write({ ...common, id: "TASK-001", kind: "task", status: "backlog" }, "# Fix pricing\n\n## Request\n\nFix pricing rounding.");
  const result = startBacklogTask(project, "TASK-001");
  assert.equal(result.task.status, "running");
  assert.equal(result.run.task, "TASK-001");
  assert.equal(result.run.attempt, 1);
  assert.ok(result.task.assignee, "task should carry an assignee");
  assert.equal(repository.list("run").length, 1);
});

test("startBacklogTask rejects a Task that is not backlog", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-start-invalid-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const repository = new ArtifactRepository(path.join(project, ".scrumrun"));
  const common = { created: "2026-07-21", updated: "2026-07-21", method: METHOD_VERSION };
  repository.write({ ...common, id: "TASK-001", kind: "task", status: "running" }, "# Running\n\n## Request\n\nAlready started.");
  assert.throws(() => startBacklogTask(project, "TASK-001"), /requires backlog/);
});

test("addPlanArtifact creates backlog tasks with sequential ids and no Run", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-add-task-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const repository = new ArtifactRepository(path.join(project, ".scrumrun"));

  const first = addPlanArtifact(project, "task", "Fix login bug");
  assert.equal(first.record.id, "TASK-001");
  assert.equal(first.record.status, "backlog");
  assert.equal(first.record.type, "task");
  assert.match(first.body, /## Acceptance Criteria/);

  const second = addPlanArtifact(project, "task", "Crash on empty input", { type: "fix" });
  assert.equal(second.record.id, "TASK-002");
  assert.equal(second.record.type, "fix");
  assert.equal(repository.list("run").length, 0, "add must not create a Run");
});

test("addPlanArtifact supports feature and sprint with their initial statuses", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-add-plan-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const repository = new ArtifactRepository(path.join(project, ".scrumrun"));

  const feature = addPlanArtifact(project, "feature", "Onboarding v2");
  assert.equal(feature.record.id, "FEAT-001");
  assert.equal(feature.record.status, "backlog");
  assert.equal(feature.record.type, "initiative");

  const sprint = addPlanArtifact(project, "sprint", "Sprint 01");
  assert.equal(sprint.record.id, "SPRINT-001");
  assert.equal(sprint.record.status, "proposed");
});

test("addPlanArtifact rejects invalid input and out-of-band statuses", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-add-invalid-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  assert.throws(() => addPlanArtifact(project, "task", ""), /non-empty title/);
  assert.throws(() => addPlanArtifact(project, "task", "X", { type: "nope" }), /Invalid task --type/);
  assert.throws(() => addPlanArtifact(project, "task", "X", { status: "running" }), /Invalid task status/);
  assert.throws(() => addPlanArtifact(project, "run", "X"), /Unsupported plan kind/);
});

test("agentIdentity resolves from environment and config.md", () => {
  const { agentIdentity } = require("../lib/runtime/policy-engine");
  const original = process.env.SCRUMRUN_AGENT;
  try {
    process.env.SCRUMRUN_AGENT = "codex";
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-identity-"));
    execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
    assert.equal(agentIdentity(path.join(project, ".scrumrun")), "codex");
    delete process.env.SCRUMRUN_AGENT;
    assert.equal(agentIdentity(path.join(project, ".scrumrun")), "agent", "template default identity when env is unset");
    fs.appendFileSync(path.join(project, ".scrumrun", "config.md"), "\nAgent Identity: claude-code\n");
    assert.equal(agentIdentity(path.join(project, ".scrumrun")), "claude-code");
  } finally {
    if (original === undefined) delete process.env.SCRUMRUN_AGENT;
    else process.env.SCRUMRUN_AGENT = original;
  }
});

test("approved Task records the agent identity as assignee", () => {
  const original = process.env.SCRUMRUN_AGENT;
  try {
    process.env.SCRUMRUN_AGENT = "codex";
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-assignee-"));
    execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
    const approved = approveRequest(project, planRequest(project, "Fix pricing").approvalToken);
    assert.equal(approved.task.assignee, "codex");
  } finally {
    if (original === undefined) delete process.env.SCRUMRUN_AGENT;
    else process.env.SCRUMRUN_AGENT = original;
  }
});

test("retry rejects a Task assigned to another agent unless reassigned", () => {
  const original = process.env.SCRUMRUN_AGENT;
  try {
    process.env.SCRUMRUN_AGENT = "codex";
    const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-retry-gate-"));
    execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
    const approved = approveRequest(project, planRequest(project, "Fix pricing rounding").approvalToken);
    transitionRun(project, approved.run.id, "failed", { note: "Failed." });
    assert.equal(approved.task.assignee, "codex");

    process.env.SCRUMRUN_AGENT = "claude";
    assert.throws(() => retryTask(project, approved.task.id), /assigned to codex/);

    const retried = retryTask(project, approved.task.id, { reassign: true });
    assert.equal(retried.task.assignee, "claude", "reassign transfers ownership to the retrier");
  } finally {
    if (original === undefined) delete process.env.SCRUMRUN_AGENT;
    else process.env.SCRUMRUN_AGENT = original;
  }
});
