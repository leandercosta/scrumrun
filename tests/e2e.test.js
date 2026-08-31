const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

function write(base, relative, content) {
  const file = path.join(base, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function treeFingerprint(directory) {
  const entries = [];
  function visit(current, relative = "") {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const nextRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) visit(absolute, nextRelative);
      else entries.push(`${nextRelative}\0${crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex")}`);
    }
  }
  visit(directory);
  return crypto.createHash("sha256").update(entries.join("\n")).digest("hex");
}

function run(bin, cwd, home, ...args) {
  return execFileSync(process.execPath, [bin, ...args], {
    cwd,
    env: { ...process.env, HOME: home },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
}

function makeV1Project(directory) {
  const scrum = path.join(directory, ".scrumrun");
  write(scrum, "golden-rules.md", "# Golden Rules\n\n1. Never expose secrets.\n2. Validate before completion.\n");
  write(scrum, "config.md", "# Config\n\nLanguage: English\nExecution Approval: always\n");
  write(scrum, "goals/main/sprint.md", `# Main Plan

## Sprint 01 - Pricing release

Timebox: 2026-07-21/2026-07-25
Status: completed.
Goal: ship deterministic pricing.
`);
  write(scrum, "goals/main/history.md", `# Main History

### 2026-07-21 - Sprint 01

Status: completed.
Summary: deterministic pricing shipped.
`);
  write(scrum, "goals/main/decisions.md", `# Decisions

## Resolved Decisions

- Pricing remains in the backend.
`);
  write(scrum, "knowledge.md", `# Knowledge

## Approved Knowledge

### K-001 - Pricing determinism
Status: approved

#### Verified Facts

- Pricing calculations are deterministic.

#### Reusable Insights

- Keep pricing calculations in the backend.
`);
  write(scrum, "vault.local.md", "# Local Vault\n\nLEGACY_TOKEN=private-migration-fixture-value\n");
  return scrum;
}

test("published tarball supports install, v2 memory, ongoing-project migration, rollback, doctor, and uninstall", { timeout: 120_000 }, (t) => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-package-e2e-"));
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }));

  const packDir = path.join(sandbox, "pack");
  const npmCache = path.join(sandbox, "npm-cache");
  fs.mkdirSync(packDir, { recursive: true });
  const packOutput = execFileSync("npm", ["pack", "--json", "--pack-destination", packDir], {
    cwd: root,
    env: { ...process.env, npm_config_cache: npmCache },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  const packed = JSON.parse(packOutput)[0];
  const packedFiles = packed.files.map((entry) => entry.path);
  const tarball = path.join(packDir, packed.filename);

  for (const required of [
    "bin/scrumrun.js",
    "lib/v2/migration.js",
    "templates/project/.scrumrun/method.json",
    "docs/COMMANDS.md",
    "MIGRATION-1-to-2.md",
    "CHANGELOG.md",
    "LICENSE"
  ]) assert.ok(packedFiles.includes(required), `tarball is missing ${required}`);
  assert.equal(packedFiles.some((file) => file.startsWith(".scrumrun/")), false, "tarball contains repository-local .scrumrun state");
  assert.equal(packedFiles.some((file) => file.startsWith("tests/")), false, "tarball contains tests");
  for (const forbidden of [".cache/", ".backup/", ".migration/", "vault.local.md"]) {
    assert.equal(packedFiles.some((file) => file === forbidden.slice(0, -1) || file.startsWith(forbidden) || file.includes(`/${forbidden}`)), false, `tarball contains ${forbidden}`);
  }

  const consumer = path.join(sandbox, "consumer");
  const home = path.join(sandbox, "home");
  fs.mkdirSync(consumer, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  write(consumer, "package.json", JSON.stringify({ name: "scrumrun-e2e-consumer", private: true }, null, 2));
  execFileSync("npm", ["install", tarball, "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: consumer,
    env: { ...process.env, HOME: home, npm_config_cache: npmCache },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  const installedBin = path.join(consumer, "node_modules", "scrumrun", "bin", "scrumrun.js");
  assert.ok(fs.existsSync(installedBin));

  const fresh = path.join(sandbox, "fresh-project");
  fs.mkdirSync(fresh, { recursive: true });
  const initOutput = run(installedBin, fresh, home, "init", "--lean", "--shared", "--force");
  assert.match(initOutput, /Initialized ScrumRun 2\.0 project/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(fresh, ".scrumrun", "method.json"), "utf8")).method, "2.0.0");
  assert.ok(fs.existsSync(path.join(fresh, "AGENTS.md")));
  assert.match(fs.readFileSync(path.join(fresh, ".scrumrun", ".gitignore"), "utf8"), /^\.cache\/$/m);
  assert.match(run(installedBin, fresh, home, "sc", "review", "artifact", "--run"), /"passed": true/);

  write(fresh, "docs/pricing-evidence.md", "# Pricing evidence\n\nThe backend owns deterministic final-price calculations.\n");
  write(fresh, "src/pricing.js", "export function calculateFinalPrice() { return 42; }\n");
  const proposal = run(
    installedBin,
    fresh,
    home,
    "sc", "knowledge", "insight", "--propose",
    "--title", "Pricing placement",
    "--content", "Pricing stays in the backend so every consumer gets deterministic results.",
    "--subject", "symbol:calculateFinalPrice",
    "--source", "human",
    "--source-id", "e2e-review",
    "--evidence", "docs/pricing-evidence.md"
  );
  assert.match(proposal, /Created candidate INS-001/);
  assert.match(run(installedBin, fresh, home, "sc", "knowledge", "insight", "--confirm", "INS-001", "--evidence", "docs/pricing-evidence.md"), /INS-001: confirmed/);
  const study = run(installedBin, fresh, home, "sc", "knowledge", "study", "pricing backend");
  assert.match(study, /INS-001/);
  assert.match(study, /"truth": "confirmed"/);
  assert.doesNotMatch(study, /Code subject cannot be resolved/);

  run(installedBin, fresh, home, "install", "codex");
  assert.match(run(installedBin, fresh, home, "doctor", "codex"), /ok\s+Codex skill scrumrun/);
  const previewUninstall = run(installedBin, fresh, home, "uninstall");
  assert.match(previewUninstall, /use --force to remove/);
  assert.ok(fs.existsSync(path.join(fresh, ".scrumrun")));
  run(installedBin, fresh, home, "uninstall", "--force");
  assert.equal(fs.existsSync(path.join(fresh, ".scrumrun")), false);
  assert.equal(fs.existsSync(path.join(fresh, "AGENTS.md")), false);

  const ongoing = path.join(sandbox, "ongoing-v1-project");
  fs.mkdirSync(ongoing, { recursive: true });
  const legacyScrum = makeV1Project(ongoing);
  const v1Fingerprint = treeFingerprint(legacyScrum);
  const updatePreview = run(installedBin, ongoing, home, "update", "codex");
  assert.doesNotMatch(updatePreview, /Project migration preflight/);
  assert.equal(treeFingerprint(legacyScrum), v1Fingerprint);

  const updateApply = run(installedBin, ongoing, home, "update", "codex", "--migrate");
  assert.match(updateApply, /Applied the verified ScrumRun v1 → v2 project migration/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(legacyScrum, "method.json"), "utf8")).method, "2.0.0");
  const migratedStudy = run(installedBin, ongoing, home, "sc", "knowledge", "study", "pricing deterministic");
  assert.match(migratedStudy, /Pricing determinism|Pricing calculations are deterministic/);
  assert.match(run(installedBin, ongoing, home, "migrate", "--to", "2", "--rollback"), /restored the exact v1 fingerprint/);
  assert.equal(treeFingerprint(legacyScrum), v1Fingerprint);
  assert.equal(fs.existsSync(path.join(legacyScrum, "method.json")), false);
});
