const assert = require("node:assert/strict");
const test = require("node:test");

const { sha256 } = require("../lib/v2/artifacts");
const {
  appendRunEvent,
  createRunBody,
  migrateLegacyRun,
  parseRunLedger,
  validateRunLedger
} = require("../lib/runtime/run-ledger");

function record(status = "executing", updated = "2026-07-22") {
  return {
    id: "RUN-001",
    kind: "run",
    status,
    created: "2026-07-22",
    updated,
    method: "2.0.0",
    task: "TASK-001",
    sprint: null,
    attempt: 1,
    ledger: 1
  };
}

test("Run ledger uses stable event ids, RFC3339 time, and structured evidence", () => {
  let current = record();
  let body = createRunBody(current, {
    approvalId: "approval-1",
    occurredAt: "2026-07-22T09:00:00.000Z"
  }).body;
  for (const [status, at, options] of [
    ["validating", "2026-07-22T09:10:00.000Z", { note: "Tests passed.", evidence: [{ kind: "test", summary: "npm test: 120 passed" }] }],
    ["learning", "2026-07-22T09:20:00.000Z", { note: "No reusable rule found.", evidence: [{ kind: "insight", ref: "INS:none" }] }],
    ["completed", "2026-07-22T09:30:00.000Z", { note: "Acceptance criteria passed.", evidence: [{ kind: "review", ref: "REV-001" }] }]
  ]) {
    const next = { ...current, status, updated: at.slice(0, 10) };
    body = appendRunEvent(current, body, next, { ...options, occurredAt: at }).body;
    current = next;
  }

  const result = validateRunLedger(current, body);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.events.map((event) => event.id), [
    "RUN-001-EVT-001",
    "RUN-001-EVT-002",
    "RUN-001-EVT-003",
    "RUN-001-EVT-004"
  ]);
  assert.equal(result.events[1].occurred_at, "2026-07-22T09:10:00.000Z");
  assert.equal(result.events[1].evidence[0].kind, "test");
});

test("Run ledger rejects missing evidence, broken chains, and frontmatter drift", () => {
  const current = record();
  const body = createRunBody(current, { occurredAt: "2026-07-22T09:00:00.000Z" }).body;
  const next = { ...current, status: "validating" };
  assert.throws(() => appendRunEvent(current, body, next), /requires a reason or structured evidence/);

  const transitioned = appendRunEvent(current, body, next, {
    note: "Tests passed.",
    occurredAt: "2026-07-22T09:10:00.000Z"
  }).body;
  const drift = validateRunLedger({ ...next, status: "learning" }, transitioned);
  assert.ok(drift.errors.some((error) => /disagrees with final event/.test(error)));

  const tampered = transitioned.replace('"from": "executing"', '"from": "learning"');
  assert.ok(validateRunLedger(next, tampered).errors.some((error) => /\.from must be executing/.test(error)));
});

test("legacy Run migration recovers deterministic transitions and snapshots ambiguity", () => {
  const legacyBody = `# Legacy run

## Transition Log

- 2026-07-22: created → executing — approved

## Transition 2026-07-22 · executing-to-validating

- tests passed
`;
  const legacyRecord = { ...record("validating"), ledger: undefined };
  const recovered = migrateLegacyRun(legacyRecord, legacyBody, {
    legacyHash: sha256(legacyBody),
    backupRef: ".scrumrun/.migration/run-ledger-v1/backup/runs/RUN-001.md"
  });
  assert.equal(recovered.mode, "transitions");
  assert.equal(recovered.events.length, 2);
  assert.deepEqual(validateRunLedger(recovered.record, recovered.body).errors, []);

  const ambiguousBody = "# Imported run\n\nHistorical prose only.\n";
  const snapshot = migrateLegacyRun({ ...record("completed"), ledger: undefined }, ambiguousBody, {
    legacyHash: sha256(ambiguousBody),
    backupRef: ".scrumrun/.migration/run-ledger-v1/backup/runs/RUN-001.md"
  });
  assert.equal(snapshot.mode, "snapshot");
  assert.equal(parseRunLedger(snapshot.body).events[0].type, "snapshot");
  assert.deepEqual(validateRunLedger(snapshot.record, snapshot.body).errors, []);
});

test("Run ledger rejects secret-like event content", () => {
  const current = record();
  const body = createRunBody(current, { occurredAt: "2026-07-22T09:00:00.000Z" }).body;
  assert.throws(() => appendRunEvent(current, body, { ...current, status: "failed" }, {
    note: "api_key=super-secret-value-now",
    occurredAt: "2026-07-22T09:10:00.000Z"
  }), /secret-like/);
});
