const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const test = require("node:test");

const { ArtifactRepository } = require("../lib/v2/artifacts");
const { authorizeMutation, recordMutation } = require("../lib/runtime/mutation-gateway");
const { approveRequest, finalizeRun, stateIsStale, transitionRun } = require("../lib/runtime/orchestrator");
const { planRequest } = require("../lib/runtime/request-engine");
const { guardrailState, parseRunLedger, validateRunLedger } = require("../lib/runtime/run-ledger");

const root = path.resolve(__dirname, "..");
const bin = path.join(root, "bin", "scrumrun.js");

function project() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-mutation-gateway-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: directory, stdio: "ignore" });
  return directory;
}

function approve(directory, request = "Implement a scoped source change") {
  return approveRequest(directory, planRequest(directory, request).approvalToken);
}

function write(directory, relative, content) {
  const file = path.join(directory, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

test("Mutation Gateway records scoped before/after evidence and permits a verified lifecycle", () => {
  const directory = project();
  const approved = approve(directory);
  const repository = new ArtifactRepository(path.join(directory, ".scrumrun"));
  let run = repository.read("run", approved.run.id);
  assert.equal(run.record.guardrails, 1);
  assert.equal(run.record.workspace, 1);
  assert.equal(guardrailState(run.record, run.body).length, 3);

  const permit = authorizeMutation(directory, approved.run.id, ["src/app.js"]);
  write(directory, "src/app.js", "export const safe = true;\n");
  const recorded = recordMutation(directory, approved.run.id, permit.permit, { note: "Scoped source write verified." });
  assert.deepEqual(recorded.changes.map((item) => item.path), ["src/app.js"]);

  transitionRun(directory, approved.run.id, "validating", { note: "Tests passed." });
  transitionRun(directory, approved.run.id, "learning", { note: "No reusable insight." });
  transitionRun(directory, approved.run.id, "completed", { note: "All gates passed." });
  run = repository.read("run", approved.run.id);
  const ledger = parseRunLedger(run.body);
  assert.equal(ledger.events.filter((event) => event.type === "mutation").length, 1);
  assert.equal(guardrailState(run.record, run.body).every((item) => item.status === "passed"), true);
});

test("lightweight finalization verifies the complete workspace once without edit permits", () => {
  const directory = project();
  const approved = approve(directory);
  const repository = new ArtifactRepository(path.join(directory, ".scrumrun"));
  const task = repository.read("task", approved.task.id);
  fs.writeFileSync(task.file, `${fs.readFileSync(task.file, "utf8")}\n\n## Technical Summary\n\nImplemented the requested source change and ran the final checks.\n`);
  write(directory, "src/session.js", "export const lightweight = true;\n");

  const output = execFileSync(process.execPath, [bin, "sc", "plan", "run", "--finalize", approved.run.id, "--strict"], { cwd: directory, encoding: "utf8" });
  assert.match(output, new RegExp(`${approved.run.id}: completed`));
  const run = repository.read("run", approved.run.id);
  assert.equal(run.record.status, "completed");
  assert.equal(guardrailState(run.record, run.body).every((item) => item.status === "passed"), true);
  assert.equal(validateRunLedger(run.record, run.body).errors.length, 0);
});

test("lightweight finalization fails closed until a manual Guardrail has task evidence", () => {
  const directory = project();
  fs.appendFileSync(path.join(directory, ".scrumrun", "guardrails.md"), "\n## GR-010 - Architecture review\n\nStatus: active\nEnforcement: manual\nScope: completion\nRule: A passed architecture review is required before completion.\n");
  const approved = approve(directory, "Implement a reviewed architecture change");
  const repository = new ArtifactRepository(path.join(directory, ".scrumrun"));
  const task = repository.read("task", approved.task.id);
  fs.writeFileSync(task.file, `${fs.readFileSync(task.file, "utf8")}\n\n## Technical Summary\n\nImplemented and reviewed the architecture change.\n`);
  write(directory, "src/reviewed.js", "export const reviewed = true;\n");
  assert.throws(() => finalizeRun(directory, approved.run.id), /GR-010 needs final evidence/);

  const reviewOutput = execFileSync(process.execPath, [bin, "sc", "review", "artifact", "--record", "--task", approved.task.id, "--run", approved.run.id, "--title", "Architecture review", "--evidence", "Architecture checks passed."], { cwd: directory, encoding: "utf8" });
  assert.match(reviewOutput, /REV-001: passed/);
  fs.appendFileSync(task.file, "\n## Guardrail Evidence\n\n- GR-010 | review | REV-001 | Architecture review passed.\n");
  const result = finalizeRun(directory, approved.run.id);
  assert.equal(result.run.status, "completed");
});

test("Mutation Gateway CLI authorizes and records the declared Run paths", () => {
  const directory = project();
  const approved = approve(directory);
  const authorizeOutput = execFileSync(process.execPath, [bin, "sc", "plan", "run", "--authorize-mutation", approved.run.id, "--path", "src/cli.js"], {
    cwd: directory,
    encoding: "utf8"
  });
  const permit = (authorizeOutput.match(/MUT-[a-f0-9]+/) || [])[0];
  assert.ok(permit);
  write(directory, "src/cli.js", "export const cli = true;\n");
  const recordOutput = execFileSync(process.execPath, [bin, "sc", "plan", "run", "--record-mutation", approved.run.id, "--permit", permit, "--note", "CLI mutation verified."], {
    cwd: directory,
    encoding: "utf8"
  });
  assert.match(recordOutput, new RegExp(`Recorded ${permit}`));
  assert.equal(stateIsStale(path.join(directory, ".scrumrun")), false);
});

test("Mutation Gateway rejects bypass and out-of-scope writes", () => {
  const bypassProject = project();
  const bypass = approve(bypassProject);
  write(bypassProject, "src/unrecorded.js", "export const bypass = true;\n");
  assert.throws(() => transitionRun(bypassProject, bypass.run.id, "validating", { note: "Should fail." }), /BYPASS_DETECTED/);

  const scopedProject = project();
  const scoped = approve(scopedProject);
  const permit = authorizeMutation(scopedProject, scoped.run.id, ["src/allowed.js"]);
  write(scopedProject, "src/outside.js", "export const outside = true;\n");
  assert.throws(() => recordMutation(scopedProject, scoped.run.id, permit.permit), /OUT_OF_SCOPE_MUTATION/);
});

test("Mutation Gateway rejects secrets, unscannable files, and unsafe symlinks", () => {
  const secretProject = project();
  const secretRun = approve(secretProject);
  const secretPermit = authorizeMutation(secretProject, secretRun.run.id, ["src/config.js"]);
  write(secretProject, "src/config.js", "export const api_key = 'super-secret-value-now';\n");
  assert.throws(() => recordMutation(secretProject, secretRun.run.id, secretPermit.permit), /SECRET_BOUNDARY/);

  const binaryProject = project();
  const binaryRun = approve(binaryProject);
  const binaryPermit = authorizeMutation(binaryProject, binaryRun.run.id, ["src/blob.bin"]);
  write(binaryProject, "src/blob.bin", Buffer.from([0, 1, 2, 3]));
  assert.throws(() => recordMutation(binaryProject, binaryRun.run.id, binaryPermit.permit), /UNSCANNABLE_MUTATION/);

  const linkProject = project();
  const linkRun = approve(linkProject);
  const linkPermit = authorizeMutation(linkProject, linkRun.run.id, ["src/link.js"]);
  fs.mkdirSync(path.join(linkProject, "src"), { recursive: true });
  fs.symlinkSync(path.join(os.tmpdir(), "outside.js"), path.join(linkProject, "src", "link.js"));
  assert.throws(() => recordMutation(linkProject, linkRun.run.id, linkPermit.permit), /UNSAFE_MUTATION_TYPE/);
});

test("Mutation Gateway rejects tampered permits", () => {
  const directory = project();
  const approved = approve(directory);
  const permit = authorizeMutation(directory, approved.run.id, ["src/allowed.js"]);
  const file = path.join(directory, ".scrumrun", ".cache", "mutation-permits", `${permit.permit}.json`);
  const payload = JSON.parse(fs.readFileSync(file, "utf8"));
  payload.allowed_paths = ["src/forged.js"];
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
  write(directory, "src/forged.js", "export const forged = true;\n");
  assert.throws(() => recordMutation(directory, approved.run.id, permit.permit), /integrity check failed/);
});

test("Mutation Gateway allows disjoint-path permits and rejects overlapping ones", () => {
  const directory = project();
  const first = approve(directory, "Implement first isolated change");
  const second = approve(directory, "Implement second isolated change");
  const permit = authorizeMutation(directory, first.run.id, ["src/first.js"]);
  assert.ok(permit.permit);
  assert.ok(authorizeMutation(directory, second.run.id, ["src/second.js"]).permit, "disjoint paths may hold concurrent permits");
  assert.throws(() => authorizeMutation(directory, second.run.id, ["src/first.js"]), /overlap an active permit/);
  assert.throws(() => authorizeMutation(directory, second.run.id, ["src/first.js/nested.js"]), /overlap an active permit/);
});

test("permitsOverlap detects shared paths and parent/child prefixes", () => {
  const { permitsOverlap } = require("../lib/runtime/mutation-gateway");
  assert.equal(permitsOverlap(["src/a.js"], ["src/b.js"]), false);
  assert.equal(permitsOverlap(["src/a.js"], ["src/a.js"]), true);
  assert.equal(permitsOverlap(["src/"], ["src/a.js"]), true);
  assert.equal(permitsOverlap(["src/a.js"], ["src/"]), true);
  assert.equal(permitsOverlap([], ["src/a.js"]), false);
});

test("Mutation Gateway binds the full policy surface, including config", () => {
  const directory = project();
  const approved = approve(directory);
  fs.appendFileSync(path.join(directory, ".scrumrun", "config.md"), "\nReview Mode: strict\n");
  assert.throws(() => authorizeMutation(directory, approved.run.id, ["src/policy.js"]), /POLICY_DRIFT/);
});

test("Run ledger detects tampered mutation chains", () => {
  const directory = project();
  const approved = approve(directory);
  const permit = authorizeMutation(directory, approved.run.id, ["src/chain.js"]);
  write(directory, "src/chain.js", "export const chain = true;\n");
  recordMutation(directory, approved.run.id, permit.permit);
  const run = new ArtifactRepository(path.join(directory, ".scrumrun")).read("run", approved.run.id);
  const tampered = run.body.replace(/"workspace_before": "[a-f0-9]{64}"/, `"workspace_before": "${"0".repeat(64)}"`);
  const validation = validateRunLedger(run.record, tampered);
  assert.ok(validation.errors.some((error) => /breaks the mutation chain/.test(error)));
});

test("Run completion rejects unresolved Guardrail obligations", () => {
  const directory = project();
  fs.appendFileSync(path.join(directory, ".scrumrun", "guardrails.md"), `
## GR-010 - Architecture review

Status: active
Enforcement: manual
Scope: completion
Rule: A passed architecture review is required before completion.
`);
  const approved = approve(directory, "Implement a reviewed architecture change");
  transitionRun(directory, approved.run.id, "validating", { note: "Tests passed." });
  transitionRun(directory, approved.run.id, "learning", { note: "Learning reviewed." });
  assert.throws(() => transitionRun(directory, approved.run.id, "completed", { note: "Attempt completion." }), /GUARDRAILS_PENDING: GR-010:completion/);

  const reviewOutput = execFileSync(process.execPath, [bin, "sc", "review", "artifact", "--record", "--task", approved.task.id, "--run", approved.run.id, "--title", "Architecture review", "--evidence", "Architecture checks passed."], {
    cwd: directory,
    encoding: "utf8"
  });
  assert.match(reviewOutput, /REV-001: passed/);
  execFileSync(process.execPath, [bin, "sc", "plan", "run", "--satisfy-guardrail", approved.run.id, "--guardrail", "GR-010", "--review", "REV-001", "--note", "Architecture review passed."], {
    cwd: directory,
    stdio: "ignore"
  });
  assert.equal(stateIsStale(path.join(directory, ".scrumrun")), false);
  const completed = transitionRun(directory, approved.run.id, "completed", { note: "All obligations passed." });
  assert.equal(completed.run.status, "completed");
});

test("recorded Reviews derive failure from the audit and cannot self-declare a pass", () => {
  const directory = project();
  const approved = approve(directory, "Review a deliberately inconsistent artifact set");
  write(directory, ".scrumrun/tasks/TASK-999.md", "malformed canonical task\n");
  assert.throws(() => execFileSync(process.execPath, [bin, "sc", "review", "artifact", "--record", "--task", approved.task.id, "--run", approved.run.id, "--evidence", "Claimed pass must not override the audit."], {
    cwd: directory,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  }));
  const review = new ArtifactRepository(path.join(directory, ".scrumrun")).read("review", "REV-001");
  assert.equal(review.record.status, "failed");
  assert.match(review.body, /passed=false/);
});
