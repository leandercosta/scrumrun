const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");
const { ArtifactRepository, METHOD_VERSION } = require("../lib/v2/artifacts");
const { inventoryTree } = require("../lib/v2/migration");
const { buildContextPackage } = require("../lib/runtime/context");
const { parseRunLedger, validateRunLedger } = require("../lib/runtime/run-ledger");
const { planRequest } = require("../lib/runtime/request-engine");
const { approveRequest, retryTask, stateIsStale, transitionRun } = require("../lib/runtime/orchestrator");

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-runtime-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: dir, encoding: "utf8" });
  return dir;
}

function repository(dir) {
  return new ArtifactRepository(path.join(dir, ".scrumrun"));
}

test("intake builds bounded context without writing project data or exposing vault values", () => {
  const dir = makeProject();
  const repo = repository(dir);
  const common = { created: "2026-07-21", updated: "2026-07-21", method: METHOD_VERSION };
  repo.write({ ...common, id: "DEC-001", kind: "decision", status: "open" }, "# Keep pricing on the backend\n\nEvidence: src/pricing.js");
  fs.writeFileSync(path.join(dir, ".scrumrun", "vault.local.md"), "PRICE_API_KEY=never-render-this-value\n");
  const before = inventoryTree(path.join(dir, ".scrumrun"));

  const context = buildContextPackage(dir, "Refactor the pricing API without moving it to checkout");
  const plan = planRequest(dir, "Refactor the pricing API without moving it to checkout");

  assert.equal(inventoryTree(path.join(dir, ".scrumrun")).rootSha256, before.rootSha256);
  assert.equal(context.decisions.open[0].id, "DEC-001");
  assert.equal(context.graph.nodeCount, 1);
  assert.ok(context.guardrails.some((guardrail) => guardrail.id === "GR-001"));
  assert.doesNotMatch(JSON.stringify(context), /never-render-this-value/);
  assert.equal(plan.state, "awaiting_approval");
  assert.ok(plan.context.warnings.some((warning) => warning.includes("state.md") && warning.includes("stale")));
  assert.deepEqual(plan.pipeline, ["received", "contextualizing", "policy", "risk", "classification", "planning", "awaiting_approval"]);
  assert.equal(plan.risk.level, "high");
  assert.ok(plan.approvalToken);
});

test("blocked policy and secret-like requests never produce approval tokens", () => {
  const dir = makeProject();
  const plan = planRequest(dir, "Configure api_key=super-secret-value-now");
  assert.equal(plan.state, "blocked");
  assert.equal(plan.approvalToken, null);
  assert.ok(plan.policy.violations.some((violation) => violation.includes("secret")));
});

test("explicit approval creates exactly one linked Task and Run and is idempotent", () => {
  const dir = makeProject();
  const plan = planRequest(dir, "Fix the checkout regression");
  const first = approveRequest(dir, plan.approvalToken);
  const second = approveRequest(dir, plan.approvalToken);
  const repo = repository(dir);

  assert.equal(first.status, "approved");
  assert.equal(first.task.type, "fix");
  assert.equal(first.task.status, "running");
  assert.equal(first.run.status, "executing");
  assert.equal(first.run.task, first.task.id);
  assert.equal(second.status, "already-approved");
  assert.equal(repo.list("task").length, 1);
  assert.equal(repo.list("run").length, 1);
  assert.match(fs.readFileSync(path.join(dir, ".scrumrun", "state.md"), "utf8"), new RegExp(`${first.task.id}.*running`));
  assert.equal(stateIsStale(path.join(dir, ".scrumrun")), false);
  fs.appendFileSync(path.join(dir, ".scrumrun", "project.md"), "\nNew canonical context.\n");
  assert.equal(stateIsStale(path.join(dir, ".scrumrun")), true);
});

test("approval rejects tampered or stale plans without creating artifacts", () => {
  const dir = makeProject();
  const plan = planRequest(dir, "Add a bounded documentation task");
  assert.throws(() => approveRequest(dir, `${plan.approvalToken}x`), /modified/);
  fs.appendFileSync(path.join(dir, ".scrumrun", "project.md"), "\nChanged after intake.\n");
  assert.throws(() => approveRequest(dir, plan.approvalToken), /context changed/);
  assert.equal(repository(dir).list("task").length, 0);
  assert.equal(repository(dir).list("run").length, 0);
});

test("approval failure injection rolls back both canonical artifacts", () => {
  const dir = makeProject();
  const plan = planRequest(dir, "Implement a small docs update");
  assert.throws(() => approveRequest(dir, plan.approvalToken, { failurePoint: "after-task" }), /Injected approval failure/);
  assert.equal(repository(dir).list("task").length, 0);
  assert.equal(repository(dir).list("run").length, 0);
});

test("Run lifecycle synchronizes Task status and appends one canonical ledger event", () => {
  const dir = makeProject();
  const approved = approveRequest(dir, planRequest(dir, "Implement deterministic totals").approvalToken);
  transitionRun(dir, approved.run.id, "validating", { note: "Unit tests passed." });
  transitionRun(dir, approved.run.id, "learning", { note: "No reusable decision found." });
  const completed = transitionRun(dir, approved.run.id, "completed", { note: "Acceptance criteria passed." });
  const runArtifact = repository(dir).read("run", approved.run.id);
  const taskArtifact = repository(dir).read("task", approved.task.id);

  assert.equal(completed.run.status, "completed");
  assert.equal(completed.task.status, "completed");
  assert.equal(parseRunLedger(runArtifact.body).events.length, 4);
  assert.deepEqual(validateRunLedger(runArtifact.record, runArtifact.body).errors, []);
  assert.equal((taskArtifact.body.match(/^## Transition /gm) || []).length, 0);
  assert.match(runArtifact.body, /"from": "executing"/);
  assert.match(runArtifact.body, /"to": "completed"/);
});

test("paired transition failure restores both Run and Task byte-for-byte", () => {
  const dir = makeProject();
  const approved = approveRequest(dir, planRequest(dir, "Refactor one API adapter").approvalToken);
  const repo = repository(dir);
  const runFile = repo.pathFor(approved.run);
  const taskFile = repo.pathFor(approved.task);
  const runBefore = fs.readFileSync(runFile, "utf8");
  const taskBefore = fs.readFileSync(taskFile, "utf8");

  assert.throws(() => transitionRun(dir, approved.run.id, "validating", { note: "Tests passed.", failurePoint: "after-1" }), /Injected transition failure/);

  assert.equal(fs.readFileSync(runFile, "utf8"), runBefore);
  assert.equal(fs.readFileSync(taskFile, "utf8"), taskBefore);
});

test("retry creates a new Run and preserves the failed attempt", () => {
  const dir = makeProject();
  const approved = approveRequest(dir, planRequest(dir, "Fix a failing pricing test").approvalToken);
  transitionRun(dir, approved.run.id, "failed", { note: "Regression remains." });
  const firstBefore = fs.readFileSync(repository(dir).pathFor(approved.run), "utf8");
  const retried = retryTask(dir, approved.task.id);
  const runs = repository(dir).list("run");

  assert.equal(runs.length, 2);
  assert.equal(retried.run.attempt, 2);
  assert.equal(retried.run.status, "executing");
  assert.equal(retried.task.status, "running");
  assert.equal(fs.readFileSync(repository(dir).pathFor(approved.run), "utf8"), firstBefore);
});

test("CLI intake output can be explicitly approved and then advanced", () => {
  const dir = makeProject();
  const intake = execFileSync(process.execPath, [bin, "sc", "plan", "intake", "Document the API"], { cwd: dir, encoding: "utf8" });
  const token = (intake.match(/^Approval: .* --approve (.+)$/m) || [])[1];
  assert.ok(token);
  const approval = execFileSync(process.execPath, [bin, "sc", "plan", "intake", "--approve", token], { cwd: dir, encoding: "utf8" });
  const runId = (approval.match(/→ (RUN-\d+)/) || [])[1];
  assert.ok(runId);
  const validation = execFileSync(process.execPath, [bin, "sc", "plan", "run", "--validate", runId, "--test", "npm test passed"], { cwd: dir, encoding: "utf8" });
  assert.match(validation, new RegExp(`${runId}: validating`));
});
