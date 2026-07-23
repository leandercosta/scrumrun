const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { renderRun, renderRunFromDisk, humanDuration, summarizeEvidence } = require("../lib/commands/run-render");
const { computeStats, renderStats } = require("../lib/commands/run-stats");

function withProject(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-render-"));
  const runsDir = path.join(dir, ".scrumrun", "runs");
  fs.mkdirSync(runsDir, { recursive: true });
  try {
    fn({ dir, runsDir });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function makeRunBody({ id, task, status, attempt = 1, sprint = null, feature = null, events }) {
  const front = [
    `id: ${id}`,
    `kind: run`,
    `status: ${status}`,
    `created: 2026-07-22`,
    `updated: 2026-07-22`,
    `method: 2.0.0`,
    `task: ${task}`,
    `sprint: ${sprint || "null"}`,
    ...(feature ? [`feature: ${feature}`] : []),
    `attempt: ${attempt}`,
    `ledger: 1`
  ].join("\n");
  const eventBlocks = events
    .map(
      (event) => `### ${event.id}\n\n\`\`\`json\n${JSON.stringify(event, null, 2)}\n\`\`\``
    )
    .join("\n\n");
  return `---\n${front}\n---\n\n# Run for ${task}\n\n## Events\n\n${eventBlocks}\n`;
}

test("renderRun produces a chronological timeline with headers and totals", () => {
  const body = makeRunBody({
    id: "RUN-100",
    task: "TASK-050",
    status: "completed",
    events: [
      {
        schema: 1,
        id: "RUN-100-EVT-001",
        sequence: 1,
        type: "transition",
        occurred_at: "2026-07-22T10:00:00.000Z",
        actor: "owner",
        from: "created",
        to: "executing",
        reason: "Approved.",
        evidence: [{ kind: "approval", ref: "approval:abc", summary: "ok" }]
      },
      {
        schema: 1,
        id: "RUN-100-EVT-002",
        sequence: 2,
        type: "transition",
        occurred_at: "2026-07-22T10:05:30.000Z",
        actor: "agent",
        from: "executing",
        to: "completed",
        reason: "Done.",
        evidence: [{ kind: "command", command: "npm test", result: "132 passed" }]
      }
    ]
  });

  const output = renderRun({ id: "RUN-100", file: "/tmp/RUN-100.md", body });
  assert.match(output, /RUN-100/);
  assert.match(output, /status completed/);
  assert.match(output, /task TASK-050/);
  assert.match(output, /created → executing/);
  assert.match(output, /executing → completed/);
  assert.match(output, /command: npm test → 132 passed/);
  assert.match(output, /2 events {3}span 5m 30s/);
});

test("renderRunFromDisk reads a run file from .scrumrun/runs", () => {
  withProject(({ dir, runsDir }) => {
    const body = makeRunBody({
      id: "RUN-001",
      task: "TASK-001",
      status: "executing",
      events: [
        {
          schema: 1,
          id: "RUN-001-EVT-001",
          sequence: 1,
          type: "transition",
          occurred_at: "2026-07-22T00:00:00.000Z",
          actor: "owner",
          from: "created",
          to: "executing",
          reason: "start",
          evidence: []
        }
      ]
    });
    fs.writeFileSync(path.join(runsDir, "RUN-001.md"), body);
    const output = renderRunFromDisk(dir, "RUN-001");
    assert.match(output, /1 event\b/);
    assert.throws(() => renderRunFromDisk(dir, "RUN-999"), /Run not found/);
  });
});

test("humanDuration formats seconds, minutes, and hours", () => {
  assert.equal(humanDuration("2026-07-22T10:00:00Z", "2026-07-22T10:00:30Z"), "30s");
  assert.equal(humanDuration("2026-07-22T10:00:00Z", "2026-07-22T10:05:30Z"), "5m 30s");
  assert.equal(humanDuration("2026-07-22T10:00:00Z", "2026-07-22T12:30:00Z"), "2h 30m");
});

test("summarizeEvidence flattens common evidence shapes", () => {
  const summarised = summarizeEvidence([
    { kind: "approval", ref: "approval:x", summary: "ok" },
    { kind: "command", command: "npm test", result: "132 passed" },
    { kind: "risk", summary: "watch out" }
  ]);
  assert.deepEqual(summarised, [
    "approval: approval:x — ok",
    "command: npm test → 132 passed",
    "risk: watch out"
  ]);
});

test("computeStats aggregates status, durations, retries, and guardrails", () => {
  withProject(({ dir, runsDir }) => {
    const events = (id, from, to, at) => ({
      schema: 1,
      id,
      sequence: Number(id.split("EVT-")[1]),
      type: "transition",
      occurred_at: at,
      actor: "agent",
      from,
      to,
      reason: "step",
      evidence: []
    });

    fs.writeFileSync(path.join(runsDir, "RUN-001.md"), makeRunBody({
      id: "RUN-001",
      task: "TASK-001",
      status: "failed",
      events: [
        events("RUN-001-EVT-001", "created", "executing", "2026-07-22T10:00:00Z"),
        events("RUN-001-EVT-002", "executing", "validating", "2026-07-22T10:10:00Z"),
        events("RUN-001-EVT-003", "validating", "failed", "2026-07-22T10:12:00Z")
      ]
    }));

    fs.writeFileSync(path.join(runsDir, "RUN-002.md"), makeRunBody({
      id: "RUN-002",
      task: "TASK-001",
      status: "completed",
      attempt: 2,
      events: [
        events("RUN-002-EVT-001", "created", "executing", "2026-07-22T11:00:00Z"),
        events("RUN-002-EVT-002", "executing", "validating", "2026-07-22T11:05:00Z"),
        events("RUN-002-EVT-003", "validating", "learning", "2026-07-22T11:06:00Z"),
        events("RUN-002-EVT-004", "learning", "completed", "2026-07-22T11:07:00Z"),
        {
          schema: 1,
          id: "RUN-002-EVT-005",
          sequence: 5,
          type: "guardrail",
          occurred_at: "2026-07-22T11:07:30Z",
          actor: "agent",
          status: "passed",
          guardrail: "GR-001",
          gate: "completion",
          reason: "checked",
          evidence: []
        }
      ]
    }));

    const summary = computeStats(dir);
    assert.equal(summary.total, 2);
    assert.equal(summary.byStatus.completed, 1);
    assert.equal(summary.byStatus.failed, 1);
    assert.equal(summary.attempts.max, 2);
    assert.equal(summary.attempts.byTask["TASK-001"], 2);
    assert.equal(summary.completionsWithFailurePredecessor, 1);
    assert.equal(summary.guardrails.passed, 1);
    assert.ok(summary.executing.p50 !== null);
    assert.ok(summary.validating.p50 !== null);

    const rendered = renderStats(summary);
    assert.match(rendered, /total runs {23}2/);
    assert.match(rendered, /completions after prior fail\s+1/);
    assert.match(rendered, /guardrail events passed\s+1/);
  });
});

test("computeStats filters by task", () => {
  withProject(({ dir, runsDir }) => {
    fs.writeFileSync(path.join(runsDir, "RUN-001.md"), makeRunBody({
      id: "RUN-001",
      task: "TASK-100",
      status: "completed",
      events: [{
        schema: 1,
        id: "RUN-001-EVT-001",
        sequence: 1,
        type: "transition",
        occurred_at: "2026-07-22T10:00:00Z",
        actor: "agent",
        from: "created",
        to: "executing",
        reason: "start",
        evidence: []
      }]
    }));
    fs.writeFileSync(path.join(runsDir, "RUN-002.md"), makeRunBody({
      id: "RUN-002",
      task: "TASK-200",
      status: "completed",
      events: [{
        schema: 1,
        id: "RUN-002-EVT-001",
        sequence: 1,
        type: "transition",
        occurred_at: "2026-07-22T11:00:00Z",
        actor: "agent",
        from: "created",
        to: "executing",
        reason: "start",
        evidence: []
      }]
    }));
    const scoped = computeStats(dir, { task: "TASK-100" });
    assert.equal(scoped.total, 1);
  });
});
