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

test("repair reconciles Task.sprint references into the Sprint projection", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-repair-membership-"));
  try {
    execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: dir, stdio: "ignore" });
    const scrum = path.join(dir, ".scrumrun");
    fs.writeFileSync(path.join(scrum, "sprints", "SPRINT-001.md"), "---\nid: SPRINT-001\nkind: sprint\nstatus: proposed\ncreated: 2026-08-31\nupdated: 2026-08-31\nmethod: 2.0.0\n---\n\n# Sprint\n\n## Tasks\n\n- TASK-001\n\n## Notes\n\nKeep notes.\n");
    fs.writeFileSync(path.join(scrum, "tasks", "TASK-002.md"), "---\nid: TASK-002\nkind: task\nstatus: completed\ncreated: 2026-08-31\nupdated: 2026-08-31\nmethod: 2.0.0\ntype: feature\nfeature: null\nsprint: SPRINT-001\n---\n\n# Task\n\n## Acceptance Criteria\n\n- Done\n");
    const result = repair(scrum, { apply: true });
    assert.ok(result.applied.applied.some((entry) => entry.file === "sprints/SPRINT-001.md"));
    const sprint = fs.readFileSync(path.join(scrum, "sprints", "SPRINT-001.md"), "utf8");
    assert.match(sprint, /^- TASK-002$/m);
    assert.match(sprint, /Keep notes\./);
    assert.ok(fs.existsSync(path.join(scrum, ".migration-backup", "repair", "sprints", "SPRINT-001.md")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("repair explicitly recovers an active Task with no Run without inventing history", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-repair-orphan-task-"));
  try {
    execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: dir, stdio: "ignore" });
    const scrum = path.join(dir, ".scrumrun");
    const taskFile = path.join(scrum, "tasks", "TASK-001.md");
    fs.writeFileSync(taskFile, "---\nid: TASK-001\nkind: task\nstatus: running\ncreated: 2026-08-31\nupdated: 2026-08-31\nmethod: 2.0.0\ntype: task\nfeature: null\nsprint: null\n---\n\n# Recover me\n\n## Acceptance Criteria\n\n- Resume with a real Run.\n");

    const preview = repair(scrum);
    assert.equal(preview.plan.orphanTasks.length, 1);
    assert.match(preview.report, /not changed automatically/);
    assert.match(preview.report, /--recover-orphan-tasks --apply/);
    assert.match(fs.readFileSync(taskFile, "utf8"), /^status: running$/m);

    const applied = repair(scrum, { apply: true, recoverOrphanTasks: true });
    assert.equal(applied.applied.recoveredTasks.length, 1);
    assert.match(fs.readFileSync(taskFile, "utf8"), /^status: backlog$/m);
    assert.ok(fs.existsSync(path.join(scrum, ".migration-backup", "repair", "tasks", "TASK-001.md")));
    assert.deepEqual(fs.readdirSync(path.join(scrum, "runs")).filter((name) => /^RUN-/.test(name)), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
