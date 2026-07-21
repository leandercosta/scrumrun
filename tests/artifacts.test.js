const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  ARTIFACT_TYPES,
  ArtifactRepository,
  METHOD_VERSION,
  parseArtifact,
  serializeArtifact,
  transitionArtifact,
  validateArtifact
} = require("../lib/v2/artifacts");

const statuses = {
  feature: "active",
  task: "backlog",
  sprint: "proposed",
  run: "executing",
  review: "proposed",
  knowledge: "candidate",
  decision: "open",
  insight: "candidate",
  dossier: "active"
};

test("v2 artifact schemas round-trip every canonical kind", () => {
  for (const [kind, type] of Object.entries(ARTIFACT_TYPES)) {
    const record = {
      id: `${type.prefix}-001`,
      kind,
      status: statuses[kind],
      created: "2026-07-21",
      updated: "2026-07-21",
      method: METHOD_VERSION,
      custom_field: "preserved value",
      ...(kind === "run" ? { task: "TASK-001", attempt: 1 } : {})
    };
    const content = serializeArtifact(record, `# ${kind}\n\nBody.`);
    const parsed = parseArtifact(content);
    assert.deepEqual(parsed.errors, []);
    assert.deepEqual(validateArtifact(parsed.record, kind), []);
    assert.equal(parsed.record.custom_field, "preserved value");
    assert.match(parsed.body, new RegExp(`# ${kind}`));
  }
});

test("artifact repository refuses conflicting overwrite and unsafe ids", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-artifacts-"));
  const repository = new ArtifactRepository(path.join(dir, ".scrumrun"));
  const task = {
    id: "TASK-001",
    kind: "task",
    status: "backlog",
    created: "2026-07-21",
    updated: "2026-07-21",
    method: METHOD_VERSION
  };

  assert.equal(repository.write(task, "# First").status, "written");
  assert.equal(repository.write(task, "# First").status, "unchanged");
  assert.throws(() => repository.write(task, "# Different"), /already exists with different content/);
  assert.throws(() => repository.write({ ...task, id: "../TASK-002" }, "# Unsafe"), /invalid task id/i);
});

test("artifact validation enforces run relations and method version", () => {
  const errors = validateArtifact({
    id: "RUN-001",
    kind: "run",
    status: "executing",
    created: "2026-07-21",
    updated: "2026-07-21",
    method: "1.5.2"
  });
  assert.ok(errors.some((error) => error.includes("method must be 2.0.0")));
  assert.ok(errors.some((error) => error.includes("run.task")));
});

test("run state machine follows executing to validating to learning to completed", () => {
  let run = {
    id: "RUN-001",
    kind: "run",
    status: "executing",
    created: "2026-07-21",
    updated: "2026-07-21",
    method: METHOD_VERSION,
    task: "TASK-001",
    attempt: 1
  };
  run = transitionArtifact(run, "validating", "2026-07-21");
  run = transitionArtifact(run, "learning", "2026-07-21");
  run = transitionArtifact(run, "completed", "2026-07-21");
  assert.equal(run.status, "completed");
  assert.throws(() => transitionArtifact(run, "executing", "2026-07-21"), /Invalid run transition/);
});

test("artifact repository builds explicit Feature Task Sprint Run graph edges", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-graph-"));
  const repository = new ArtifactRepository(path.join(dir, ".scrumrun"));
  const common = { created: "2026-07-21", updated: "2026-07-21", method: METHOD_VERSION };
  repository.write({ ...common, id: "FEAT-001", kind: "feature", status: "active" }, "# Feature");
  repository.write({ ...common, id: "SPRINT-001", kind: "sprint", status: "running" }, "# Sprint");
  repository.write({ ...common, id: "TASK-001", kind: "task", status: "running", feature: "FEAT-001", sprint: "SPRINT-001" }, "# Task");
  repository.write({ ...common, id: "RUN-001", kind: "run", status: "executing", task: "TASK-001", sprint: "SPRINT-001", attempt: 1 }, "# Run");

  const graph = repository.graph();
  assert.equal(graph.nodes.length, 4);
  assert.ok(graph.edges.some((edge) => edge.from === "TASK-001" && edge.relation === "belongs_to" && edge.to === "FEAT-001"));
  assert.ok(graph.edges.some((edge) => edge.from === "TASK-001" && edge.relation === "included_in" && edge.to === "SPRINT-001"));
  assert.ok(graph.edges.some((edge) => edge.from === "RUN-001" && edge.relation === "executes" && edge.to === "TASK-001"));
});

test("repository transitions only status and updated while preserving unknown fields and body", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-transition-"));
  const repository = new ArtifactRepository(path.join(dir, ".scrumrun"));
  const task = {
    id: "TASK-001",
    kind: "task",
    status: "running",
    created: "2026-07-20",
    updated: "2026-07-20",
    method: METHOD_VERSION,
    custom_field: "keep this"
  };
  repository.write(task, "# Important body\n\nDo not rewrite this prose.");

  repository.transition("task", "TASK-001", "validating", "2026-07-21");

  const content = fs.readFileSync(repository.pathFor(task), "utf8");
  assert.match(content, /^status: validating$/m);
  assert.match(content, /^updated: 2026-07-21$/m);
  assert.match(content, /^custom_field: "keep this"$/m);
  assert.match(content, /# Important body\n\nDo not rewrite this prose\./);
});
