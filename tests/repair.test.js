const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");
const { repair } = require("../lib/commands/repair");

test("repair converts legacy Metadata artifacts in canonical directories without losing the body", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-repair-artifacts-"));
  try {
    execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: dir, stdio: "ignore" });
    const scrum = path.join(dir, ".scrumrun");
    const legacy = "# Task: Legacy\n\n## Metadata\n\n- id: TASK-001\n- type: feature\n- status: completed\n- feature: FEAT-001\n- created: 2026-08-31\n\n## Objective\n\nKeep this body byte-for-byte.\n";
    fs.writeFileSync(path.join(scrum, "tasks", "TASK-001.md"), legacy);

    const result = repair(scrum, { apply: true });
    assert.ok(result.applied.applied.some((entry) => entry.file === "tasks/TASK-001.md"));
    const converted = fs.readFileSync(path.join(scrum, "tasks", "TASK-001.md"), "utf8");
    assert.match(converted, /^id: TASK-001$/m);
    assert.match(converted, /^kind: task$/m);
    assert.match(converted, /^status: completed$/m);
    assert.match(converted, /^type: feature$/m);
    assert.match(converted, /^feature: FEAT-001$/m);
    assert.match(converted, /Keep this body byte-for-byte\./);
    assert.ok(fs.existsSync(path.join(scrum, ".migration-backup", "repair", "tasks", "TASK-001.md")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
