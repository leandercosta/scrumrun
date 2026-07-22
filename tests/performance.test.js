const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { performance } = require("node:perf_hooks");
const test = require("node:test");

const { indexStatus, queryIndex, rebuildIndex } = require("../lib/memory/index");
const { buildContextPackage } = require("../lib/runtime/context");
const { approveRequest, transitionRun } = require("../lib/runtime/orchestrator");
const { planRequest } = require("../lib/runtime/request-engine");
const { INDEX_STATUS_100_MAX_MS, KERNEL_LIFECYCLE_MAX_MS, LEAN_CONTROL_CONTEXT_MAX_CHARS, LEAN_CONTROL_CONTEXT_MAX_RATIO, V1_CONTROL_CONTEXT_BASELINE_CHARS } = require("../lib/runtime/budgets");
const { dryRunMigration } = require("../lib/v2/migration");

const bin = path.resolve(__dirname, "..", "bin", "scrumrun.js");

function initialized() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-perf-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: root, stdio: "ignore" });
  return root;
}

function elapsed(operation) {
  const start = performance.now();
  const value = operation();
  return { milliseconds: performance.now() - start, value };
}

test("lean context stays within twenty-five percent of the agreed v1 control baseline", () => {
  const root = initialized();
  const measured = elapsed(() => buildContextPackage(root, "Inspect pricing placement"));
  const control = JSON.stringify({ ...measured.value, request: "" }).length;
  assert.equal(LEAN_CONTROL_CONTEXT_MAX_RATIO, 0.25);
  assert.equal(LEAN_CONTROL_CONTEXT_MAX_CHARS, V1_CONTROL_CONTEXT_BASELINE_CHARS * 0.25);
  assert.ok(control <= LEAN_CONTROL_CONTEXT_MAX_CHARS, `${control} control chars exceeds ${LEAN_CONTROL_CONTEXT_MAX_CHARS}`);
  assert.ok(measured.milliseconds < 1000, `context build took ${measured.milliseconds.toFixed(1)}ms`);
});

test("startup, indexing, and retrieval stay inside release budgets", () => {
  const root = initialized();
  for (let index = 0; index < 120; index++) {
    const directory = path.join(root, "src", `module-${String(index).padStart(3, "0")}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "index.ts"), `export function calculateValue${index}(value: number) { return value + ${index}; }\n`);
  }
  const startup = elapsed(() => execFileSync(process.execPath, [bin, "--version"], { cwd: root, stdio: "pipe" }));
  const indexing = elapsed(() => rebuildIndex(root));
  const freshness = elapsed(() => {
    let status;
    for (let index = 0; index < 100; index++) status = indexStatus(root);
    return status;
  });
  const retrieval = elapsed(() => {
    let result;
    for (let index = 0; index < 20; index++) result = queryIndex(root, `calculateValue${index}`, { rebuild: false });
    return result;
  });
  assert.ok(startup.milliseconds < 2000, `CLI startup took ${startup.milliseconds.toFixed(1)}ms`);
  assert.ok(indexing.milliseconds < 5000, `index build took ${indexing.milliseconds.toFixed(1)}ms`);
  assert.equal(freshness.value.check, "metadata");
  assert.ok(freshness.milliseconds < INDEX_STATUS_100_MAX_MS, `100 index freshness checks took ${freshness.milliseconds.toFixed(1)}ms`);
  assert.ok(retrieval.milliseconds < 5000, `20 retrievals took ${retrieval.milliseconds.toFixed(1)}ms`);
  assert.ok(retrieval.value.results.length > 0);
});

test("migration projection dry-run stays bounded on a representative v1 project", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-migration-perf-"));
  const scrum = path.join(root, ".scrumrun");
  fs.mkdirSync(path.join(scrum, "goals", "main"), { recursive: true });
  fs.writeFileSync(path.join(scrum, "golden-rules.md"), "# Golden Rules\n\n1. Preserve data.\n");
  fs.writeFileSync(path.join(scrum, "goals", "main", "sprint.md"), `# Plan\n\n${Array.from({ length: 100 }, (_, index) => `## Sprint ${index + 1} - Task ${index + 1}\n\nGoal: bounded work ${index + 1}.\n`).join("\n")}`);
  const measured = elapsed(() => dryRunMigration(root));
  assert.equal(measured.value.status, "ready");
  assert.ok(measured.milliseconds < 3000, `migration dry-run took ${measured.milliseconds.toFixed(1)}ms`);
});

test("durable Task and Run lifecycle stays inside the mutation budget", () => {
  const root = initialized();
  const measured = elapsed(() => {
    const approved = approveRequest(root, planRequest(root, "Measure durable lifecycle").approvalToken);
    transitionRun(root, approved.run.id, "validating", { note: "Tests passed." });
    transitionRun(root, approved.run.id, "learning", { note: "Learning reviewed." });
    transitionRun(root, approved.run.id, "completed", { note: "Acceptance passed." });
  });
  assert.ok(measured.milliseconds < KERNEL_LIFECYCLE_MAX_MS, `durable lifecycle took ${measured.milliseconds.toFixed(1)}ms`);
});
