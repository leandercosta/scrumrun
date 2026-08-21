const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");

function makeProject({ lean = false, shared = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-lean-"));
  const args = ["init"];
  if (lean) args.push("--lean");
  if (shared) args.push("--shared");
  args.push("--force");
  execFileSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" });
  return dir;
}

test("init --lean stores complete v2 truth with a lean read policy", () => {
  const dir = makeProject({ lean: true });
  const entries = fs.readdirSync(path.join(dir, ".scrumrun")).sort();
  for (const expected of ["core.md", "guardrails.md", "state.md", "config.md", "project.md", "map.md", "method.json", "tasks", "sprints", "features", "runs", "memory", "reviews"]) {
    assert.ok(entries.includes(expected), `missing ${expected} from complete v2 storage`);
  }
  assert.ok(fs.existsSync(path.join(dir, "AGENTS.md")));

  const agents = fs.readFileSync(path.join(dir, "AGENTS.md"), "utf8");
  assert.match(agents, /lean read policy/);
  assert.match(agents, /guardrails\.md/);
  assert.match(agents, /state\.md/);

  const guardrails = fs.readFileSync(path.join(dir, ".scrumrun", "guardrails.md"), "utf8");
  assert.match(guardrails, /^# ScrumRun Project Guardrails/m);
  assert.match(guardrails, /GR-001 - Protect secrets/);
  assert.doesNotMatch(guardrails, /Golden Rules/);

  const state = fs.readFileSync(path.join(dir, ".scrumrun", "state.md"), "utf8");
  assert.match(state, /## Now/);
  assert.match(state, /## Active Memory/);
});

test("init default creates the canonical v2 tree without v1 aggregate files", () => {
  const dir = makeProject({ lean: false });
  const entries = fs.readdirSync(path.join(dir, ".scrumrun")).sort();
  for (const expected of ["core.md", "guardrails.md", "config.md", "method.json", "tasks", "sprints", "features", "runs", "memory", "reviews"]) {
    assert.ok(entries.includes(expected), `missing ${expected} in default init`);
  }
  for (const legacy of ["golden-rules.md", "knowledge.md", "backlog.md", "goals"]) {
    assert.ok(!entries.includes(legacy), `unexpected v1 aggregate ${legacy}`);
  }
});

test("status recognizes native v2 layout instead of reporting missing v1 files", () => {
  const dir = makeProject({ lean: true });
  const output = execFileSync(process.execPath, [bin, "status"], { cwd: dir, encoding: "utf8" });
  assert.match(output, /Method: 2\.0\.0/);
  assert.match(output, /task: 0 total, 0 active/);
  assert.match(output, /Canonical command: \/sc/);
  assert.doesNotMatch(output, /missing .*golden-rules/);
});

test("scrumrun guardrails --build preserves fresh canonical policy", () => {
  const dir = makeProject({ lean: true });
  const guardrailsFile = path.join(dir, ".scrumrun", "guardrails.md");
  const before = fs.readFileSync(guardrailsFile, "utf8");
  const output = execFileSync(process.execPath, [bin, "guardrails", "--build"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.match(output, /Preserved canonical \.scrumrun\/guardrails\.md/);

  assert.equal(fs.readFileSync(guardrailsFile, "utf8"), before);
});

test("scrumrun guardrails --build composites golden rules and approved knowledge", () => {
  const dir = makeProject({ lean: true });
  fs.mkdirSync(path.join(dir, ".scrumrun", "goals", "main"), { recursive: true });
  fs.writeFileSync(path.join(dir, ".scrumrun", "guardrails.md"), "# ScrumRun Guardrails - legacy generated view\n");

  fs.writeFileSync(
    path.join(dir, ".scrumrun", "golden-rules.md"),
    "# ScrumRun Golden Rules\n\n1. No commits on Fridays.\n2. Tests must run before merge.\n"
  );
  fs.writeFileSync(
    path.join(dir, ".scrumrun", "config.md"),
    "# Project Config\n\nLanguage: pt-BR\nInteraction Mode: guided\nExecution Approval: always\nQuick Tasks: ask\nSprint Automation: backlog\n"
  );
  fs.writeFileSync(
    path.join(dir, ".scrumrun", "knowledge.md"),
    "# Knowledge Base\n\n## Approved Knowledge\n\n### K-001 - Tenant permissions\nStatus: approved\nDate: 2026-07-21\n\n#### Verified Facts\n\n- tenants table has a `scope` column at src/db/tenants.ts:14.\n\n#### Suggested Future Use\n\n- Use when exporting reports.\n\n### K-002 - Export pipeline\nStatus: approved\nDate: 2026-07-21\n\n#### Verified Facts\n\n- exports run through src/jobs/export.ts.\n\n## Pending Proposals\n\n- Pending: none.\n\n## Rejected Proposals\n\n- Pending: none.\n"
  );
  fs.writeFileSync(
    path.join(dir, ".scrumrun", "goals", "main", "sprint.md"),
    "## Sprint 01 - Build export pipeline\nGoal: ship first version of export.\nStatus: proposed.\n"
  );
  fs.writeFileSync(
    path.join(dir, ".scrumrun", "goals", "main", "history.md"),
    "## History\n\n### Sprint 01 first attempt\nDate: 2026-07-15\nStatus: blocked\n\n### Sprint 00 bootstrap\nDate: 2026-07-10\nStatus: completed\n"
  );
  fs.writeFileSync(
    path.join(dir, ".scrumrun", "goals", "main", "decisions.md"),
    "# Decisions\n\n## Open Decisions\n\n- Use S3 for cold storage.\n\n## Resolved Decisions\n\n- Pending: none.\n"
  );
  fs.writeFileSync(
    path.join(dir, ".scrumrun", "backlog.md"),
    "# Backlog\n\n## Items\n\n- [ ] Sprint 02 - Add tenant scoping to exports.\n- [x] Sprint 00 - Bootstrap project.\n"
  );

  execFileSync(process.execPath, [bin, "guardrails", "--build"], { cwd: dir, encoding: "utf8" });

  const guardrails = fs.readFileSync(path.join(dir, ".scrumrun", "guardrails.md"), "utf8");
  assert.match(guardrails, /1\. No commits on Fridays\./);
  assert.match(guardrails, /2\. Tests must run before merge\./);
  assert.match(guardrails, /Language: pt-BR/);
  assert.match(guardrails, /Interaction Mode: guided/);
  assert.match(guardrails, /\*\*K-001\*\* .* Tenant permissions/);
  assert.match(guardrails, /\*\*K-002\*\* .* Export pipeline/);
  assert.match(guardrails, /tenants table has a `scope` column/);

  const state = fs.readFileSync(path.join(dir, ".scrumrun", "state.md"), "utf8");
  assert.match(state, /Sprint 01 - Build export pipeline/);
  assert.match(state, /Use S3 for cold storage/);
  assert.match(state, /Sprint 00 - Bootstrap project/);
  assert.match(state, /Sprint 02 - Add tenant scoping/);
});

test("scrumrun guardrails without --build fails outside a project", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-empty-"));
  let output = "";
  try {
    output = execFileSync(process.execPath, [bin, "guardrails", "--build"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    output = `${error.stdout || ""}${error.stderr || ""}`;
  }
  assert.match(output, /Not a ScrumRun project/);
});

test("scrumrun guardrails --show prints the last built composite", () => {
  const dir = makeProject({ lean: true });
  execFileSync(process.execPath, [bin, "guardrails", "--build"], { cwd: dir, encoding: "utf8" });
  const output = execFileSync(process.execPath, [bin, "guardrails", "--show"], {
    cwd: dir,
    encoding: "utf8",
  });
  assert.match(output, /ScrumRun Project Guardrails/);
  assert.match(output, /GR-001 - Protect secrets/);
});

test("guardrails build preserves canonical v2 rules while rebuilding state", () => {
  const dir = makeProject({ lean: true });
  const guardrailsFile = path.join(dir, ".scrumrun", "guardrails.md");
  const canonical = "# ScrumRun Project Guardrails\n\n- GR-001: Preserve this exact canonical policy.\n";
  fs.writeFileSync(guardrailsFile, canonical);

  const output = execFileSync(process.execPath, [bin, "guardrails", "--build"], { cwd: dir, encoding: "utf8" });

  assert.match(output, /Preserved canonical \.scrumrun\/guardrails\.md/);
  assert.equal(fs.readFileSync(guardrailsFile, "utf8"), canonical);
  assert.ok(fs.existsSync(path.join(dir, ".scrumrun", "state.md")));
});

test("generated state includes structured decisions and normative history", () => {
  const dir = makeProject({ lean: true });
  const mainDir = path.join(dir, ".scrumrun", "goals", "main");
  fs.mkdirSync(mainDir, { recursive: true });
  fs.writeFileSync(
    path.join(mainDir, "decisions.md"),
    "# Decisions\n\n## Open Decisions\n\n### D-007 - Keep prices deterministic\nStatus: open\nValid while:\n- historical prices remain reproducible\n\n## Resolved Decisions\n\n- Pending: none.\n"
  );
  fs.writeFileSync(
    path.join(mainDir, "history.md"),
    "# History\n\n## 2026-07-21 · RUN-044 · validating-to-completed\n\nOwner: ScrumRun\nStatus: completed.\n"
  );

  execFileSync(process.execPath, [bin, "guardrails", "--build"], { cwd: dir, encoding: "utf8" });

  const state = fs.readFileSync(path.join(dir, ".scrumrun", "state.md"), "utf8");
  assert.match(state, /D-007 — Keep prices deterministic/);
  assert.match(state, /2026-07-21 · RUN-044 · validating-to-completed/);
  assert.doesNotMatch(state, /historical prices remain reproducible/);
});
