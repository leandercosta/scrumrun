"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  ArtifactRepository,
  assertNoSymlinkPath,
  atomicWrite,
  serializeArtifact,
  sha256,
  withArtifactLock
} = require("../v2/artifacts");
const { pendingTransactionStatus, runKernelTransaction } = require("../v2/transaction");
const { configWeakeningAttempts, parseGuardrails, readOnlyPaths, validateGuardrailDocument } = require("./policy-engine");
const { appendGuardrailEvent, appendMutationEvent, guardrailState, parseRunLedger } = require("./run-ledger");
const { changesBetween, normalizedRelative, pathAuthorized, stable, workspaceState } = require("./workspace-state");
const { containsSecret } = require("../security/secrets");

const PERMIT_SCHEMA = 1;
const PERMIT_TTL_MS = 15 * 60 * 1000;

function readProjectMethod(projectRoot) {
  const file = path.join(projectRoot, ".scrumrun", "method.json");
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Mutation Gateway requires a valid method.json: ${error.message}`);
  }
}

function policyState(projectRoot) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const file = assertNoSymlinkPath(scrumDir, path.join(scrumDir, "guardrails.md"));
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error("Canonical guardrails.md is missing or unsafe.");
  const content = fs.readFileSync(file, "utf8");
  const validation = validateGuardrailDocument(content);
  const method = readProjectMethod(projectRoot);
  const strict = method.schemas && method.schemas.guardrails === 1;
  const errors = [...validation.errors];
  if (strict) {
    for (const record of validation.records) {
      for (const field of ["status", "enforcement", "scope", "rule"]) {
        if (!record.explicit[field]) errors.push(`${record.id} must explicitly declare ${field}.`);
      }
    }
  }
  if (!validation.records.some((record) => record.status === "active")) errors.push("At least one active Guardrail is required.");
  const configFile = path.join(scrumDir, "config.md");
  const config = fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8") : "";
  errors.push(...configWeakeningAttempts(config));
  if (errors.length) throw new Error(`Guardrail policy is not enforceable: ${errors.join("; ")}`);
  return {
    file,
    content,
    config,
    fingerprint: sha256(stable({ schema: 1, guardrails: content, config, method: method.method, schemas: method.schemas || {} })),
    guardrails: validation.records.filter((record) => record.status === "active")
  };
}

function assertCanonicalWrite(projectRoot, operation, contents = []) {
  const method = readProjectMethod(projectRoot);
  const guardrails = path.join(projectRoot, ".scrumrun", "guardrails.md");
  const strict = method.schemas && method.schemas.guardrails === 1;
  if (!strict && !fs.existsSync(guardrails)) {
    if (contents.some((value) => containsSecret(value))) throw new Error(`SECRET_BOUNDARY: ${operation} contains secret-like canonical content.`);
    return { operation, policy: "legacy-unbound" };
  }
  const policy = policyState(projectRoot);
  if (contents.some((value) => containsSecret(value))) throw new Error(`SECRET_BOUNDARY: ${operation} contains secret-like canonical content.`);
  const transactions = pendingTransactionStatus(path.join(projectRoot, ".scrumrun"));
  if (transactions.error) throw new Error(`TRANSACTION_GATE: ${transactions.error}`);
  if (transactions.pending.length) throw new Error(`TRANSACTION_GATE: pending canonical transaction ${transactions.pending.map((item) => item.id).join(", ")}.`);
  return { operation, policy: policy.fingerprint };
}

function publicWorkspace(value) {
  return {
    schema: 1,
    mode: value.mode,
    head: value.head || null,
    fingerprint: value.fingerprint,
    files: value.files.map((item) => ({ path: item.path, sha256: item.sha256, kind: item.kind, mode: item.mode, scan: item.scan }))
  };
}

function initialEvent(runArtifact) {
  const parsed = parseRunLedger(runArtifact.body);
  if (parsed.errors.length || !parsed.events.length) throw new Error(`Run ledger is invalid: ${parsed.errors.join("; ") || "missing events"}`);
  return parsed.events[0];
}

function expectedWorkspace(runArtifact) {
  const events = parseRunLedger(runArtifact.body).events;
  const mutation = [...events].reverse().find((event) => event.type === "mutation");
  return mutation ? mutation.workspace_after : events[0] && events[0].workspace_baseline;
}

function assertPolicyBound(runArtifact, policy) {
  const event = initialEvent(runArtifact);
  if (!event.policy_fingerprint) throw new Error(`${runArtifact.record.id} predates enforceable Guardrail binding; migrate or retry it before mutation.`);
  if (event.policy_fingerprint !== policy.fingerprint) {
    throw new Error(`POLICY_DRIFT: guardrails.md changed after ${runArtifact.record.id} approval; start a newly approved Run.`);
  }
}

function assertWorkspaceExpected(runArtifact, actual) {
  const expected = expectedWorkspace(runArtifact);
  if (!expected) throw new Error(`${runArtifact.record.id} has no canonical workspace baseline; migrate or retry it before mutation.`);
  if (expected.fingerprint !== actual.fingerprint) {
    throw new Error(`BYPASS_DETECTED: workspace fingerprint differs from ${runArtifact.record.id}'s last authorized mutation.`);
  }
  return expected;
}

function permitsDirectory(scrumDir) {
  const directory = assertNoSymlinkPath(scrumDir, path.join(scrumDir, ".cache", "mutation-permits"));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

function mutationKey(scrumDir, { create = false } = {}) {
  const file = assertNoSymlinkPath(scrumDir, path.join(scrumDir, ".cache", "mutation-gateway.key"));
  if (!fs.existsSync(file)) {
    if (!create) throw new Error("Mutation Gateway key is missing; outstanding permits are invalid.");
    atomicWrite(file, crypto.randomBytes(32));
    fs.chmodSync(file, 0o600);
  }
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Mutation Gateway key path is unsafe.");
  const key = fs.readFileSync(file);
  if (key.length !== 32) throw new Error("Mutation Gateway key is malformed.");
  return key;
}

function permitIntegrity(permit, key) {
  const { integrity, ...payload } = permit;
  return crypto.createHmac("sha256", key).update(stable(payload)).digest("hex");
}

function assertPermitIntegrity(permit, key) {
  const expected = permitIntegrity(permit, key);
  const actual = String(permit && permit.integrity || "");
  if (!/^[a-f0-9]{64}$/.test(actual) || !crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected))) {
    throw new Error(`Mutation permit integrity check failed: ${permit && permit.id || "unknown"}.`);
  }
}

function permitFile(scrumDir, permitId) {
  if (!/^MUT-[A-Za-z0-9-]{8,}$/.test(String(permitId || ""))) throw new Error("Mutation permit id is invalid.");
  return assertNoSymlinkPath(scrumDir, path.join(permitsDirectory(scrumDir), `${permitId}.json`));
}

function activePermitFiles(scrumDir) {
  const directory = permitsDirectory(scrumDir);
  const now = Date.now();
  const active = [];
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const key = entries.length ? mutationKey(scrumDir) : null;
  for (const entry of entries) {
    if (!entry.isFile() || !/^MUT-[A-Za-z0-9-]{8,}\.json$/.test(entry.name)) throw new Error(`Unsafe Mutation Gateway cache entry: ${entry.name}`);
    const file = path.join(directory, entry.name);
    let permit;
    try {
      permit = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      throw new Error(`Mutation permit is malformed: ${entry.name}: ${error.message}`);
    }
    assertPermitIntegrity(permit, key);
    if (Date.parse(permit.expires_at) <= now) fs.rmSync(file, { force: true });
    else active.push({ file, permit });
  }
  return active;
}

function validateAllowedPaths(projectRoot, policy, paths) {
  const allowed = [...new Set((Array.isArray(paths) ? paths : [paths]).map((value) => normalizedRelative(projectRoot, value)))];
  if (!allowed.length) throw new Error("Mutation Gateway requires at least one explicit --path.");
  const readOnly = readOnlyPaths(policy.config).map((value) => normalizedRelative(projectRoot, value));
  const forbidden = allowed.filter((entry) => readOnly.some((item) => entry === item || entry.startsWith(`${item}/`) || item.startsWith(`${entry}/`)));
  if (forbidden.length) throw new Error(`READ_ONLY_PATH: mutation scope overlaps ${forbidden.join(", ")}.`);
  return allowed.sort();
}

function pathOverlaps(a, b) {
  if (a === b) return true;
  const aPrefix = a.endsWith("/") ? a : `${a}/`;
  const bPrefix = b.endsWith("/") ? b : `${b}/`;
  return a.startsWith(bPrefix) || b.startsWith(aPrefix);
}

function permitsOverlap(pathsA, pathsB) {
  return (pathsA || []).some((a) => (pathsB || []).some((b) => pathOverlaps(a, b)));
}

function authorizeMutationUnlocked(projectRoot, runId, paths, options = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const repository = new ArtifactRepository(scrumDir);
  const run = repository.read("run", runId);
  if (!run || run.errors.length) throw new Error(`Mutation Run is missing or invalid: ${runId}`);
  if (run.record.status !== "executing") throw new Error(`Mutation permits require an executing Run; ${runId} is ${run.record.status}.`);
  if (run.record.workspace !== 1 || run.record.guardrails !== 1) throw new Error(`${runId} predates the secure Run schemas; migrate or retry it.`);
  const policy = policyState(projectRoot);
  assertPolicyBound(run, policy);
  const actual = workspaceState(projectRoot);
  assertWorkspaceExpected(run, actual);
  const allowed = validateAllowedPaths(projectRoot, policy, paths);
  const outstanding = activePermitFiles(scrumDir);
  const overlapping = outstanding.filter((item) => permitsOverlap(item.permit.allowed_paths, allowed));
  if (overlapping.length) throw new Error(`Mutation permit paths overlap an active permit: ${overlapping.map((item) => item.permit.id).join(", ")}.`);
  const created = new Date();
  const permit = {
    schema: PERMIT_SCHEMA,
    id: `MUT-${crypto.randomBytes(12).toString("hex")}`,
    run: runId,
    created_at: created.toISOString(),
    expires_at: new Date(created.getTime() + (options.ttlMs || PERMIT_TTL_MS)).toISOString(),
    policy_fingerprint: policy.fingerprint,
    workspace_before: actual,
    allowed_paths: allowed
  };
  permit.integrity = permitIntegrity(permit, mutationKey(scrumDir, { create: true }));
  const file = permitFile(scrumDir, permit.id);
  atomicWrite(file, `${JSON.stringify(permit, null, 2)}\n`);
  fs.chmodSync(file, 0o600);
  return { permit: permit.id, run: runId, expiresAt: permit.expires_at, paths: allowed };
}

function authorizeMutation(projectRoot, runId, paths, options = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  return withArtifactLock(scrumDir, "mutation-gateway", () => authorizeMutationUnlocked(projectRoot, runId, paths, options));
}

function readPermit(scrumDir, permitId) {
  const file = permitFile(scrumDir, permitId);
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error(`Mutation permit not found: ${permitId}`);
  let permit;
  try {
    permit = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Mutation permit is malformed: ${error.message}`);
  }
  if (permit.schema !== PERMIT_SCHEMA || permit.id !== permitId) throw new Error("Mutation permit identity or schema is invalid.");
  assertPermitIntegrity(permit, mutationKey(scrumDir));
  if (Date.parse(permit.expires_at) <= Date.now()) throw new Error(`Mutation permit expired: ${permitId}`);
  return { file, permit };
}

function recordMutationUnlocked(projectRoot, runId, permitId, options = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const repository = new ArtifactRepository(scrumDir);
  const run = repository.read("run", runId);
  if (!run || run.errors.length) throw new Error(`Mutation Run is missing or invalid: ${runId}`);
  if (run.record.status !== "executing") throw new Error(`Mutation recording requires an executing Run; ${runId} is ${run.record.status}.`);
  const { file: permitPath, permit } = readPermit(scrumDir, permitId);
  if (permit.run !== runId) throw new Error(`Mutation permit belongs to ${permit.run}, not ${runId}.`);
  const policy = policyState(projectRoot);
  assertPolicyBound(run, policy);
  if (permit.policy_fingerprint !== policy.fingerprint) throw new Error("POLICY_DRIFT: mutation permit policy is stale.");
  const expected = expectedWorkspace(run);
  if (!expected || expected.fingerprint !== permit.workspace_before.fingerprint) throw new Error("BYPASS_DETECTED: Run workspace advanced after this permit was issued.");
  const after = workspaceState(projectRoot);
  const changes = changesBetween(permit.workspace_before, after);
  if (!changes.length) throw new Error("Mutation permit produced no workspace change.");
  const outside = changes.filter((change) => !pathAuthorized(change.path, permit.allowed_paths));
  if (outside.length) throw new Error(`OUT_OF_SCOPE_MUTATION: ${outside.map((item) => item.path).join(", ")}.`);
  const unsafeKinds = changes.filter((change) => !["file", "missing", "clean"].includes(change.after_kind));
  if (unsafeKinds.length) throw new Error(`UNSAFE_MUTATION_TYPE: ${unsafeKinds.map((item) => item.path).join(", ")}.`);
  const unscannable = changes.filter((change) => change.after_kind === "file" && change.after_scan !== "text");
  if (unscannable.length) throw new Error(`UNSCANNABLE_MUTATION: secret inspection was not possible for ${unscannable.map((item) => item.path).join(", ")}.`);
  const leaked = changes.filter((change) => change.new_secret_fingerprints.length);
  if (leaked.length) throw new Error(`SECRET_BOUNDARY: new secret-like content detected in ${leaked.map((item) => item.path).join(", ")}.`);
  const mutation = {
    mutation_id: permit.id,
    paths: permit.allowed_paths,
    changes: changes.map(({ new_secret_fingerprints, ...change }) => change),
    workspace_before: permit.workspace_before.fingerprint,
    workspace_after: publicWorkspace(after),
    policy_fingerprint: policy.fingerprint
  };
  const previous = fs.readFileSync(run.file, "utf8");
  const appended = appendMutationEvent(run.record, run.body, mutation, {
    note: options.note || `Recorded ${changes.length} authorized workspace change(s).`,
    actor: options.actor || "agent",
    evidence: options.evidence && options.evidence.length ? options.evidence : [{ kind: "mutation", ref: permit.id, summary: `${changes.length} scoped path change(s) verified.` }]
  });
  runKernelTransaction(scrumDir, "record-workspace-mutation", [{
    file: run.file,
    previous,
    next: serializeArtifact(appended.record, appended.body)
  }]);
  const verifiedAfter = workspaceState(projectRoot);
  fs.rmSync(permitPath, { force: true });
  if (verifiedAfter.fingerprint !== after.fingerprint) {
    throw new Error("POST_RECORD_DRIFT: workspace changed while mutation evidence was being committed.");
  }
  return { run: appended.record, mutation: permit.id, changes: mutation.changes };
}

function recordMutation(projectRoot, runId, permitId, options = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  return withArtifactLock(scrumDir, "mutation-gateway", () => recordMutationUnlocked(projectRoot, runId, permitId, options));
}

function verifyWorkspaceIntegrity(projectRoot, runArtifact) {
  if (runArtifact.record.workspace !== 1) return { status: "legacy", fingerprint: null };
  const actual = workspaceState(projectRoot);
  assertWorkspaceExpected(runArtifact, actual);
  const policy = policyState(projectRoot);
  assertPolicyBound(runArtifact, policy);
  return { status: "passed", fingerprint: actual.fingerprint, policy: policy.fingerprint };
}

function requiredEvidenceKind(enforcement) {
  if (enforcement === "builtin:migration-integrity") return "migration";
  if (["builtin:review-gate", "builtin:canonical-truth", "builtin:canonical-write", "manual"].includes(enforcement)) return "review";
  return null;
}

function assertGateEvidence(projectRoot, repository, kind, evidence, guardrailId) {
  if (!kind) return;
  const matching = evidence.filter((item) => item && item.kind === kind);
  if (!matching.length) throw new Error(`${guardrailId} requires ${kind} evidence.`);
  if (kind === "review") {
    const passed = matching.some((item) => {
      if (!/^REV-\d{3,}$/.test(item.ref || "")) return false;
      const review = repository.read("review", item.ref);
      return review && !review.errors.length && review.record.status === "passed" && /^## (?:Validation )?Evidence\s*$/m.test(review.body);
    });
    if (!passed) throw new Error(`${guardrailId} requires a canonical passed REV-NNN reference.`);
  }
  if (kind === "migration") {
    const referenced = matching.some((item) => {
      if (typeof item.ref !== "string" || !item.ref.trim()) return false;
      try {
        const relative = normalizedRelative(projectRoot, item.ref);
        const target = assertNoSymlinkPath(projectRoot, path.join(projectRoot, relative));
        return fs.existsSync(target) && fs.lstatSync(target).isFile();
      } catch {
        return false;
      }
    });
    if (!referenced) throw new Error(`${guardrailId} requires an existing, safe migration evidence file.`);
  }
}

function satisfyGuardrailUnlocked(projectRoot, runId, guardrailId, options = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const repository = new ArtifactRepository(scrumDir);
  const run = repository.read("run", runId);
  if (!run || run.errors.length) throw new Error(`Guardrail Run is missing or invalid: ${runId}`);
  if (!["executing", "validating", "learning"].includes(run.record.status)) throw new Error(`Cannot satisfy Guardrails for terminal ${runId}.`);
  const policy = policyState(projectRoot);
  assertPolicyBound(run, policy);
  const obligation = guardrailState(run.record, run.body).find((item) => item.guardrail === guardrailId);
  if (!obligation) throw new Error(`${guardrailId} is not an obligation of ${runId}.`);
  const evidence = Array.isArray(options.evidence) ? options.evidence : [];
  const kind = requiredEvidenceKind(obligation.enforcement);
  assertGateEvidence(projectRoot, repository, kind, evidence, guardrailId);
  if (["builtin:owner-work", "builtin:read-only-path", "builtin:secret-boundary"].includes(obligation.enforcement)) {
    const verified = verifyWorkspaceIntegrity(projectRoot, run);
    evidence.push({ kind: "mutation", summary: `Workspace chain verified at ${verified.fingerprint}.` });
  }
  if (!evidence.length) throw new Error(`${guardrailId} requires structured evidence.`);
  const previous = fs.readFileSync(run.file, "utf8");
  const appended = appendGuardrailEvent(run.record, run.body, obligation, "passed", {
    note: options.note || `${guardrailId} passed its ${obligation.gate} gate.`,
    actor: options.actor || "agent",
    evidence
  });
  runKernelTransaction(scrumDir, "satisfy-run-guardrail", [{ file: run.file, previous, next: serializeArtifact(appended.record, appended.body) }]);
  return { run: appended.record, guardrail: guardrailId, status: "passed" };
}

function satisfyGuardrail(projectRoot, runId, guardrailId, options = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  return withArtifactLock(scrumDir, `run-${String(runId).toLowerCase()}`, () => satisfyGuardrailUnlocked(projectRoot, runId, guardrailId, options));
}

function assertCompletionAllowed(projectRoot, runArtifact) {
  if (runArtifact.record.guardrails !== 1 || runArtifact.record.workspace !== 1) return { status: "legacy" };
  const policy = policyState(projectRoot);
  assertPolicyBound(runArtifact, policy);
  verifyWorkspaceIntegrity(projectRoot, runArtifact);
  const pending = guardrailState(runArtifact.record, runArtifact.body).filter((item) => item.status !== "passed");
  if (pending.length) throw new Error(`GUARDRAILS_PENDING: ${pending.map((item) => `${item.guardrail}:${item.gate}`).join(", ")}.`);
  const transactions = pendingTransactionStatus(path.join(projectRoot, ".scrumrun"));
  if (transactions.error || transactions.pending.length) throw new Error(`TRANSACTION_GATE: ${transactions.error || "pending canonical transaction"}.`);
  return { status: "passed", policy: policy.fingerprint };
}

function prepareCompletion(projectRoot, runArtifact, options = {}) {
  if (runArtifact.record.guardrails !== 1 || runArtifact.record.workspace !== 1) {
    return { record: runArtifact.record, body: runArtifact.body, resolved: [], status: "legacy" };
  }
  const policy = policyState(projectRoot);
  assertPolicyBound(runArtifact, policy);
  const verified = verifyWorkspaceIntegrity(projectRoot, runArtifact);
  const automatic = new Set(["builtin:owner-work", "builtin:read-only-path", "builtin:secret-boundary"]);
  let record = runArtifact.record;
  let body = runArtifact.body;
  const resolved = [];
  for (const obligation of guardrailState(record, body).filter((item) => item.status !== "passed" && automatic.has(item.enforcement))) {
    const appended = appendGuardrailEvent(record, body, obligation, "passed", {
      note: `${obligation.guardrail} passed the automatic completion workspace check.`,
      actor: "mutation-gateway",
      occurredAt: options.occurredAt,
      evidence: [{ kind: "mutation", summary: `Workspace chain verified at ${verified.fingerprint}.` }]
    });
    record = appended.record;
    body = appended.body;
    resolved.push(obligation.guardrail);
  }
  const pending = guardrailState(record, body).filter((item) => item.status !== "passed");
  if (pending.length) throw new Error(`GUARDRAILS_PENDING: ${pending.map((item) => `${item.guardrail}:${item.gate}`).join(", ")}.`);
  const transactions = pendingTransactionStatus(path.join(projectRoot, ".scrumrun"));
  if (transactions.error || transactions.pending.length) throw new Error(`TRANSACTION_GATE: ${transactions.error || "pending canonical transaction"}.`);
  return { record, body, resolved, status: "passed" };
}

// The normal v3 path is session based: an agent works freely after approval
// and the kernel verifies the complete workspace delta once, at completion.
// The older permit chain remains available for strict teams, but is no longer
// required to produce trustworthy evidence for ordinary work.
function prepareSessionCompletion(projectRoot, runArtifact, options = {}) {
  if (runArtifact.record.guardrails !== 1 || runArtifact.record.workspace !== 1) {
    return { record: runArtifact.record, body: runArtifact.body, changes: [], resolved: [], status: "legacy" };
  }
  const policy = policyState(projectRoot);
  assertPolicyBound(runArtifact, policy);
  const baseline = expectedWorkspace(runArtifact);
  if (!baseline) throw new Error(`${runArtifact.record.id} has no workspace baseline; retry the Task before finalizing.`);
  const actual = workspaceState(projectRoot);
  const changes = changesBetween(baseline, actual);
  const readOnly = readOnlyPaths(policy.config).map((value) => normalizedRelative(projectRoot, value));
  const protectedChanges = changes.filter((change) => readOnly.some((item) => change.path === item || change.path.startsWith(`${item}/`)));
  if (protectedChanges.length) throw new Error(`READ_ONLY_PATH: final workspace check found changes in ${protectedChanges.map((item) => item.path).join(", ")}.`);
  const unsafeKinds = changes.filter((change) => !["file", "missing", "clean"].includes(change.after_kind));
  if (unsafeKinds.length) throw new Error(`UNSAFE_MUTATION_TYPE: final workspace check found ${unsafeKinds.map((item) => item.path).join(", ")}.`);
  const unscannable = changes.filter((change) => change.after_kind === "file" && change.after_scan !== "text");
  if (unscannable.length) throw new Error(`UNSCANNABLE_MUTATION: final workspace check cannot inspect ${unscannable.map((item) => item.path).join(", ")}.`);
  const leaked = changes.filter((change) => change.new_secret_fingerprints.length);
  if (leaked.length) throw new Error(`SECRET_BOUNDARY: final workspace check found secret-like content in ${leaked.map((item) => item.path).join(", ")}.`);

  let record = runArtifact.record;
  let body = runArtifact.body;
  if (changes.length) {
    const appended = appendMutationEvent(record, body, {
      mutation_id: `MUT-${sha256(`${runArtifact.record.id}:${baseline.fingerprint}:${actual.fingerprint}`).slice(0, 16)}`,
      paths: changes.map((change) => change.path).sort(),
      changes: changes.map(({ new_secret_fingerprints, ...change }) => change),
      workspace_before: baseline.fingerprint,
      workspace_after: publicWorkspace(actual),
      policy_fingerprint: policy.fingerprint
    }, {
      note: options.note || `Final session audit verified ${changes.length} workspace change(s).`,
      actor: options.actor || "agent",
      evidence: [{ kind: "mutation", summary: `${changes.length} changed path(s) passed the final workspace audit.` }]
    });
    record = appended.record;
    body = appended.body;
  }
  const resolved = [];
  const repository = new ArtifactRepository(path.join(projectRoot, ".scrumrun"));
  const supplied = options.guardrailEvidence || {};
  const automatic = new Set(["builtin:owner-work", "builtin:read-only-path", "builtin:secret-boundary"]);
  for (const obligation of guardrailState(record, body).filter((item) => item.status !== "passed")) {
    const evidence = automatic.has(obligation.enforcement)
      ? [{ kind: "mutation", summary: "Verified by the final workspace audit." }]
      : Array.isArray(supplied[obligation.guardrail]) ? supplied[obligation.guardrail] : [];
    if (!evidence.length) {
      throw new Error(`GUARDRAILS_PENDING: ${obligation.guardrail} needs final evidence in the Task's ## Guardrail Evidence section.`);
    }
    assertGateEvidence(projectRoot, repository, requiredEvidenceKind(obligation.enforcement), evidence, obligation.guardrail);
    const appended = appendGuardrailEvent(record, body, obligation, "passed", {
      note: `${obligation.guardrail} passed at the final session checkpoint.`,
      actor: "finalize",
      occurredAt: options.occurredAt,
      evidence
    });
    record = appended.record;
    body = appended.body;
    resolved.push(obligation.guardrail);
  }
  const transactions = pendingTransactionStatus(path.join(projectRoot, ".scrumrun"));
  if (transactions.error || transactions.pending.length) throw new Error(`TRANSACTION_GATE: ${transactions.error || "pending canonical transaction"}.`);
  return { record, body, changes, resolved, status: "passed", policy: policy.fingerprint };
}

function auditActiveWorkspace(projectRoot, runArtifact) {
  try {
    if (!runArtifact.record || runArtifact.record.workspace !== 1 || ["completed", "failed", "blocked"].includes(runArtifact.record.status)) return null;
    // Session Runs intentionally accumulate unrecorded workspace changes until
    // their single final checkpoint. Those changes are audited by --finalize,
    // not reported as a strict-mode bypass while work is still in progress.
    if (runArtifact.record.execution === "session") return null;
    verifyWorkspaceIntegrity(projectRoot, runArtifact);
    return null;
  } catch (error) {
    return error.message;
  }
}

module.exports = {
  PERMIT_SCHEMA,
  assertCanonicalWrite,
  assertCompletionAllowed,
  auditActiveWorkspace,
  authorizeMutation,
  expectedWorkspace,
  pathOverlaps,
  permitsOverlap,
  policyState,
  prepareCompletion,
  prepareSessionCompletion,
  publicWorkspace,
  recordMutation,
  satisfyGuardrail,
  verifyWorkspaceIntegrity,
  workspaceState
};
