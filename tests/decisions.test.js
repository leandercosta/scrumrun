const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");

function makeProject({ lean = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-decisions-"));
  const args = ["init", "--force"];
  if (lean) args.push("--lean");
  execFileSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" });
  return dir;
}

function decisionsPath(dir) {
  return path.join(dir, ".scrumrun", "goals", "main", "decisions.md");
}

function writeDecisions(dir, content) {
  fs.mkdirSync(path.dirname(decisionsPath(dir)), { recursive: true });
  fs.writeFileSync(decisionsPath(dir), content);
}

function readDecisions(dir) {
  return fs.readFileSync(decisionsPath(dir), "utf8");
}

test("decisions --add creates a D-NNN decision with new id and bullet format fallback", () => {
  const dir = makeProject({ lean: true });
  fs.mkdirSync(path.join(dir, ".scrumrun", "goals", "main"), { recursive: true });

  execFileSync(process.execPath, [bin, "decisions", "--add", "Use Postgres for primary DB"], { cwd: dir, encoding: "utf8" });

  const content = readDecisions(dir);
  assert.match(content, /### D-001 - Use Postgres for primary DB/);
  assert.match(content, /Status: open/);
  assert.match(content, /## Open Decisions/);
});

test("decisions --add shows similar decisions when present", () => {
  const dir = makeProject({ lean: true });
  fs.mkdirSync(path.join(dir, ".scrumrun", "goals", "main"), { recursive: true });
  writeDecisions(dir, `# Main Goal Decisions\n\n## Open Decisions\n\n- Use Postgres for primary DB\n\n## Resolved Decisions\n\n- Pending: none.\n`);

  const output = execFileSync(process.execPath, [bin, "decisions", "--add", "Use PostgreSQL as primary store"], { cwd: dir, encoding: "utf8" });

  assert.match(output, /Added decision: D-001/);
  assert.match(output, /Similar decisions found/);
  assert.match(output, /Use Postgres for primary DB/);
  assert.match(output, /Extends: D-NNN/);
});

test("decisions --similar finds matches by Jaccard token overlap", () => {
  const dir = makeProject({ lean: true });
  fs.mkdirSync(path.join(dir, ".scrumrun", "goals", "main"), { recursive: true });
  writeDecisions(dir, `# Main Goal Decisions\n\n## Open Decisions\n\n### D-001 - Use S3 for cold storage of exports\nStatus: open\nDate: 2026-07-21\n\n### D-002 - Cache tenant permissions in Redis\nStatus: open\nDate: 2026-07-21\n\n## Resolved Decisions\n\n- Pending: none.\n`);

  const output = execFileSync(process.execPath, [bin, "decisions", "--similar", "Use S3-compatible storage for archive"], { cwd: dir, encoding: "utf8" });

  assert.match(output, /D-001/);
  assert.match(output, /S3 for cold storage/);
  assert.doesNotMatch(output, /D-002/);
});

test("decisions --list shows all open and resolved decisions", () => {
  const dir = makeProject({ lean: true });
  fs.mkdirSync(path.join(dir, ".scrumrun", "goals", "main"), { recursive: true });
  writeDecisions(dir, `# Main Goal Decisions\n\n## Open Decisions\n\n### D-001 - Open one\nStatus: open\n\n## Resolved Decisions\n\n### D-000 - Resolved one\nStatus: resolved\n`);

  const output = execFileSync(process.execPath, [bin, "decisions", "--list"], { cwd: dir, encoding: "utf8" });

  assert.match(output, /# Open/);
  assert.match(output, /D-001 \| open \| Open one/);
  assert.match(output, /# Resolved/);
  assert.match(output, /D-000 \| resolved \| Resolved one/);
});

test("decisions --resolve moves a decision from open to resolved", () => {
  const dir = makeProject({ lean: true });
  fs.mkdirSync(path.join(dir, ".scrumrun", "goals", "main"), { recursive: true });
  writeDecisions(dir, `# Main Goal Decisions\n\n## Open Decisions\n\n### D-001 - To resolve\nStatus: open\n\n## Resolved Decisions\n\n- Pending: none.\n`);

  execFileSync(process.execPath, [bin, "decisions", "--resolve", "D-001"], { cwd: dir, encoding: "utf8" });

  const content = readDecisions(dir);
  const openSection = content.match(/## Open Decisions\n+([\s\S]*?)\n## /);
  const resolvedSection = content.match(/## Resolved Decisions\n+([\s\S]*?)(?:\n## |\s*$)/);
  assert.ok(openSection && !openSection[1].includes("D-001"), "D-001 should not appear under Open Decisions");
  assert.ok(resolvedSection && resolvedSection[1].includes("D-001"), "D-001 should appear under Resolved Decisions");
  assert.match(resolvedSection[1], /Status: resolved/);
});

test("decisions --check renders a decision with its validity conditions", () => {
  const dir = makeProject({ lean: true });
  fs.mkdirSync(path.join(dir, ".scrumrun", "goals", "main"), { recursive: true });
  writeDecisions(dir, `# Main Goal Decisions\n\n## Open Decisions\n\n### D-001 - Use S3 for cold storage\nStatus: open\nDate: 2026-07-21\nSource: Sprint 02\nValid while:\n- architecture.storage == "s3-compatible"\nReview when:\n- storage layer changes\n- authentication provider changes\n\n## Resolved Decisions\n\n- Pending: none.\n`);

  const output = execFileSync(process.execPath, [bin, "decisions", "--check", "D-001"], { cwd: dir, encoding: "utf8" });

  assert.match(output, /# D-001 - Use S3 for cold storage/);
  assert.match(output, /Status: open/);
  assert.match(output, /Valid while:/);
  assert.match(output, /architecture.storage == "s3-compatible"/);
  assert.match(output, /Review when:/);
  assert.match(output, /storage layer changes/);
});

test("decisions --check on expired decision surfaces reuse guidance", () => {
  const dir = makeProject({ lean: true });
  fs.mkdirSync(path.join(dir, ".scrumrun", "goals", "main"), { recursive: true });
  writeDecisions(dir, `# Main Goal Decisions\n\n## Open Decisions\n\n### D-001 - Use S3 for cold storage\nStatus: open\nExpired: 2026-07-20 — architecture switched to services-v2\n\n## Resolved Decisions\n\n- Pending: none.\n`);

  const output = execFileSync(process.execPath, [bin, "decisions", "--check", "D-001"], { cwd: dir, encoding: "utf8" });

  assert.match(output, /expired: 2026-07-20/);
  assert.match(output, /This decision is marked as expired/);
  assert.match(output, /Extends: D-NNN/);
});

test("decisions --add assigns sequential D-NNN ids", () => {
  const dir = makeProject({ lean: true });
  fs.mkdirSync(path.join(dir, ".scrumrun", "goals", "main"), { recursive: true });
  writeDecisions(dir, `# Main Goal Decisions\n\n## Open Decisions\n\n### D-001 - First\nStatus: open\n### D-002 - Second\nStatus: open\n\n## Resolved Decisions\n\n### D-000 - Zero\nStatus: resolved\n`);

  const output = execFileSync(process.execPath, [bin, "decisions", "--add", "Third"], { cwd: dir, encoding: "utf8" });

  assert.match(output, /Added decision: D-003/);
});

test("decisions parser handles legacy bullet format", () => {
  const dir = makeProject({ lean: true });
  fs.mkdirSync(path.join(dir, ".scrumrun", "goals", "main"), { recursive: true });
  writeDecisions(dir, `# Main Goal Decisions\n\n## Open Decisions\n\n- Legacy bullet decision\n- Another legacy one\n\n## Resolved Decisions\n\n- Pending: none.\n`);

  const output = execFileSync(process.execPath, [bin, "decisions", "--list"], { cwd: dir, encoding: "utf8" });

  assert.match(output, /no-id \| open \| Legacy bullet decision/);
  assert.match(output, /no-id \| open \| Another legacy one/);
});

test("decisions --add preserves unknown content and does not parse nested lists as decisions", () => {
  const dir = makeProject({ lean: true });
  const original = `---
owner: human
custom_schema: keep-me
---
# Main Goal Decisions

Introductory prose that must survive mutations.

## Open Decisions

### D-001 - Existing architecture rule
Status: open
Date: 2026-07-20
Custom Field: preserve exactly
Valid while:
- storage remains remote
Review when:
- storage provider changes

#### Rationale

This explanation is intentionally free-form.

## Resolved Decisions

- Pending: none.

## Custom Appendix

- This is documentation, not a decision.
`;
  writeDecisions(dir, original);

  execFileSync(process.execPath, [bin, "decisions", "--add", "Add an audit trail"], { cwd: dir, encoding: "utf8" });

  const content = readDecisions(dir);
  assert.match(content, /owner: human/);
  assert.match(content, /custom_schema: keep-me/);
  assert.match(content, /Introductory prose that must survive mutations\./);
  assert.match(content, /Custom Field: preserve exactly/);
  assert.match(content, /#### Rationale\n\nThis explanation is intentionally free-form\./);
  assert.match(content, /## Custom Appendix\n\n- This is documentation, not a decision\./);

  const output = execFileSync(process.execPath, [bin, "decisions", "--list"], { cwd: dir, encoding: "utf8" });
  assert.doesNotMatch(output, /no-id \| open \| storage remains remote/);
  assert.doesNotMatch(output, /no-id \| open \| storage provider changes/);
});

test("decisions --resolve moves the raw block losslessly and appends one history transition", () => {
  const dir = makeProject({ lean: true });
  const original = `---
owner: human
---
# Main Goal Decisions

## Open Decisions

### D-001 - Preserve its explanation
Status: open
Date: 2026-07-20
Custom Field: do not discard
Valid while:
- the old API remains active
Review when:
- API contract changes

#### Rationale

This prose is part of the decision.

## Resolved Decisions

- Pending: none.
`;
  writeDecisions(dir, original);

  execFileSync(process.execPath, [bin, "decisions", "--resolve", "D-001"], { cwd: dir, encoding: "utf8" });

  const content = readDecisions(dir);
  assert.match(content, /owner: human/);
  assert.match(content, /Custom Field: do not discard/);
  assert.match(content, /- the old API remains active/);
  assert.match(content, /- API contract changes/);
  assert.match(content, /#### Rationale\n\nThis prose is part of the decision\./);
  assert.match(content, /## Open Decisions\n\n- Pending: none\./);
  assert.match(content, /## Resolved Decisions\n\n### D-001 - Preserve its explanation\nStatus: resolved/);

  const historyFile = path.join(dir, ".scrumrun", "goals", "main", "history.md");
  const history = fs.readFileSync(historyFile, "utf8");
  assert.equal((history.match(/D-001 · open-to-resolved/g) || []).length, 1);
  assert.match(history, /Owner: ScrumRun CLI/);

  const backupDir = path.join(dir, ".scrumrun", ".backup");
  const decisionBackup = fs.readdirSync(backupDir)
    .find((name) => name.startsWith("goals__main__decisions.md."));
  assert.ok(decisionBackup, "expected a content-addressed decision backup");
  assert.equal(fs.readFileSync(path.join(backupDir, decisionBackup), "utf8"), original);
});

test("decisions --resolve leaves canonical files untouched when the id is unknown", () => {
  const dir = makeProject({ lean: true });
  const original = "# Main Goal Decisions\n\n## Open Decisions\n\n### D-001 - Existing\nStatus: open\n\n## Resolved Decisions\n\n- Pending: none.\n";
  writeDecisions(dir, original);
  const historyFile = path.join(dir, ".scrumrun", "goals", "main", "history.md");
  const historyBefore = fs.existsSync(historyFile) ? fs.readFileSync(historyFile, "utf8") : null;

  let output = "";
  assert.throws(() => {
    execFileSync(process.execPath, [bin, "decisions", "--resolve", "D-999"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  }, (error) => {
    output = `${error.stdout || ""}${error.stderr || ""}`;
    return true;
  });

  assert.match(output, /Open decision not found: D-999/);
  assert.equal(readDecisions(dir), original);
  assert.equal(fs.existsSync(historyFile) ? fs.readFileSync(historyFile, "utf8") : null, historyBefore);
  assert.equal(fs.existsSync(path.join(dir, ".scrumrun", ".backup")), false);
});
