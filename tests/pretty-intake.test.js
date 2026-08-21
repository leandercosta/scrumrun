const assert = require("node:assert/strict");
const test = require("node:test");

const { canRenderPretty, renderIntake, renderIntakePlain } = require("../lib/commands/pretty-intake");

function fakePlan(overrides = {}) {
  return {
    state: "awaiting_approval",
    pipeline: ["received", "contextualizing", "policy", "risk", "classification", "planning", "awaiting_approval"],
    request: "Move calculateFinalPrice from utils to checkout",
    classification: { type: "task", reason: "structural move touches multiple call sites" },
    risk: { level: "medium", reasons: ["pricing surface"] },
    policy: {
      status: "passed",
      checked: ["GR-001", "GR-002", "GR-003", "GR-004", "GR-005", "GR-006", "GR-007", "GR-008"],
      deferred: ["GR-001", "GR-003"],
      violations: [],
      evaluations: [
        { guardrail: "GR-001", code: "OWNER_WORK", status: "deferred", message: "Owner-work preservation deferred until mutation." },
        { guardrail: "GR-003", code: "CANONICAL_WRITE", status: "deferred", message: "Canonical writes require the transaction gateway." }
      ]
    },
    context: { warnings: [] },
    approvalToken: "TKN-example-abc123",
    ...overrides
  };
}

function fakeBlockedPlan() {
  return fakePlan({
    state: "blocked",
    pipeline: ["received", "contextualizing", "policy", "risk", "blocked"],
    classification: { type: "reject", reason: "would violate GR-004" },
    risk: { level: "high", reasons: ["irreversible data loss"] },
    policy: {
      status: "blocked",
      checked: ["GR-004"],
      deferred: [],
      violations: ["GR-004 data destruction requires multi-step confirmation"],
      evaluations: []
    },
    approvalToken: null
  });
}

test("canRenderPretty respects NO_COLOR", () => {
  const originalNoColor = process.env.NO_COLOR;
  const originalForce = process.env.FORCE_COLOR;
  try {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
    const fakeTty = { isTTY: true };
    assert.equal(canRenderPretty(fakeTty), false);
  } finally {
    if (originalNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNoColor;
    if (originalForce === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = originalForce;
  }
});

test("canRenderPretty respects FORCE_COLOR override", () => {
  const originalForce = process.env.FORCE_COLOR;
  const originalNo = process.env.NO_COLOR;
  try {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    const nonTty = { isTTY: false };
    assert.equal(canRenderPretty(nonTty), true);
    process.env.FORCE_COLOR = "0";
    assert.equal(canRenderPretty({ isTTY: true }), false);
  } finally {
    if (originalForce === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = originalForce;
    if (originalNo === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNo;
  }
});

test("canRenderPretty falls back when stream is not a TTY", () => {
  const originalNo = process.env.NO_COLOR;
  const originalForce = process.env.FORCE_COLOR;
  try {
    delete process.env.NO_COLOR;
    delete process.env.FORCE_COLOR;
    assert.equal(canRenderPretty({ isTTY: false }), false);
    assert.equal(canRenderPretty({ isTTY: true }), true);
  } finally {
    if (originalNo === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = originalNo;
    if (originalForce === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = originalForce;
  }
});

test("renderIntakePlain is the exact Markdown format callers used to consume", () => {
  const plain = renderIntakePlain(fakePlan());
  assert.match(plain, /^# ScrumRun Intake$/m);
  assert.match(plain, /^State: awaiting_approval$/m);
  assert.match(plain, /^Classification: task \(/m);
  assert.match(plain, /^Risk: medium — pricing surface$/m);
  assert.match(plain, /^Policy: passed \(8 checked; 2 deferred\)$/m);
  assert.match(plain, /^DEFERRED: GR-001 OWNER_WORK: /m);
  assert.match(plain, /^Approval: scrumrun sc plan intake --approve TKN-example-abc123$/m);
});

test("renderIntakePlain marks blocked plans and skips the approval line", () => {
  const plain = renderIntakePlain(fakeBlockedPlan());
  assert.match(plain, /^State: blocked$/m);
  assert.match(plain, /^BLOCKED: GR-004 data destruction/m);
  assert.doesNotMatch(plain, /^Approval:/m);
});

test("renderIntake produces a box-drawn structured layout including the pipeline stages", () => {
  const output = renderIntake(fakePlan());
  const bare = output.replace(/\x1b\[[0-9;]*m/g, "");
  assert.ok(bare.includes("╭"));
  assert.ok(bare.includes("╰"));
  assert.ok(bare.includes("intake pipeline"));
  assert.ok(bare.includes("RECEIVED"));
  assert.ok(bare.includes("AWAITING_APPROVAL"));
  assert.ok(bare.includes("Task"));
  assert.ok(bare.includes("awaiting owner approval"));
  assert.match(output, /\x1b\[38;2;201;255;92m/, "acid lime truecolor must appear at least once");
});

test("renderIntake renders BLOCKED state with a red marker and no approval box", () => {
  const output = renderIntake(fakeBlockedPlan());
  const bare = output.replace(/\x1b\[[0-9;]*m/g, "");
  assert.ok(bare.includes("BLOCKED"));
  assert.ok(bare.includes("GR-004"));
  assert.ok(!bare.includes("awaiting owner approval"));
});

test("renderIntake renders a Preview field when plan.preview is set", () => {
  const output = renderIntake(fakePlan({ preview: "Rounding error in pricing.ts:28. Move Math.round after tax calc." }));
  const bare = output.replace(/\x1b\[[0-9;]*m/g, "");
  assert.ok(bare.includes("PREVIEW"), "pretty output must include a Preview field");
  assert.ok(bare.includes("Rounding error"), "preview text must appear in the output");
});

test("renderIntake omits Preview when plan.preview is null", () => {
  const output = renderIntake(fakePlan({ preview: null }));
  const bare = output.replace(/\x1b\[[0-9;]*m/g, "");
  assert.ok(!bare.includes("PREVIEW"), "no Preview field when preview is absent");
});

test("renderIntakePlain includes Preview when set", () => {
  const plain = renderIntakePlain(fakePlan({ preview: "Short technical summary." }));
  assert.match(plain, /^Preview: Short technical summary\.$/m);
});
