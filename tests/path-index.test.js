const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");

const bin = path.join(__dirname, "..", "bin", "scrumrun.js");
const { auditProject, INVARIANTS } = require("../lib/v2/conformance");
const { canonicalPaths, PATHS_SCHEMA_VERSION, renderMethodJson, flattenPaths } = require("../lib/v2/paths");

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-paths-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: dir, encoding: "utf8" });
  return dir;
}

test("I-23 is registered with the invariant catalog", () => {
  assert.ok(INVARIANTS.some((entry) => entry.id === "I-23"));
});

test("method.json path index is present, well-formed, and matches the canonical layout", () => {
  const dir = makeProject();
  try {
    const marker = JSON.parse(fs.readFileSync(path.join(dir, ".scrumrun", "method.json"), "utf8"));
    assert.equal(marker.paths_schema, PATHS_SCHEMA_VERSION);
    assert.deepEqual(marker.paths, canonicalPaths());
    const audit = auditProject(dir);
    assert.equal(audit.passed, true, JSON.stringify(audit.findings));
    const drift = audit.findings.some((finding) => ["METHOD_PATHS_MISSING", "METHOD_PATHS_DRIFT", "METHOD_PATHS_SCHEMA"].includes(finding.code));
    assert.equal(drift, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("conformance flags method.json missing the paths block", () => {
  const dir = makeProject();
  try {
    const marker = path.join(dir, ".scrumrun", "method.json");
    const original = JSON.parse(fs.readFileSync(marker, "utf8"));
    delete original.paths;
    delete original.paths_schema;
    fs.writeFileSync(marker, `${JSON.stringify(original, null, 2)}\n`);
    const audit = auditProject(dir);
    const missing = audit.findings.find((finding) => finding.code === "METHOD_PATHS_MISSING");
    assert.ok(missing, `expected METHOD_PATHS_MISSING, got ${audit.findings.map((f) => f.code).join(", ")}`);
    assert.equal(missing.severity, "high");
    assert.equal(audit.passed, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("conformance flags drift when a canonical path is renamed in method.json", () => {
  const dir = makeProject();
  try {
    const marker = path.join(dir, ".scrumrun", "method.json");
    const original = JSON.parse(fs.readFileSync(marker, "utf8"));
    original.paths.tasks = "custom-tasks/";
    original.paths.memory.knowledge = "memory/notes/";
    fs.writeFileSync(marker, `${JSON.stringify(original, null, 2)}\n`);
    const audit = auditProject(dir);
    const drifts = audit.findings.filter((finding) => finding.code === "METHOD_PATHS_DRIFT");
    assert.equal(drifts.length, 2);
    const labels = drifts.map((finding) => finding.message);
    assert.ok(labels.some((message) => message.includes("paths[tasks]")));
    assert.ok(labels.some((message) => message.includes("paths[memory.knowledge]")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("renderMethodJson emits the same structure the template ships with", () => {
  const rendered = JSON.parse(renderMethodJson({
    methodVersion: "2.0.0",
    schemas: { run_ledger: 1, guardrails: 1, run_obligations: 1, mutation_gateway: 1 }
  }));
  assert.equal(rendered.method, "2.0.0");
  assert.equal(rendered.layout, "v2");
  assert.equal(rendered.paths_schema, PATHS_SCHEMA_VERSION);
  assert.deepEqual(rendered.paths, canonicalPaths());
});

test("flattenPaths surfaces every leaf as a resolvable relative path", () => {
  const leaves = flattenPaths();
  const labels = leaves.map((entry) => entry.label);
  assert.ok(labels.includes("tasks"));
  assert.ok(labels.includes("runs"));
  assert.ok(labels.includes("memory.knowledge"));
  assert.ok(labels.includes("memory.decisions"));
  assert.ok(labels.includes("vault_local"));
  for (const entry of leaves) assert.equal(typeof entry.relative, "string");
});

test("v1-to-v2 migration output writes the same path index", () => {
  const source = fs.mkdtempSync(path.join(os.tmpdir(), "sr-paths-migrate-"));
  try {
    fs.mkdirSync(path.join(source, ".scrumrun"), { recursive: true });
    fs.writeFileSync(path.join(source, ".scrumrun", "backlog.md"), "# Sprint Backlog\n\n- Pending: none.\n");
    fs.writeFileSync(path.join(source, ".scrumrun", "golden-rules.md"), "# Golden rules\n\n1. Approval required before writes.\n");
    fs.writeFileSync(path.join(source, ".scrumrun", "core.md"), "# Legacy core\n");
    fs.writeFileSync(path.join(source, ".scrumrun", "config.md"), "# Config\n");
    fs.writeFileSync(path.join(source, ".scrumrun", "project.md"), "# Project\n");
    fs.writeFileSync(path.join(source, ".scrumrun", "context.md"), "# Legacy context\n");
    fs.mkdirSync(path.join(source, ".scrumrun", "goals", "main"), { recursive: true });
    fs.writeFileSync(path.join(source, ".scrumrun", "goals", "main", "sprint.md"), "# Sprint\n");
    fs.writeFileSync(path.join(source, ".scrumrun", "goals", "main", "history.md"), "# History\n");

    execFileSync(process.execPath, [bin, "migrate", "--to", "2", "--apply", "--force"], { cwd: source, encoding: "utf8", stdio: "pipe" });
    const marker = JSON.parse(fs.readFileSync(path.join(source, ".scrumrun", "method.json"), "utf8"));
    assert.equal(marker.paths_schema, PATHS_SCHEMA_VERSION);
    assert.deepEqual(marker.paths, canonicalPaths());
    assert.equal(marker.migration, "v1-to-v2");
  } finally {
    fs.rmSync(source, { recursive: true, force: true });
  }
});
