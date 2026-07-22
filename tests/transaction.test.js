const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ArtifactRepository } = require("../lib/v2/artifacts");
const { auditProject } = require("../lib/v2/conformance");
const { approveRequest, transitionRun } = require("../lib/runtime/orchestrator");
const { planRequest } = require("../lib/runtime/request-engine");
const {
  pendingTransactionStatus,
  recoverPendingTransactions,
  runKernelTransaction
} = require("../lib/v2/transaction");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");

function kernelFixture() {
  const scrum = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-kernel-"));
  fs.mkdirSync(path.join(scrum, "tasks"), { recursive: true });
  fs.mkdirSync(path.join(scrum, "runs"), { recursive: true });
  const task = path.join(scrum, "tasks", "TASK-001.md");
  const run = path.join(scrum, "runs", "RUN-001.md");
  fs.writeFileSync(task, "task-before\n");
  fs.writeFileSync(run, "run-before\n");
  return { scrum, task, run };
}

function changes(fixture) {
  return [
    { file: fixture.run, previous: "run-before\n", next: "run-after\n" },
    { file: fixture.task, previous: "task-before\n", next: "task-after\n" }
  ];
}

test("kernel transaction commits multiple files and leaves a hash-only receipt", () => {
  const fixture = kernelFixture();
  const result = runKernelTransaction(fixture.scrum, "transition-run-task", changes(fixture));
  assert.equal(result.status, "committed");
  assert.equal(fs.readFileSync(fixture.run, "utf8"), "run-after\n");
  assert.equal(fs.readFileSync(fixture.task, "utf8"), "task-after\n");
  assert.deepEqual(pendingTransactionStatus(fixture.scrum).pending, []);
  const receipts = fs.readdirSync(path.join(fixture.scrum, ".backup", "transactions", "receipts"));
  const receipt = fs.readFileSync(path.join(fixture.scrum, ".backup", "transactions", "receipts", receipts[0]), "utf8");
  assert.doesNotMatch(receipt, /run-before|run-after|task-before|task-after/);
  assert.match(receipt, /before_sha256/);
});

test("kernel transaction restores all files byte-for-byte on a captured failure", () => {
  const fixture = kernelFixture();
  assert.throws(() => runKernelTransaction(fixture.scrum, "transition-run-task", changes(fixture), { failurePoint: "after-1" }), /Injected transaction failure/);
  assert.equal(fs.readFileSync(fixture.run, "utf8"), "run-before\n");
  assert.equal(fs.readFileSync(fixture.task, "utf8"), "task-before\n");
  assert.deepEqual(pendingTransactionStatus(fixture.scrum).pending, []);
});

test("interrupted kernel transaction is recovered before the next canonical mutation", () => {
  const fixture = kernelFixture();
  assert.throws(() => runKernelTransaction(fixture.scrum, "transition-run-task", changes(fixture), { interruptPoint: "after-1" }), /Simulated interruption/);
  assert.equal(fs.readFileSync(fixture.run, "utf8"), "run-after\n");
  assert.equal(fs.readFileSync(fixture.task, "utf8"), "task-before\n");
  assert.equal(pendingTransactionStatus(fixture.scrum).pending.length, 1);

  const recovered = recoverPendingTransactions(fixture.scrum);
  assert.equal(recovered[0].action, "rolled-back");
  assert.equal(fs.readFileSync(fixture.run, "utf8"), "run-before\n");
  assert.equal(fs.readFileSync(fixture.task, "utf8"), "task-before\n");
  assert.deepEqual(pendingTransactionStatus(fixture.scrum).pending, []);
});

test("committed journal recovery verifies the new state instead of rolling it back", () => {
  const fixture = kernelFixture();
  assert.throws(() => runKernelTransaction(fixture.scrum, "transition-run-task", changes(fixture), { interruptPoint: "after-commit" }), /Simulated interruption/);
  const recovered = recoverPendingTransactions(fixture.scrum);
  assert.equal(recovered[0].action, "verified");
  assert.equal(fs.readFileSync(fixture.run, "utf8"), "run-after\n");
  assert.equal(fs.readFileSync(fixture.task, "utf8"), "task-after\n");
});

test("recovery refuses to overwrite owner changes made after interruption", () => {
  const fixture = kernelFixture();
  assert.throws(() => runKernelTransaction(fixture.scrum, "transition-run-task", changes(fixture), { interruptPoint: "after-1" }), /Simulated interruption/);
  fs.appendFileSync(fixture.run, "owner-change\n");
  assert.throws(() => recoverPendingTransactions(fixture.scrum), /without overwriting owner changes/);
  assert.match(fs.readFileSync(fixture.run, "utf8"), /owner-change/);
  assert.equal(pendingTransactionStatus(fixture.scrum).pending.length, 1);
});

test("recovery rejects a tampered journal before using its backup bytes", () => {
  const fixture = kernelFixture();
  assert.throws(() => runKernelTransaction(fixture.scrum, "transition-run-task", changes(fixture), { interruptPoint: "after-1" }), /Simulated interruption/);
  const pending = path.join(fixture.scrum, ".backup", "transactions", "pending");
  const journalFile = path.join(pending, fs.readdirSync(pending)[0]);
  const journal = JSON.parse(fs.readFileSync(journalFile, "utf8"));
  journal.changes[0].before.content_base64 = Buffer.from("tampered\n").toString("base64");
  fs.writeFileSync(journalFile, `${JSON.stringify(journal, null, 2)}\n`);
  assert.throws(() => recoverPendingTransactions(fixture.scrum), /content hash is invalid/);
  assert.equal(fs.readFileSync(fixture.run, "utf8"), "run-after\n");
});

test("Run transition retry recovers an interrupted pair before applying one event", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-kernel-runtime-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const approved = approveRequest(project, planRequest(project, "Implement one safe transition").approvalToken);
  assert.throws(() => transitionRun(project, approved.run.id, "validating", {
    note: "Tests passed.",
    interruptPoint: "after-1"
  }), /Simulated interruption/);
  const interruptedAudit = auditProject(project);
  assert.ok(interruptedAudit.findings.some((finding) => finding.code === "TRANSACTION_PENDING"));

  const result = transitionRun(project, approved.run.id, "validating", { note: "Tests passed." });
  assert.equal(result.run.status, "validating");
  assert.equal(result.task.status, "validating");
  assert.ok(result.recovered.some((item) => item.action === "rolled-back"));
  assert.equal(auditProject(project).passed, true);
  const repository = new ArtifactRepository(path.join(project, ".scrumrun"));
  assert.equal(repository.read("run", approved.run.id).record.status, "validating");
});

test("doctor is read-only by default and recovers only with explicit --recover", () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-kernel-doctor-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-kernel-home-"));
  const env = { ...process.env, HOME: home };
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, env, stdio: "ignore" });
  execFileSync(process.execPath, [bin, "install", "codex"], { cwd: project, env, stdio: "ignore" });
  const approved = approveRequest(project, planRequest(project, "Test explicit recovery").approvalToken);
  assert.throws(() => transitionRun(project, approved.run.id, "validating", {
    note: "Tests passed.",
    interruptPoint: "after-1"
  }), /Simulated interruption/);
  let before = "";
  assert.throws(() => execFileSync(process.execPath, [bin, "doctor", "codex", "--strict"], {
    cwd: project,
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }), (error) => {
    before = `${error.stdout || ""}${error.stderr || ""}`;
    return true;
  });
  assert.match(before, /TRANSACTION_PENDING/);
  assert.equal(pendingTransactionStatus(path.join(project, ".scrumrun")).pending.length, 1);

  const after = execFileSync(process.execPath, [bin, "doctor", "codex", "--recover", "--strict"], {
    cwd: project,
    env,
    encoding: "utf8"
  });
  assert.match(after, /recovered TXN-/);
  assert.match(after, /project audit: 0 finding/);
  assert.deepEqual(pendingTransactionStatus(path.join(project, ".scrumrun")).pending, []);
});
