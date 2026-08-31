const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");
const claudeBin = path.join(root, "bin", "claude-install.js");
const { aliases, nouns, resolveAlias, resolveRoute } = require("../lib/commands/manifest");
const { renderCompatibilityPrompt, renderRootPrompt } = require("../lib/commands/render");

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function run(args, options = {}) {
  return execFileSync(process.execPath, [bin, ...args], { encoding: "utf8", ...options });
}

test("manifest defines one root with exactly five domain nouns", () => {
  assert.deepEqual(Object.keys(nouns), ["plan", "knowledge", "rules", "review", "config"]);
  for (const [alias, spec] of Object.entries(aliases)) {
    assert.ok(nouns[spec.target[0]], `${alias} targets unknown noun ${spec.target[0]}`);
    assert.ok(nouns[spec.target[0]].subjects[spec.target[1]], `${alias} targets unknown subject ${spec.target[1]}`);
  }
});

test("manifest routing is deterministic for help, valid routes, and unknown syntax", () => {
  assert.deepEqual(resolveRoute([]), { type: "help", level: "root" });
  assert.equal(resolveRoute(["plan"]).level, "noun");
  assert.equal(resolveRoute(["plan", "task"]).level, "subject");
  assert.equal(resolveRoute(["knowledge", "decision", "--list"]).type, "route");
  assert.match(resolveRoute(["unknown"]).message, /Unknown ScrumRun noun/);
  assert.match(resolveRoute(["plan", "task", "--invent"]).message, /Unknown plan task action/);
  assert.equal(resolveAlias("sc-decisions", ["--list"]).noun, "knowledge");
});

test("root and compatibility assets are rendered directly from the manifest", () => {
  const rootPrompt = renderRootPrompt();
  assert.equal(rootPrompt, renderRootPrompt(), "root rendering must be deterministic");
  assert.match(rootPrompt, /^---\n/);
  assert.match(rootPrompt, /argument-hint:/);
  for (const alias of Object.keys(aliases)) {
    const prompt = renderCompatibilityPrompt(alias);
    assert.equal(prompt, renderCompatibilityPrompt(alias), `${alias} rendering must be deterministic`);
    assert.match(prompt, /^---\n/);
    assert.match(prompt, new RegExp(`/${alias}`));
  }
});

test("root prompt encodes the Markdown-first entity, approval, guardrail, and memory contracts", () => {
  const content = renderRootPrompt();
  for (const noun of Object.keys(nouns)) assert.match(content, new RegExp(`\\*\\*${noun}\\*\\*`));
  assert.match(content, /Task, acceptance criteria, technical summary, and follow-ups directly/);
  assert.match(content, /Run is optional audit\/handoff context/);
  assert.match(content, /guardrails\.md.*canonical/);
  assert.match(content, /passed.*blocked.*deferred/);
  assert.match(content, /GR-NNN/);
  assert.match(content, /update --project/);
  assert.match(content, /Optional unrun E2E\/review coverage/);
  assert.match(content, /Insights remain `candidate`/);
  assert.doesNotMatch(content, /Six nouns|method 1\.0/);
});

test("compatibility prompts execute the canonical route instead of asking for re-entry", () => {
  for (const alias of Object.keys(aliases)) {
    const content = renderCompatibilityPrompt(alias);
    assert.match(content, /Execute this request now as/);
    assert.match(content, /Do not ask the user to re-enter/);
    assert.match(content, /deprecation note/);
    assert.doesNotMatch(content, /Use `\/sc-/);
    assert.match(content, /scrumrun /);
  }
});

test("CLI command listing is rendered from the same five-noun manifest", () => {
  const output = run(["commands"]);
  assert.match(output, /ScrumRun 2\.0\.0 command grammar/);
  assert.match(output, /scrumrun <noun> <subject> <action>/);
  for (const noun of Object.keys(nouns)) assert.match(output, new RegExp(`scrumrun ${noun}`));
  for (const [alias, spec] of Object.entries(aliases)) {
    assert.ok(output.includes(`/${alias}`));
    assert.ok(output.includes(`scrumrun ${spec.target.join(" ")}`));
  }
});

test("CLI root dispatches implemented helpers and rejects unknown actions", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-root-"));
  run(["init", "--lean", "--force"], { cwd: dir });
  run(["sc", "knowledge", "decision", "--add", "Keep it simple"], { cwd: dir });
  const output = run(["sc", "knowledge", "decision", "--list"], { cwd: dir });
  assert.match(output, /Keep it simple/);

  assert.throws(() => run(["sc", "knowledge", "decision", "--invent"], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"]
  }), /Command failed/);

  run(["knowledge", "decision", "--add", "Direct grammar"], { cwd: dir });
  const direct = run(["knowledge", "decision", "--list"], { cwd: dir });
  assert.match(direct, /Direct grammar/);
});

test("CLI plan task --add creates a backlog Task and lists it", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-plan-add-"));
  run(["init", "--lean", "--force"], { cwd: dir });
  const added = run(["sc", "plan", "task", "--add", "Fix login bug"], { cwd: dir });
  assert.match(added, /Created backlog TASK-001/);
  const listed = run(["sc", "plan", "task", "--list"], { cwd: dir });
  assert.match(listed, /TASK-001 \| backlog \| Fix login bug/);
  const feature = run(["sc", "plan", "feature", "--add", "Onboarding v2"], { cwd: dir });
  assert.match(feature, /Created backlog FEAT-001/);
  const sprint = run(["sc", "plan", "sprint", "--add", "Sprint 01"], { cwd: dir });
  assert.match(sprint, /Created proposed SPRINT-001/);
  assert.match(run(["sc", "plan", "feature", "--list"], { cwd: dir }), /FEAT-001 \| backlog \| Onboarding v2/);
  assert.match(run(["sc", "plan", "sprint", "--list"], { cwd: dir }), /SPRINT-001 \| proposed \| Sprint 01/);
});

test("direct CLI grammar is canonical while sc remains a compatibility alias", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-direct-"));
  run(["init", "--lean", "--force"], { cwd: dir });
  const added = run(["plan", "task", "--add", "Direct Task"], { cwd: dir });
  assert.match(added, /Created backlog TASK-001/);
  const listed = run(["plan", "task", "--list"], { cwd: dir });
  assert.match(listed, /TASK-001 \| backlog \| Direct Task/);
  const compatibility = run(["sc", "plan", "task", "--list"], { cwd: dir });
  assert.match(compatibility, /TASK-001 \| backlog \| Direct Task/);
});

test("plan amendments update every mutable planning artifact without hand-editing Markdown", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-amend-"));
  run(["init", "--lean", "--force"], { cwd: dir });
  run(["plan", "feature", "--add", "Organization context"], { cwd: dir });
  run(["plan", "sprint", "--add", "Admin batch"], { cwd: dir });
  run(["plan", "task", "--add", "Initial aside"], { cwd: dir });

  const amended = run([
    "plan", "task", "--amend", "TASK-001",
    "--title", "Organization Aside and context selector",
    "--request", "Add the shared Organization Aside, context selector, routes, and authorization boundaries.",
    "--acceptance", "Organization context is available before protected routes render.",
    "--acceptance", "User Account stays separate from Organization administration.",
    "--section", "Architecture Notes=The Aside owns navigation only; authorization stays server-side.",
    "--type", "feature", "--feature", "FEAT-001", "--sprint", "SPRINT-001"
  ], { cwd: dir });
  assert.match(amended, /Amended TASK-001/);

  const task = run(["plan", "task", "--show", "TASK-001"], { cwd: dir });
  assert.match(task, /^# Organization Aside and context selector$/m);
  assert.match(task, /^type: feature$/m);
  assert.match(task, /^feature: FEAT-001$/m);
  assert.match(task, /^sprint: SPRINT-001$/m);
  assert.match(task, /## Architecture Notes/);
  assert.match(task, /Organization context is available/);
  assert.match(task, /User Account stays separate/);
  assert.match(run(["plan", "feature", "--show", "FEAT-001"], { cwd: dir }), /- TASK-001/);
  assert.match(run(["plan", "sprint", "--show", "SPRINT-001"], { cwd: dir }), /^- TASK-001$/m);

  run(["plan", "feature", "--amend", "FEAT-001", "--purpose", "Keep organization context explicit.", "--exit-criteria", "All organization flows share one context model."], { cwd: dir });
  run(["plan", "sprint", "--amend", "SPRINT-001", "--timebox", "Deliver in the current admin batch.", "--exit-gate", "Routes and authorization are reviewed."], { cwd: dir });
  assert.match(run(["plan", "feature", "--show", "FEAT-001"], { cwd: dir }), /Keep organization context explicit/);
  assert.match(run(["plan", "sprint", "--show", "SPRINT-001"], { cwd: dir }), /Routes and authorization are reviewed/);
  assert.equal(JSON.parse(run(["review", "artifact", "--run"], { cwd: dir })).passed, true);

  run(["plan", "task", "--start", "TASK-001"], { cwd: dir });
  assert.throws(() => run(["plan", "task", "--amend", "TASK-001", "--title", "Too late"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }), /Command failed/);
});

test("CLI plan task --add resolves the project root from a subdirectory", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-plan-add-subdir-"));
  run(["init", "--lean", "--force"], { cwd: dir });
  const subdir = path.join(dir, "app", "front");
  fs.mkdirSync(subdir, { recursive: true });
  const added = run(["sc", "plan", "task", "--add", "Fix Step5 SUBMITING"], { cwd: subdir });
  assert.match(added, /Created backlog TASK-001/);
  assert.ok(fs.existsSync(path.join(dir, ".scrumrun", "tasks", "TASK-001.md")), "task must land at the project root");
  assert.ok(!fs.existsSync(path.join(subdir, ".scrumrun")), "no stray .scrumrun directory in the subdirectory");
});

test("CLI plan task --add fails clearly when no ScrumRun project exists", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-plan-add-noproject-"));
  assert.throws(() => run(["sc", "plan", "task", "--add", "Orphan task"], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"]
  }), (error) => /ScrumRun project not found/.test(`${error.stderr || ""}${error.message || ""}`));
  assert.ok(!fs.existsSync(path.join(dir, ".scrumrun")), "no stray .scrumrun directory created");
});

test("CLI error index filters fix tasks and renders errors.md", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-errors-"));
  run(["init", "--lean", "--force"], { cwd: dir });
  run(["sc", "plan", "task", "--add", "Fix login bug", "--type", "fix"], { cwd: dir });
  run(["sc", "plan", "task", "--add", "Add dark mode"], { cwd: dir });

  const listed = run(["sc", "plan", "task", "--list", "--type", "fix"], { cwd: dir });
  assert.match(listed, /Fix login bug/);
  assert.doesNotMatch(listed, /Add dark mode/);

  const errors = run(["sc", "knowledge", "errors", "--show"], { cwd: dir });
  assert.match(errors, /Fix Tasks: 1 \(1 open, 0 resolved\)/);
  assert.match(errors, /Fix login bug/);
  assert.ok(fs.existsSync(path.join(dir, ".scrumrun", "errors.md")), "errors.md must be generated");
});

test("CLI v1 aliases execute their canonical helper with a deprecation note", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-alias-"));
  run(["init", "--lean", "--force"], { cwd: dir });
  run(["sc", "knowledge", "decision", "--add", "Alias evidence"], { cwd: dir });
  const result = run(["sc-decisions", "--list"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  assert.match(result, /Alias evidence/);
});

test("fresh client install exposes only /sc and the shared skill", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-install-"));
  const prompts = path.join(home, ".codex", "prompts");
  fs.mkdirSync(prompts, { recursive: true });
  fs.writeFileSync(path.join(prompts, "sc-plan.md"), "obsolete\n");
  fs.writeFileSync(path.join(prompts, "sc-sprint.md"), "obsolete\n");

  run(["install", "codex"], { env: { ...process.env, HOME: home } });

  assert.deepEqual(fs.readdirSync(prompts).sort(), ["sc.md"]);
  assert.equal(read(path.join(prompts, "sc.md")), renderRootPrompt());
  const skill = read(path.join(home, ".codex", "skills", "scrumrun", "SKILL.md"));
  assert.match(skill, /# ScrumRun 2\.0/);
  assert.match(skill, /Feature \(`FEAT-NNN`\)/);
});

test("upgrade install adds generated v1 adapters but removes obsolete intermediate nouns", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-update-"));
  run(["update", "opencode"], { env: { ...process.env, HOME: home } });
  const commands = path.join(home, ".config", "opencode", "commands");
  const names = fs.readdirSync(commands).sort();
  assert.equal(names.length, Object.keys(aliases).length + 1);
  assert.ok(names.includes("sc.md"));
  assert.ok(names.includes("sc-sprint.md"));
  assert.ok(!names.includes("sc-plan.md"));
  assert.ok(!names.includes("sc-knowledge.md"));
  assert.ok(!names.includes("sc-rules.md"));
});

test("doctor checks the canonical root by default and compatibility only on request", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-doctor-"));
  run(["install", "codex"], { env: { ...process.env, HOME: home } });
  const output = run(["doctor", "codex"], { env: { ...process.env, HOME: home } });
  assert.match(output, /Node\.js >=22\.13\.0/);
  assert.match(output, /Codex prompt sc:/);
  assert.doesNotMatch(output, /sc-sprint/);

  fs.appendFileSync(path.join(home, ".codex", "skills", "scrumrun", "SKILL.md"), "\nobsolete local content\n");
  let stale = "";
  assert.throws(() => run(["doctor", "codex"], {
    env: { ...process.env, HOME: home },
    stdio: ["ignore", "pipe", "pipe"]
  }), (error) => {
    stale = `${error.stdout || ""}${error.stderr || ""}`;
    return true;
  });
  assert.match(stale, /stale Codex skill scrumrun/);
  assert.match(stale, /expected [a-f0-9]{12}, found [a-f0-9]{12}/);
});

test("doctor --strict also requires a warning-free canonical project audit", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-doctor-strict-home-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-doctor-strict-project-"));
  run(["install", "codex"], { env: { ...process.env, HOME: home } });
  run(["init", "--shared", "--force"], { cwd: project });
  const output = run(["doctor", "codex", "--strict"], { cwd: project, env: { ...process.env, HOME: home } });
  assert.match(output, /ok\s+ScrumRun project audit: 0 finding\(s\)/);
});

test("update --project refreshes generated Markdown-first guidance with a backup", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-update-project-home-"));
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-update-project-"));
  run(["init", "--shared", "--force"], { cwd: project });
  const core = path.join(project, ".scrumrun", "core.md");
  fs.writeFileSync(core, "# Previous core\n");
  const output = run(["update", "codex", "--project"], { cwd: project, env: { ...process.env, HOME: home } });
  assert.match(output, /Project guidance: 1 file\(s\) refreshed/);
  assert.match(read(core), /Markdown is the normal runtime/);
  assert.match(read(path.join(project, "AGENTS.md")), /Markdown-first/);
  assert.ok(fs.readdirSync(path.join(project, ".scrumrun", ".backup")).some((name) => name.includes("core.md")));
});

test("sr-claude compatibility binary delegates to the root installer", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-claude-"));
  execFileSync(process.execPath, [claudeBin, "install"], { encoding: "utf8", env: { ...process.env, HOME: home } });
  assert.deepEqual(fs.readdirSync(path.join(home, ".claude", "commands")), ["sc.md"]);
  assert.ok(fs.existsSync(path.join(home, ".claude", "skills", "scrumrun", "SKILL.md")));
});

test("manual CORE and installed skill use the same v2 root and entity model", () => {
  const core = read(path.join(root, "CORE.md"));
  const skill = read(path.join(root, "templates", "shared", "skills", "scrumrun", "SKILL.md"));
  for (const content of [core, skill]) {
    assert.match(content, /scrumrun <noun> <subject> <action>/);
    assert.match(content, /Feature \(`FEAT-NNN`\)/);
    assert.match(content, /Task \(`TASK-NNN`\)/);
    assert.match(content, /Run \(`RUN-NNN`\)/);
    assert.match(content, /guardrails\.md.*canonical/i);
    assert.doesNotMatch(content, /Preferred v2 layout/);
  }
});
