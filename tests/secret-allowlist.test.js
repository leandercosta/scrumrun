const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");
const { auditProject } = require(path.join(root, "lib", "v2", "conformance"));

function mkProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-secret-allow-"));
  execFileSync(process.execPath, [bin, "init", "--shared", "--force"], { cwd: dir, stdio: "ignore" });
  return dir;
}

function writeTask(dir, id, body) {
  const file = path.join(dir, ".scrumrun", "tasks", `${id}.md`);
  const frontmatter = [
    "---",
    `id: ${id}`,
    "kind: task",
    "status: backlog",
    "created: 2026-09-22",
    "updated: 2026-09-22",
    "method: 2.0.0",
    "type: task",
    "feature: null",
    "sprint: null",
    "---"
  ].join("\n");
  fs.writeFileSync(file, `${frontmatter}\n\n${body}\n`);
  return file;
}

test("SECRET_CANONICAL fires when config has no allowlist", () => {
  const dir = mkProject();
  try {
    writeTask(dir, "TASK-500", "## Note\n\npassword: null");
    const audit = auditProject(dir);
    const secrets = audit.findings.filter((f) => f.code === "SECRET_CANONICAL");
    assert.equal(secrets.length, 1, "unwhitelisted false positive should fire");
    assert.match(secrets[0].message, /TASK-500/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("SECRET_CANONICAL respects allow_secrets_in from config.md frontmatter", () => {
  const dir = mkProject();
  try {
    writeTask(dir, "TASK-501", "## Note\n\npassword: null");
    writeTask(dir, "TASK-502", "## Note\n\npassword: some-real-looking-secret");
    const configFile = path.join(dir, ".scrumrun", "config.md");
    const current = fs.readFileSync(configFile, "utf8");
    const patched = current.startsWith("---")
      ? current.replace(/^---\n/, "---\nallow_secrets_in: [tasks/TASK-501.md]\n")
      : `---\nallow_secrets_in: [tasks/TASK-501.md]\n---\n${current}`;
    fs.writeFileSync(configFile, patched);
    const audit = auditProject(dir);
    const secrets = audit.findings.filter((f) => f.code === "SECRET_CANONICAL");
    const files = secrets.map((s) => s.message);
    assert.ok(!files.some((m) => /TASK-501/.test(m)), `TASK-501 must be whitelisted; findings: ${files.join(" | ")}`);
    assert.ok(files.some((m) => /TASK-502/.test(m)), "TASK-502 (not whitelisted) must still trigger");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
