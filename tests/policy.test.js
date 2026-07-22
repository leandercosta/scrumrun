const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { auditProject } = require("../lib/v2/conformance");
const {
  configWeakeningAttempts,
  evaluatePolicy,
  normalizeGuardrailDocument,
  parseGuardrails,
  validateGuardrailDocument
} = require("../lib/runtime/policy-engine");
const { assessRisk, classifyRequest, planRequest } = require("../lib/runtime/request-engine");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");

function makeProject() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-policy-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: directory, stdio: "ignore" });
  return directory;
}

function context(guardrails, request = "Implement a bounded change", config = "Execution Approval: always") {
  return { guardrails: parseGuardrails(guardrails), request, config, warnings: [], layout: "v2" };
}

test("Policy Engine reports exact Guardrail ids and never treats deferred checks as passed", () => {
  const guardrails = [
    "## GR-101 - Protect secrets",
    "",
    "Status: active",
    "Enforcement: builtin:secret-boundary",
    "Rule: Never expose credentials.",
    "",
    "## GR-102 - Preserve architecture",
    "",
    "Status: active",
    "Enforcement: manual",
    "Rule: Keep domain boundaries explicit."
  ].join("\n");
  const safe = evaluatePolicy(context(guardrails));
  assert.equal(safe.status, "passed");
  assert.deepEqual(safe.checked, ["GR-101", "GR-102"]);
  assert.deepEqual(safe.deferred, ["GR-102"]);
  assert.equal(safe.evaluations.find((item) => item.guardrail === "GR-102").status, "deferred");

  const blocked = evaluatePolicy(context(guardrails, "Store api_key=super-secret-value-now"));
  assert.equal(blocked.status, "blocked");
  assert.match(blocked.violations[0], /^GR-101 SECRET_BOUNDARY:/);
});

test("Guardrail schema rejects duplicate ids, inactive-only policy, and unknown enforcement", () => {
  const invalid = [
    "## GR-201 - First",
    "Status: retired",
    "Enforcement: builtin:unknown",
    "Rule: First rule.",
    "",
    "## GR-201 - Duplicate",
    "Status: retired",
    "Rule: Duplicate rule."
  ].join("\n");
  const validation = validateGuardrailDocument(invalid);
  assert.ok(validation.errors.some((error) => error.includes("Duplicate Guardrail id")));
  assert.ok(validation.errors.some((error) => error.includes("unknown enforcement")));

  const project = makeProject();
  fs.writeFileSync(path.join(project, ".scrumrun", "guardrails.md"), "# Guardrails\n\n## GR-301 - Retired\n\nStatus: retired\nRule: Historical rule.\n");
  assert.ok(auditProject(project).findings.some((finding) => finding.code === "GUARDRAILS_INACTIVE"));
});

test("migrated prose uses conservative enforcement inference", () => {
  const records = parseGuardrails([
    "## GR-401 - Candidate knowledge needs review",
    "AI knowledge requires owner approval before confirmation.",
    "",
    "## GR-402 - Migration never guesses",
    "Migration preserves uncertain input."
  ].join("\n"));
  assert.equal(records[0].enforcement, "manual");
  assert.equal(records[1].enforcement, "builtin:migration-integrity");
});

test("legacy Guardrails normalize to explicit lossless policy fields", () => {
  const legacy = "# Guardrails\n\n## GR-401 - Preserve owner work\n\nNever overwrite owner work.\n";
  const normalized = normalizeGuardrailDocument(legacy);
  assert.match(normalized, /^Status: active$/m);
  assert.match(normalized, /^Enforcement: builtin:owner-work$/m);
  assert.match(normalized, /^Scope: all$/m);
  assert.match(normalized, /^Rule: Never overwrite owner work\.$/m);
  assert.match(normalized, /^Never overwrite owner work\.$/m);
});

test("configuration cannot weaken approval policy or declare unsafe read-only paths", () => {
  const violations = configWeakeningAttempts("Execution Approval: never\nRead-Only Paths: ../private, /etc\n");
  assert.ok(violations.some((message) => message.includes("Execution Approval")));
  assert.equal(violations.filter((message) => message.includes("unsafe path")).length, 2);

  const project = makeProject();
  fs.writeFileSync(path.join(project, ".scrumrun", "config.md"), "# Config\n\nExecution Approval: never\n");
  const audit = auditProject(project);
  assert.equal(audit.passed, false);
  assert.ok(audit.findings.some((finding) => finding.code === "CONFIG_WEAKENS_POLICY"));
  const plan = planRequest(project, "Implement a small change");
  assert.equal(plan.state, "blocked");
  assert.ok(plan.policy.violations.some((violation) => /^I-06 CONFIG_WEAKENS_POLICY:/.test(violation)));
});

test("configured read-only paths block intake with the responsible Guardrail id", () => {
  const project = makeProject();
  fs.appendFileSync(path.join(project, ".scrumrun", "config.md"), "\nRead-Only Paths: src/legacy\n");
  const plan = planRequest(project, "Refactor src/legacy/parser.js");
  assert.equal(plan.state, "blocked");
  assert.ok(plan.policy.violations.some((violation) => /^GR-003 READ_ONLY_PATH:/.test(violation)));
});

test("classification distinguishes implementation, documentation, fixes, initiatives, and Sprint batches", () => {
  const runtime = classifyRequest("Implementar migração do schema e transaction kernel; atualizar a documentação");
  assert.deepEqual([runtime.type, runtime.taskType], ["task", "task"]);
  assert.equal(assessRisk("Implementar migração do schema").level, "high");
  assert.equal(assessRisk("Adicionar transaction kernel à CLI").level, "medium");
  assert.equal(classifyRequest("Atualizar apenas o README e a documentação").taskType, "docs");
  assert.equal(classifyRequest("Corrigir regressão no parser").type, "fix");
  assert.equal(classifyRequest("Criar iniciativa de memória semântica").type, "feature");
  assert.equal(classifyRequest("Organizar Sprint timebox com cinco tarefas").type, "sprint");
  assert.equal(classifyRequest("Explicar o que é uma sprint").type, "task");
});

test("intake CLI exposes checked and deferred policy results without persisting artifacts", () => {
  const project = makeProject();
  const before = fs.readdirSync(path.join(project, ".scrumrun", "tasks"));
  const output = execFileSync(process.execPath, [bin, "sc", "plan", "intake", "Implement a bounded change"], { cwd: project, encoding: "utf8" });
  assert.match(output, /Policy: passed \(4 checked; 2 deferred\)/);
  assert.match(output, /DEFERRED: GR-002 OWNER_WORK:/);
  assert.deepEqual(fs.readdirSync(path.join(project, ".scrumrun", "tasks")), before);
});
