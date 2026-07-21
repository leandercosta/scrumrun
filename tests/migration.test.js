const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");
const { applyMigration, inventoryTree, rollbackMigration } = require("../lib/v2/migration");
const { readProjectModel } = require("../lib/v2/project-store");
const { auditProject } = require("../lib/v2/conformance");

function write(rootDir, relative, content) {
  const file = path.join(rootDir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function makeV1Project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-migrate-"));
  const scrum = path.join(dir, ".scrumrun");
  write(scrum, "golden-rules.md", "# Golden Rules\n\n1. Never expose secrets.\n2. Validate before completion.\n");
  write(scrum, "config.md", "# Config\n\nLanguage: English\nExecution Approval: always\n");
  write(scrum, "goals/main/sprint.md", `# Main Plan

## Sprint 01 - Build pricing

Goal: calculate final prices.

## Sprint 02 - Release batch

Timebox: 2026-07-21/2026-07-25
Status: completed.
Goal: ship the release batch.
`);
  write(scrum, "goals/main/history.md", `# Main History

### 2026-07-20 - Sprint 01 first attempt

Status: completed.
Summary: pricing shipped.

### 2026-07-20 - Environment discovery

Status: completed.
Summary: no sprint relation exists.
`);
  write(scrum, "goals/main/decisions.md", `# Decisions

## Open Decisions

### D-001 - Prices stay in the backend
Status: open
Valid while:
- historical prices remain reproducible

## Resolved Decisions

- Discounts happen before taxes.
`);
  write(scrum, "backlog.md", "# Backlog\n\n## Items\n\n- [ ] Add international taxes.\n- [x] Document pricing.\n");
  write(scrum, "fixes.md", "# Fixes\n\n## F-001 - Correct rounding\n\nStatus: completed.\nLinked Sprint: 01\n");
  write(scrum, "knowledge.md", `# Knowledge

## Approved Knowledge

### K-001 - Pricing dependencies
Status: approved

#### Verified Facts

- TaxCalculator is a backend dependency.

#### Reusable Insights

- Keep pricing deterministic.

## Pending Proposals

- Pending: none.

## Rejected Proposals

- Pending: none.
`);
  write(scrum, "features/checkout/feature.md", "# Feature - Checkout\n\nPurpose: sell products.\n");
  write(scrum, "features/checkout/sprint.md", "# Checkout Plan\n\n## Sprint 01 - Add card form\n\nGoal: collect card details.\n");
  write(scrum, "features/checkout/history.md", "# Checkout History\n\n### 2026-07-20 - Sprint 01\n\nStatus: blocked.\n");
  write(scrum, "features/checkout/decisions.md", "# Decisions\n\n## Open Decisions\n\n- Tokenize cards externally.\n\n## Resolved Decisions\n\n- Pending: none.\n");
  write(scrum, "knowledge/dossiers/pricing.md", "# Pricing Dossier\n\nCommit: abc123\n");
  write(scrum, "reviews/sprint-01.md", "# Review - Sprint 01\n\nResult: passed.\n");
  write(scrum, "vault.local.md", "# Local Vault\n\nPRICE_API_KEY=super-secret-migration-value\n");
  return dir;
}

function run(dir, ...args) {
  return execFileSync(process.execPath, [bin, ...args], { cwd: dir, encoding: "utf8" });
}

function read(dir, relative) {
  return fs.readFileSync(path.join(dir, ".scrumrun", relative), "utf8");
}

test("migration dry-run is read-only and never renders vault values", () => {
  const dir = makeV1Project();
  const scrum = path.join(dir, ".scrumrun");
  const before = inventoryTree(scrum);

  const output = run(dir, "migrate", "--to", "2", "--dry-run");
  const after = inventoryTree(scrum);

  assert.equal(after.rootSha256, before.rootSha256);
  assert.match(output, /Status: dry-run/);
  assert.match(output, /Generated artifacts:/);
  assert.doesNotMatch(output, /super-secret-migration-value/);
  assert.equal(fs.existsSync(path.join(scrum, ".migration")), false);
});

test("migration blocks secret-like content outside the vault without echoing it", () => {
  const dir = makeV1Project();
  const scrum = path.join(dir, ".scrumrun");
  const leaked = "AKIAABCDEFGHIJKLMNOP";
  fs.appendFileSync(path.join(scrum, "knowledge.md"), `\nUnsafe: api_key=${leaked}\n`);
  const before = inventoryTree(scrum);
  let output = "";
  assert.throws(() => run(dir, "migrate", "--to", "2", "--dry-run"), (error) => {
    output = `${error.stdout || ""}${error.stderr || ""}`;
    return true;
  });
  assert.match(output, /Secret-like content detected outside the local vault: knowledge\.md/);
  assert.doesNotMatch(output, new RegExp(leaked));
  assert.equal(inventoryTree(scrum).rootSha256, before.rootSha256);
});

test("bare migrate never mutates or guesses a target version", () => {
  const dir = makeV1Project();
  const scrum = path.join(dir, ".scrumrun");
  const before = inventoryTree(scrum);
  let output = "";
  assert.throws(() => {
    execFileSync(process.execPath, [bin, "migrate"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  }, (error) => {
    output = `${error.stdout || ""}${error.stderr || ""}`;
    return true;
  });
  assert.match(output, /migrate --to 2/);
  assert.equal(inventoryTree(scrum).rootSha256, before.rootSha256);
});

test("update preflights an ongoing v1 project without changing it", () => {
  const dir = makeV1Project();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-update-home-"));
  const scrum = path.join(dir, ".scrumrun");
  const before = inventoryTree(scrum);

  const output = execFileSync(process.execPath, [bin, "update", "codex"], {
    cwd: dir,
    env: { ...process.env, HOME: home },
    encoding: "utf8"
  });

  assert.match(output, /Project migration preflight/);
  assert.match(output, /Status: dry-run/);
  assert.match(output, /update --migrate/);
  assert.equal(inventoryTree(scrum).rootSha256, before.rootSha256);
  assert.equal(fs.existsSync(path.join(home, ".codex", "prompts", "sc.md")), true);
});

test("update --migrate applies only the verified plan and keeps rollback available", () => {
  const dir = makeV1Project();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-update-migrate-home-"));
  const output = execFileSync(process.execPath, [bin, "update", "codex", "--migrate"], {
    cwd: dir,
    env: { ...process.env, HOME: home },
    encoding: "utf8"
  });

  assert.match(output, /Status: dry-run/);
  assert.match(output, /Applied the verified ScrumRun v1 → v2/);
  assert.equal(JSON.parse(read(dir, "method.json")).method, "2.0.0");
  assert.equal(fs.existsSync(path.join(dir, ".scrumrun", ".migration", "v1-to-v2", "manifest.json")), true);
  assert.match(output, /rollback/);
});

test("dual-layout reader projects v1 in memory and reads canonical v2 after apply", () => {
  const dir = makeV1Project();
  const before = inventoryTree(path.join(dir, ".scrumrun"));
  const projected = readProjectModel(dir);
  assert.equal(projected.layout, "v1");
  assert.equal(projected.source, "read-only-v2-projection");
  assert.ok(projected.graph.nodes.some((node) => node.kind === "task"));
  assert.equal(inventoryTree(path.join(dir, ".scrumrun")).rootSha256, before.rootSha256);

  run(dir, "migrate", "--to", "2", "--apply");
  const migrated = readProjectModel(dir);
  assert.equal(migrated.layout, "v2");
  assert.equal(migrated.source, "canonical-v2");
  assert.equal(migrated.graph.nodes.length, projected.graph.nodes.length);
});

test("migration apply creates linked v2 artifacts and archives every v1 source byte-exactly", () => {
  const dir = makeV1Project();
  const scrum = path.join(dir, ".scrumrun");
  const sourceFiles = [
    "golden-rules.md",
    "goals/main/sprint.md",
    "goals/main/history.md",
    "goals/main/decisions.md",
    "knowledge.md",
    "vault.local.md"
  ];
  const originals = new Map(sourceFiles.map((relative) => [relative, read(dir, relative)]));

  const output = run(dir, "migrate", "--to", "2", "--apply");

  assert.match(output, /Applied ScrumRun v1 to v2 migration/);
  assert.equal(JSON.parse(read(dir, "method.json")).method, "2.0.0");
  assert.match(read(dir, "guardrails.md"), /^# ScrumRun Project Guardrails/m);
  assert.match(read(dir, "core.md"), /Method version: `2\.0\.0`/);
  assert.match(read(dir, "config.md"), /Method Version: 2\.0\.0/);
  assert.match(read(dir, "project.md"), /Method: 2\.0\.0/);
  for (const [relative, content] of originals) {
    assert.equal(read(dir, path.join(".migration", "v1-to-v2", "backup", relative)), content, `${relative} backup changed`);
  }
  for (const relative of ["golden-rules.md", "goals/main/sprint.md", "goals/main/history.md", "goals/main/decisions.md", "knowledge.md"]) {
    assert.equal(fs.existsSync(path.join(scrum, relative)), false, `${relative} remained active`);
  }
  assert.equal(read(dir, "vault.local.md"), originals.get("vault.local.md"));

  const taskFiles = fs.readdirSync(path.join(scrum, "tasks")).filter((name) => name.endsWith(".md"));
  const sprintFiles = fs.readdirSync(path.join(scrum, "sprints")).filter((name) => name.endsWith(".md"));
  const runFiles = fs.readdirSync(path.join(scrum, "runs")).filter((name) => name.endsWith(".md"));
  assert.equal(taskFiles.length, 6);
  assert.equal(sprintFiles.length, 1, "only the entry with explicit timebox evidence becomes a v2 Sprint");
  assert.equal(runFiles.length, 3);

  const runs = runFiles.map((name) => read(dir, path.join("runs", name))).join("\n");
  assert.match(runs, /task: TASK-/);
  assert.match(runs, /attempt: 1/);
  const insights = fs.readdirSync(path.join(scrum, "memory", "insights"));
  assert.equal(insights.length, 1);
  assert.match(read(dir, path.join("memory", "insights", insights[0])), /status: candidate/);

  const manifestText = read(dir, ".migration/v1-to-v2/manifest.json");
  const reportText = read(dir, ".migration/v1-to-v2/report.md");
  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.sourceInventory.rootSha256.length, 64);
  assert.ok(manifest.mappings.some((mapping) => mapping.outcome === "transformed"));
  assert.match(reportText, /## Source-to-Destination Mapping/);
  assert.match(reportText, /goals\/main\/sprint\.md.*TASK-/);
  assert.equal(read(dir, ".migration/.gitignore"), "*\n!.gitignore\n");
  for (const ignored of [".cache/", ".backup/", ".migration/", "vault.local.md"]) assert.match(read(dir, ".gitignore"), new RegExp(`^${ignored.replace(".", "\\.")}$`, "m"));
  assert.doesNotMatch(manifestText, /super-secret-migration-value/);
  assert.doesNotMatch(reportText, /super-secret-migration-value/);
  assert.equal(auditProject(dir).passed, true, "the applied v1 fixture must satisfy blocking v2 conformance rules");
});

test("migration apply is idempotent and rollback restores the exact v1 fingerprint", () => {
  const dir = makeV1Project();
  const scrum = path.join(dir, ".scrumrun");
  const original = inventoryTree(scrum);

  run(dir, "migrate", "--to", "2", "--apply");
  const applied = inventoryTree(scrum);
  const second = run(dir, "migrate", "--to", "2", "--apply");
  assert.match(second, /already migrated/);
  const replayed = inventoryTree(scrum);
  assert.equal(replayed.rootSha256, applied.rootSha256, JSON.stringify({
    added: replayed.files.filter((entry) => !applied.files.some((before) => before.path === entry.path)),
    removed: applied.files.filter((entry) => !replayed.files.some((after) => after.path === entry.path)),
    changed: replayed.files.filter((entry) => applied.files.some((before) => before.path === entry.path && before.sha256 !== entry.sha256))
  }, null, 2));
  run(dir, "sc", "knowledge", "map", "--build");

  const rollback = run(dir, "migrate", "--to", "2", "--rollback");
  assert.match(rollback, /restored the exact v1 fingerprint/);
  assert.equal(inventoryTree(scrum).rootSha256, original.rootSha256);
  assert.equal(read(dir, "vault.local.md").includes("super-secret-migration-value"), true);
  assert.equal(fs.existsSync(path.join(scrum, "method.json")), false);
});

test("migration failure after source move restores the untouched v1 tree", () => {
  const dir = makeV1Project();
  const scrum = path.join(dir, ".scrumrun");
  const original = inventoryTree(scrum);

  assert.throws(() => applyMigration(dir, { failurePoint: "after-source-move" }), /Injected migration failure/);

  assert.ok(fs.existsSync(scrum));
  assert.equal(inventoryTree(scrum).rootSha256, original.rootSha256);
  assert.equal(fs.existsSync(path.join(scrum, ".migration")), false);
});

test("migration failure after target move restores the untouched v1 tree", () => {
  const dir = makeV1Project();
  const scrum = path.join(dir, ".scrumrun");
  const original = inventoryTree(scrum);

  assert.throws(() => applyMigration(dir, { failurePoint: "after-target-move" }), /Injected migration failure/);

  assert.ok(fs.existsSync(scrum));
  assert.equal(inventoryTree(scrum).rootSha256, original.rootSha256);
  assert.equal(fs.existsSync(path.join(scrum, ".migration")), false);
});

test("minimal lean v1 layout migrates without inventing tasks or sprints", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-lean-migrate-"));
  const scrum = path.join(dir, ".scrumrun");
  write(scrum, "core.md", "# Core\n");
  write(scrum, "guardrails.md", "# ScrumRun Guardrails\n\nGenerated v1 view.\n");
  write(scrum, "state.md", "# State\n");

  run(dir, "migrate", "--to", "2", "--apply");

  assert.equal(JSON.parse(read(dir, "method.json")).method, "2.0.0");
  assert.match(read(dir, "guardrails.md"), /^# ScrumRun Project Guardrails/m);
  assert.deepEqual(fs.readdirSync(path.join(scrum, "tasks")), []);
  assert.deepEqual(fs.readdirSync(path.join(scrum, "sprints")), []);
  for (const directory of ["features", "runs", "reviews", "memory/knowledge", "memory/decisions", "memory/insights", "memory/dossiers"]) {
    assert.ok(fs.statSync(path.join(scrum, directory)).isDirectory(), `missing canonical directory ${directory}`);
  }
  const manifest = JSON.parse(read(dir, ".migration/v1-to-v2/manifest.json"));
  assert.ok(manifest.mappings.some((mapping) => mapping.source === "guardrails.md" && mapping.outcome === "superseded-and-backed-up"));

  run(dir, "migrate", "--to", "2", "--rollback");
  assert.equal(read(dir, "guardrails.md"), "# ScrumRun Guardrails\n\nGenerated v1 view.\n");
});

test("hybrid incomplete-v2 migration reuses canonical work and repairs deterministic schema aliases", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-hybrid-migrate-"));
  const scrum = path.join(dir, ".scrumrun");
  write(scrum, ".DS_Store", "local metadata\n");
  write(scrum, "goals/main/sprint.md", "# Legacy plan\n\n## Sprint 01 - Existing delivery\n\nStatus: completed.\n");
  write(scrum, "guardrails.md", "# ScrumRun Project Guardrails\n\n### GR-001 - Preserve work\n\nNever overwrite owner work.\n");
  write(scrum, "sprints/SPRINT-001.md", `---
id: SPRINT-001
kind: sprint
status: completed
created: 2026-07-21
updated: 2026-07-21
method: 2.0.0
---

# Existing delivery

## Tasks

- TASK-001
`);
  write(scrum, "tasks/TASK-001.md", `---
id: TASK-001
kind: task
type: feature
status: completed
created: 2026-07-21
updated: 2026-07-21
method: 2.0.0
sprint: SPRINT-001
---

# Existing task
`);
  write(scrum, "runs/RUN-001.md", `---
id: RUN-001
kind: run
status: completed
created: 2026-07-21
updated: 2026-07-21
method: 2.0.0
task: TASK-001
sprint: SPRINT-001
attempt: 1
---

# Existing run
`);
  write(scrum, "memory/decisions/DEC-001.md", `---
id: DEC-001
kind: decision
status: confirmed
created: 2026-07-21
updated: 2026-07-21
method: 2.0.0
source: TASK-001
---

# Preserve the existing model
`);
  const before = inventoryTree(scrum);
  const preview = run(dir, "migrate", "--to", "2", "--dry-run");
  assert.match(preview, /Source layout: hybrid-v1-v2/);
  assert.match(preview, /represented-by-existing-v2/);
  assert.equal(inventoryTree(scrum).rootSha256, before.rootSha256);

  run(dir, "migrate", "--to", "2", "--apply");

  assert.equal(JSON.parse(read(dir, "method.json")).migrated_from, "hybrid-v1-v2");
  assert.deepEqual(fs.readdirSync(path.join(scrum, "tasks")), ["TASK-001.md"]);
  assert.deepEqual(fs.readdirSync(path.join(scrum, "sprints")), ["SPRINT-001.md"]);
  assert.deepEqual(fs.readdirSync(path.join(scrum, "runs")), ["RUN-001.md"]);
  assert.equal(fs.existsSync(path.join(scrum, "goals")), false);
  assert.equal(fs.existsSync(path.join(scrum, ".DS_Store")), false);
  assert.equal(read(dir, ".migration/v1-to-v2/backup/.DS_Store"), "local metadata\n");
  assert.match(read(dir, "guardrails.md"), /^## GR-001/m);
  assert.match(read(dir, "memory/decisions/DEC-001.md"), /^status: resolved$/m);
  assert.match(read(dir, "memory/decisions/DEC-001.md"), /^- TASK-001$/m);
  assert.equal(auditProject(dir).passed, true, JSON.stringify(auditProject(dir).findings));
});

test("rollback failure restores the complete migrated tree", () => {
  const dir = makeV1Project();
  const scrum = path.join(dir, ".scrumrun");
  run(dir, "migrate", "--to", "2", "--apply");
  const migrated = inventoryTree(scrum);

  assert.throws(() => rollbackMigration(dir, { failurePoint: "after-source-move" }), /Injected migration failure/);

  assert.equal(inventoryTree(scrum).rootSha256, migrated.rootSha256);
  assert.ok(fs.existsSync(path.join(scrum, ".migration", "v1-to-v2", "manifest.json")));
});

test("rollback refuses to erase post-migration canonical or vault changes", () => {
  const dir = makeV1Project();
  const scrum = path.join(dir, ".scrumrun");
  run(dir, "migrate", "--to", "2", "--apply");
  fs.appendFileSync(path.join(scrum, "vault.local.md"), "ROTATED=yes\n");
  write(scrum, "tasks/TASK-999.md", "new work that did not exist at migration time\n");
  write(scrum, "goals/main/history.md", "legacy path recreated after migration\n");

  assert.throws(
    () => rollbackMigration(dir),
    (error) => error.message.includes("legacy source changed after migration: vault.local.md")
      && error.message.includes("new post-migration file would be lost: tasks/TASK-999.md")
      && error.message.includes("archived legacy path was recreated after migration: goals/main/history.md")
  );
  assert.ok(fs.existsSync(path.join(scrum, "method.json")));
  assert.match(read(dir, "vault.local.md"), /ROTATED=yes/);
});

test("migration stage rejects active-memory evidence that escapes through a project symlink", (t) => {
  const dir = makeV1Project();
  const scrum = path.join(dir, ".scrumrun");
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-migrate-evidence-")), "outside.md");
  fs.writeFileSync(outside, "external evidence\n");
  try {
    fs.symlinkSync(outside, path.join(dir, "evidence.md"));
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.message}`);
    return;
  }
  write(scrum, "memory/decisions/DEC-001.md", `---
id: DEC-001
kind: decision
status: resolved
created: 2026-07-21
updated: 2026-07-21
method: 2.0.0
---

# Unsafe evidence

## Evidence

- evidence.md
`);
  const before = inventoryTree(scrum);
  assert.throws(() => applyMigration(dir), /unsafe evidence reference evidence\.md/);
  assert.equal(inventoryTree(scrum).rootSha256, before.rootSha256);
  assert.equal(fs.existsSync(path.join(scrum, "method.json")), false);
});

test("partial v1 layout is preserved and ambiguous history becomes an explicit warning", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-partial-"));
  write(path.join(dir, ".scrumrun"), "goals/main/history.md", "# History\n\n### Unknown attempt\n\nStatus: partial.\n");
  const output = run(dir, "migrate", "--to", "2", "--dry-run");
  assert.match(output, /preserved but no Task link was inferred/);
  assert.equal(fs.existsSync(path.join(dir, ".scrumrun", ".migration")), false);
});

test("malformed method marker blocks migration without writes", () => {
  const dir = makeV1Project();
  const scrum = path.join(dir, ".scrumrun");
  write(scrum, "method.json", "{ definitely-not-json\n");
  const before = inventoryTree(scrum);
  let output = "";
  assert.throws(() => {
    execFileSync(process.execPath, [bin, "migrate", "--to", "2", "--dry-run"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  }, (error) => {
    output = `${error.stdout || ""}${error.stderr || ""}`;
    return true;
  });
  assert.match(output, /method\.json is malformed/);
  assert.equal(inventoryTree(scrum).rootSha256, before.rootSha256);
});

test("migration blocks symbolic links without changing the source tree", (t) => {
  const dir = makeV1Project();
  const scrum = path.join(dir, ".scrumrun");
  try {
    fs.symlinkSync("config.md", path.join(scrum, "linked-config.md"));
  } catch (error) {
    t.skip(`symlinks unavailable: ${error.message}`);
    return;
  }
  const original = inventoryTree(scrum);
  let output = "";
  assert.throws(() => {
    execFileSync(process.execPath, [bin, "migrate", "--to", "2", "--apply"], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  }, (error) => {
    output = `${error.stdout || ""}${error.stderr || ""}`;
    return true;
  });
  assert.match(output, /Symbolic link is not migrated automatically/);
  assert.equal(inventoryTree(scrum).rootSha256, original.rootSha256);
});
