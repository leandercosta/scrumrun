const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { nouns } = require("../lib/commands/manifest");
const { ARTIFACT_TRANSITIONS, ARTIFACT_TYPES, METHOD_VERSION } = require("../lib/v2/artifacts");
const { INVARIANTS, auditProject } = require("../lib/v2/conformance");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");

function read(relative) {
  return fs.readFileSync(path.join(root, relative), "utf8");
}

test("SPEC, CORE, README, skill, templates, and package declare one v2 contract", () => {
  assert.equal(METHOD_VERSION, "2.0.0");
  assert.equal(require("../package.json").engines.node, ">=22.13.0");
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

test("all twenty normative invariants point to executable test evidence", () => {
  const specIds = [...read("SPEC.md").matchAll(/\*\*(I-\d{2})\*\*/g)].map((match) => match[1]);
  assert.deepEqual(specIds, Array.from({ length: 20 }, (_, index) => `I-${String(index + 1).padStart(2, "0")}`));
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
  assert.equal(audit.invariants, 20);
  const cli = JSON.parse(execFileSync(process.execPath, [bin, "sc", "review", "artifact", "--run"], { cwd: project, encoding: "utf8" }));
  assert.equal(cli.passed, true);

  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-conformance-outside-"));
  fs.rmSync(path.join(project, ".scrumrun", "tasks"), { recursive: true });
  fs.symlinkSync(outside, path.join(project, ".scrumrun", "tasks"));
  const unsafe = auditProject(project);
  assert.equal(unsafe.passed, false);
  assert.ok(unsafe.findings.some((finding) => finding.code === "ARTIFACT_PATH"));
});
