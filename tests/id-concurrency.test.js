const assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const test = require("node:test");

const { ArtifactRepository } = require("../lib/v2/artifacts");

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");

test("concurrent backlog starts allocate unique run ids across processes", async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-run-race-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const repository = new ArtifactRepository(path.join(project, ".scrumrun"));
  const common = { created: "2026-08-21", updated: "2026-08-21", method: "2.0.0" };
  const count = 8;
  for (let index = 1; index <= count; index++) {
    repository.write({ ...common, id: `TASK-${String(index).padStart(3, "0")}`, kind: "task", status: "backlog" }, `# Task ${index}\n\n## Request\n\nDo thing ${index}.`);
  }
  const commands = Array.from({ length: count }, (_, index) => {
    const id = `TASK-${String(index + 1).padStart(3, "0")}`;
    return execFileAsync(process.execPath, [bin, "sc", "plan", "task", "--start", id, "--strict"], { cwd: project, encoding: "utf8" });
  });
  await Promise.all(commands);
  const runs = new ArtifactRepository(path.join(project, ".scrumrun")).list("run");
  const ids = runs.map((artifact) => artifact.record.id);
  assert.equal(ids.length, count);
  assert.equal(new Set(ids).size, count, `duplicate run ids allocated: ${ids.join(", ")}`);
});

test("nextId and createMemory serialize under one global create lock", async () => {
  const project = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-id-serialize-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: project, stdio: "ignore" });
  const count = 6;
  const commands = Array.from({ length: count }, (_, index) =>
    execFileAsync(process.execPath, [bin, "sc", "knowledge", "fact", "--add", `Serialized fact ${index}`], { cwd: project, encoding: "utf8" })
  );
  await Promise.all(commands);
  const facts = new ArtifactRepository(path.join(project, ".scrumrun")).list("knowledge");
  const ids = facts.map((artifact) => artifact.record.id);
  assert.equal(ids.length, count);
  assert.equal(new Set(ids).size, count, `duplicate knowledge ids allocated: ${ids.join(", ")}`);
});
