const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ArtifactRepository, METHOD_VERSION } = require("../lib/v2/artifacts");
const { inventoryTree } = require("../lib/v2/migration");
const {
  applyRunLedgerMigration,
  planRunLedgerMigration,
  rollbackRunLedgerMigration
} = require("../lib/v2/run-ledger-migration");
const { validateRunLedger } = require("../lib/runtime/run-ledger");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");

function earlyV2Project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-ledger-migrate-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: dir, stdio: "ignore" });
  const scrum = path.join(dir, ".scrumrun");
  fs.writeFileSync(path.join(scrum, "method.json"), `${JSON.stringify({ method: METHOD_VERSION, layout: "v2" }, null, 2)}\n`);
  const repository = new ArtifactRepository(scrum);
  const common = { created: "2026-07-22", updated: "2026-07-22", method: METHOD_VERSION };
  repository.write({ ...common, id: "TASK-001", kind: "task", type: "task", status: "validating", sprint: null }, "# Existing Task");
  repository.write({
    ...common,
    id: "RUN-001",
    kind: "run",
    status: "validating",
    task: "TASK-001",
    sprint: null,
    attempt: 1
  }, `# Existing Run

## Transition Log

- 2026-07-22: created → executing — approved

## Transition 2026-07-22 · executing-to-validating

- tests passed`);
  return dir;
}

test("Run ledger dry-run is read-only and apply keeps a byte-exact backup", () => {
  const dir = earlyV2Project();
  const scrum = path.join(dir, ".scrumrun");
  const before = inventoryTree(scrum);
  const original = fs.readFileSync(path.join(scrum, "runs", "RUN-001.md"));
  const plan = planRunLedgerMigration(dir);
  assert.equal(plan.status, "ready");
  assert.equal(inventoryTree(scrum).rootSha256, before.rootSha256);

  const applied = applyRunLedgerMigration(dir);
  assert.equal(applied.status, "applied");
  const repository = new ArtifactRepository(scrum);
  const run = repository.read("run", "RUN-001");
  assert.equal(run.record.ledger, 1);
  assert.deepEqual(validateRunLedger(run.record, run.body).errors, []);
  assert.deepEqual(
    fs.readFileSync(path.join(scrum, ".migration", "run-ledger-v1", "backup", "runs", "RUN-001.md")),
    original
  );
  assert.equal(JSON.parse(fs.readFileSync(path.join(scrum, "method.json"), "utf8")).schemas.run_ledger, 1);
  assert.equal(planRunLedgerMigration(dir).status, "current");
});

test("Run ledger migration failure and rollback restore exact source bytes", () => {
  const dir = earlyV2Project();
  const scrum = path.join(dir, ".scrumrun");
  const runFile = path.join(scrum, "runs", "RUN-001.md");
  const markerFile = path.join(scrum, "method.json");
  const runBefore = fs.readFileSync(runFile);
  const markerBefore = fs.readFileSync(markerFile);
  assert.throws(() => applyRunLedgerMigration(dir, { failurePoint: "after-1" }), /Injected Run ledger migration failure/);
  assert.deepEqual(fs.readFileSync(runFile), runBefore);
  assert.deepEqual(fs.readFileSync(markerFile), markerBefore);

  applyRunLedgerMigration(dir);
  rollbackRunLedgerMigration(dir);
  assert.deepEqual(fs.readFileSync(runFile), runBefore);
  assert.deepEqual(fs.readFileSync(markerFile), markerBefore);
});

test("ordinary update preflights an early v2 Run ledger without project writes", () => {
  const dir = earlyV2Project();
  const scrum = path.join(dir, ".scrumrun");
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-ledger-home-"));
  const before = inventoryTree(scrum);
  const output = execFileSync(process.execPath, [bin, "update", "codex"], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, HOME: home }
  });
  assert.match(output, /Project schema migration preflight/);
  assert.match(output, /project remains unchanged/i);
  assert.equal(inventoryTree(scrum).rootSha256, before.rootSha256);
});

test("Run ledger rollback refuses to erase later Run changes", () => {
  const dir = earlyV2Project();
  const runFile = path.join(dir, ".scrumrun", "runs", "RUN-001.md");
  applyRunLedgerMigration(dir);
  fs.appendFileSync(runFile, "\nOwner note after migration.\n");
  const changed = fs.readFileSync(runFile, "utf8");
  assert.throws(() => rollbackRunLedgerMigration(dir), /would erase post-migration changes/);
  assert.equal(fs.readFileSync(runFile, "utf8"), changed);
});

test("Run ledger migration rejects a symlinked recovery directory without source writes", (t) => {
  const dir = earlyV2Project();
  const scrum = path.join(dir, ".scrumrun");
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-ledger-outside-"));
  try {
    fs.symlinkSync(outside, path.join(scrum, ".migration"));
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.message}`);
    return;
  }
  const runFile = path.join(scrum, "runs", "RUN-001.md");
  const before = fs.readFileSync(runFile);
  assert.throws(() => applyRunLedgerMigration(dir), /Symbolic links are forbidden/);
  assert.deepEqual(fs.readFileSync(runFile), before);
  assert.deepEqual(fs.readdirSync(outside), []);
});
