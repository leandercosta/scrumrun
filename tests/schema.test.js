const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const { METHOD_VERSION: COMMAND_METHOD_VERSION } = require("../lib/commands/manifest");
const { validateArtifact } = require("../lib/v2/artifacts");
const {
  ARTIFACT_TRANSITIONS,
  ARTIFACT_TYPES,
  AUTHORITY,
  METHOD_VERSION,
  SCALAR_FIELDS,
  STRUCTURAL_RELATIONS,
  TRUTH_OWNERSHIP
} = require("../lib/v2/schema");
const { renderContract } = require("../scripts/generate-contract-docs");

test("one executable schema owns artifact identities, lifecycles, relations, and truth metadata", () => {
  assert.equal(COMMAND_METHOD_VERSION, METHOD_VERSION);
  assert.deepEqual(Object.keys(TRUTH_OWNERSHIP), Object.keys(ARTIFACT_TYPES));
  assert.equal(new Set(Object.values(ARTIFACT_TYPES).map((type) => type.directory)).size, Object.keys(ARTIFACT_TYPES).length);
  assert.ok(Object.isFrozen(ARTIFACT_TYPES));
  assert.ok(Object.isFrozen(ARTIFACT_TYPES.task.statuses));

  for (const [kind, type] of Object.entries(ARTIFACT_TYPES)) {
    assert.ok(type.initial.length, `${kind} must declare an initial status`);
    for (const status of type.initial) assert.ok(type.statuses.includes(status), `${kind}.${status} initial status is undeclared`);
    for (const [from, targets] of Object.entries(ARTIFACT_TRANSITIONS[kind] || {})) {
      assert.ok(type.statuses.includes(from), `${kind}.${from} transition source is undeclared`);
      for (const target of targets) assert.ok(type.statuses.includes(target), `${kind}.${target} transition target is undeclared`);
    }
    assert.ok(TRUTH_OWNERSHIP[kind].question.endsWith("?"));
    assert.ok(TRUTH_OWNERSHIP[kind].truth.length > 20);
  }

  for (const relation of Object.values(STRUCTURAL_RELATIONS)) {
    assert.ok(ARTIFACT_TYPES[relation.targetKind]);
    for (const kind of relation.requiredFor || []) assert.ok(ARTIFACT_TYPES[kind]);
  }
  assert.equal(STRUCTURAL_RELATIONS.task.cardinality, "0..1");
  assert.deepEqual(SCALAR_FIELDS.attempt, {
    kinds: ["run"],
    required: true,
    type: "positive integer",
    meaning: "monotonic execution-attempt number within one Task"
  });
});

test("kernel validation consumes structural cardinalities from the executable schema", () => {
  const run = {
    id: "RUN-001",
    kind: "run",
    status: "executing",
    created: "2026-07-21",
    updated: "2026-07-21",
    method: METHOD_VERSION
  };
  assert.ok(validateArtifact(run).includes("run must reference TASK-NNN or SPRINT-NNN"));
  assert.ok(validateArtifact({ ...run, task: "TASK-001" }).includes("run.attempt is required"));
  assert.deepEqual(validateArtifact({ ...run, task: "TASK-001", sprint: "SPRINT-001", attempt: 1 }), []);
  assert.ok(validateArtifact({ ...run, task: "FEAT-001", attempt: 1 }).includes("run.task must reference TASK-NNN or null"));
  assert.ok(validateArtifact({ ...run, task: "TASK-001", attempt: 0 }).includes("run.attempt must be a positive integer"));
});

test("generated schema documentation is exact and authority boundaries are complete", () => {
  const generated = fs.readFileSync(path.join(root, "docs", "SCHEMA.md"), "utf8");
  assert.equal(generated, renderContract());
  assert.deepEqual(Object.keys(AUTHORITY), ["semantics", "schema", "commands", "projectPolicy", "projectTruth", "projections"]);
  for (const rule of Object.values(AUTHORITY)) {
    assert.ok(rule.source);
    assert.ok(rule.scope);
  }
  const spec = fs.readFileSync(path.join(root, "SPEC.md"), "utf8");
  assert.match(spec, /semantics defer to SPEC/);
  assert.match(spec, /mechanically enforced values defer to the schema/);
  assert.match(spec, /grammar defers to the command manifest/);
});
