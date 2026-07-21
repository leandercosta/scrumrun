const assert = require("node:assert/strict");
const { execFile, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { promisify } = require("node:util");
const test = require("node:test");

const { ArtifactRepository, METHOD_VERSION, parseArtifact, validateArtifact } = require("../lib/v2/artifacts");
const { indexPath, queryIndex, rebuildIndex } = require("../lib/memory/index");
const { createMemory, transitionMemory } = require("../lib/memory/service");

const execFileAsync = promisify(execFile);
const bin = path.resolve(__dirname, "..", "bin", "scrumrun.js");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-security-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: root, stdio: "ignore" });
  return root;
}

test("malformed and mismatched artifacts are rejected as canonical input", () => {
  const duplicate = parseArtifact(`---
id: TASK-001
id: TASK-002
kind: task
status: backlog
created: 2026-07-21
updated: 2026-07-21
method: 2.0.0
---
# Duplicate
`);
  assert.ok(duplicate.errors.some((error) => /duplicate frontmatter field/.test(error)));
  assert.ok(validateArtifact({ id: "TASK-001", kind: "task", status: "backlog", created: "2026-99-99", updated: "2026-07-21", method: METHOD_VERSION }).some((error) => /real YYYY-MM-DD/.test(error)));

  const root = project();
  const file = path.join(root, ".scrumrun", "tasks", "TASK-001.md");
  fs.writeFileSync(file, `---
id: TASK-002
kind: task
status: backlog
created: 2026-07-21
updated: 2026-07-21
method: 2.0.0
---
# Wrong file
`);
  const artifact = new ArtifactRepository(path.join(root, ".scrumrun")).read("task", "TASK-001");
  assert.ok(artifact.errors.some((error) => /does not match filename/.test(error)));
});

test("canonical writes reject traversal and symlink paths without touching the target", () => {
  const root = project();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-outside-"));
  const scrum = path.join(root, ".scrumrun");
  fs.rmSync(path.join(scrum, "tasks"), { recursive: true });
  fs.symlinkSync(outside, path.join(scrum, "tasks"));
  const repository = new ArtifactRepository(scrum);
  const task = { id: "TASK-001", kind: "task", status: "backlog", created: "2026-07-21", updated: "2026-07-21", method: METHOD_VERSION };

  assert.throws(() => repository.write(task, "# Escaped"), /Symbolic links are forbidden/);
  assert.equal(fs.readdirSync(outside).length, 0);
  assert.throws(() => repository.write({ ...task, id: "../TASK-001" }, "# Traversal"), /invalid task id/);
});

test("evidence cannot follow a symlink outside the project or into a vault", () => {
  const root = project();
  const outside = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-evidence-")), "secret.txt");
  fs.writeFileSync(outside, "outside-secret");
  fs.symlinkSync(outside, path.join(root, "evidence.txt"));
  const fact = createMemory(root, "knowledge", { title: "Unsafe evidence" });
  assert.throws(() => transitionMemory(root, "knowledge", fact.record.id, "approve", { evidence: ["evidence.txt"] }), /Symbolic links are forbidden/);
});

test("malformed method markers stop memory writes before lock or artifact creation", () => {
  const root = project();
  fs.writeFileSync(path.join(root, ".scrumrun", "method.json"), "{broken");
  assert.throws(() => createMemory(root, "insight", { title: "Must not exist" }), /method.json is malformed/);
  assert.equal(new ArtifactRepository(path.join(root, ".scrumrun")).list("insight").length, 0);
});

test("concurrent memory proposals receive unique ids without overwrite", async () => {
  const root = project();
  const commands = Array.from({ length: 8 }, (_, index) => execFileAsync(process.execPath, [bin, "sc", "knowledge", "insight", "--propose", `Concurrent insight ${index}`], {
    cwd: root,
    encoding: "utf8"
  }));
  const results = await Promise.all(commands);
  assert.equal(results.length, 8);
  const artifacts = new ArtifactRepository(path.join(root, ".scrumrun")).list("insight");
  assert.equal(artifacts.length, 8);
  assert.equal(new Set(artifacts.map((artifact) => artifact.record.id)).size, 8);
  for (let index = 0; index < 8; index++) assert.ok(artifacts.some((artifact) => artifact.body.includes(`Concurrent insight ${index}`)));
});

test("secret-like intake is blocked without echo, token, or canonical persistence", () => {
  const root = project();
  const secret = "sk-abcdefghijklmnopqrstuvwxyz123456";
  const output = execFileSync(process.execPath, [bin, "sc", "plan", "intake", `store ${secret}`], { cwd: root, encoding: "utf8" });
  assert.match(output, /Policy: blocked/);
  assert.doesNotMatch(output, new RegExp(secret));
  assert.doesNotMatch(output, /Approval:/);
  assert.equal(new ArtifactRepository(path.join(root, ".scrumrun")).list("task").length, 0);
});

test("semantic memory refuses secret-like content without persisting or echoing it", () => {
  const root = project();
  const secret = "ghp_abcdefghijklmnopqrstuvwxyz1234567890";
  let message = "";
  assert.throws(() => createMemory(root, "insight", { title: `Leaked ${secret}` }), (error) => {
    message = error.message;
    return true;
  });
  assert.doesNotMatch(message, new RegExp(secret));
  assert.equal(new ArtifactRepository(path.join(root, ".scrumrun")).list("insight").length, 0);
});

test("hand-edited canonical secrets are redacted, block intake, and never enter the index", () => {
  const root = project();
  const secret = "password=do-not-leak-this-value";
  const file = path.join(root, ".scrumrun", "tasks", "TASK-001.md");
  fs.writeFileSync(file, `---\nid: TASK-001\nkind: task\nstatus: backlog\ncreated: 2026-07-21\nupdated: 2026-07-21\nmethod: 2.0.0\n---\n# ${secret}\n`);
  const output = execFileSync(process.execPath, [bin, "sc", "plan", "intake", "Inspect project"], { cwd: root, encoding: "utf8" });
  assert.match(output, /Policy: blocked/);
  assert.doesNotMatch(output, /do-not-leak-this-value/);
  assert.throws(() => rebuildIndex(root), /Secret-like content detected in canonical artifact: tasks\/TASK-001\.md/);
});

test("corrupt derived SQLite is rebuilt and query text cannot inject SQL", () => {
  const root = project();
  createMemory(root, "insight", { title: "Safe pricing lookup" });
  rebuildIndex(root);
  fs.writeFileSync(indexPath(root), "not sqlite");
  const result = queryIndex(root, "\" OR 1=1 -- Safe");
  assert.equal(result.rebuilt, true);
  assert.ok(Array.isArray(result.results));
  assert.equal(fs.readFileSync(indexPath(root)).subarray(0, 15).toString(), "SQLite format 3");
});

test("semantic cache refuses symlinked directories and files", () => {
  const root = project();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-cache-outside-"));
  const cache = path.join(root, ".scrumrun", ".cache");
  fs.rmSync(cache, { recursive: true, force: true });
  fs.symlinkSync(outside, cache);
  assert.throws(() => rebuildIndex(root), /Symbolic links are forbidden/);
  assert.equal(fs.readdirSync(outside).length, 0);
});
