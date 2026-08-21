"use strict";

const crypto = require("node:crypto");

const {
  ARTIFACT_TRANSITIONS,
  GUARDRAIL_RESULTS,
  RUN_EVENT_TYPES,
  RUN_EVIDENCE_KINDS,
  RUN_LEDGER_VERSION
} = require("../v2/schema");
const { containsSecret } = require("../security/secrets");

const EVENT_ID = /^(RUN-\d{3,})-EVT-(\d{3,})$/;
const RFC3339 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/;

function instant(value = new Date()) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error("Run event timestamp is invalid.");
  return parsed.toISOString();
}

function dateInstant(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) throw new Error(`Legacy Run event date is invalid: ${value || "missing"}`);
  return `${value}T00:00:00.000Z`;
}

function eventId(runId, sequence) {
  return `${runId}-EVT-${String(sequence).padStart(3, "0")}`;
}

function normalizeEvidence(evidence = []) {
  if (!Array.isArray(evidence)) throw new Error("Run event evidence must be an array.");
  return evidence.map((item) => {
    if (typeof item === "string") return { kind: "note", summary: item.trim() };
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    const normalized = { kind: item.kind };
    if (item.ref !== undefined && item.ref !== null) normalized.ref = String(item.ref).trim();
    if (item.summary !== undefined && item.summary !== null) normalized.summary = String(item.summary).trim();
    return normalized;
  });
}

function evidenceForTransition(nextStatus, note, evidence = []) {
  const normalized = normalizeEvidence(evidence);
  if (note && !normalized.length) {
    const kind = nextStatus === "validating" ? "test" : nextStatus === "learning" ? "insight" : nextStatus === "blocked" || nextStatus === "failed" ? "risk" : "note";
    normalized.push({ kind, summary: String(note).trim() });
  }
  return normalized;
}

function makeRunEvent({
  runId,
  sequence,
  type = "transition",
  occurredAt = instant(),
  timestampPrecision = "instant",
  actor = "agent",
  from,
  to,
  reason,
  evidence = [],
  ...details
}) {
  return {
    schema: RUN_LEDGER_VERSION,
    id: eventId(runId, sequence),
    sequence,
    type,
    occurred_at: occurredAt,
    timestamp_precision: timestampPrecision,
    actor,
    from: from === undefined ? null : from,
    to,
    reason,
    evidence: normalizeEvidence(evidence),
    ...details
  };
}

function renderRunEvent(event) {
  return `### ${event.id}\n\n\`\`\`json\n${JSON.stringify(event, null, 2)}\n\`\`\``;
}

function eventsSection(events) {
  return `## Events\n\n${events.map(renderRunEvent).join("\n\n")}`;
}

function runTitle(body, fallback) {
  return ((body || "").match(/^# ([^\r\n]+)$/m) || [])[1] || fallback;
}

function createRunBody(record, {
  title = `Run for ${record.task}`,
  approvalId = null,
  occurredAt = instant(),
  actor = "owner",
  reason = "Explicit approval accepted.",
  evidence = null,
  obligations = [],
  policyFingerprint = null,
  workspaceBaseline = null
} = {}) {
  const eventEvidence = evidence || [{
    kind: "approval",
    ...(approvalId ? { ref: `approval:${approvalId}` } : {}),
    summary: reason
  }];
  const event = makeRunEvent({
    runId: record.id,
    sequence: 1,
    occurredAt,
    actor,
    from: "created",
    to: "executing",
    reason,
    evidence: eventEvidence,
    ...(policyFingerprint ? { policy_fingerprint: policyFingerprint } : {}),
    ...(workspaceBaseline ? { workspace_baseline: workspaceBaseline } : {})
  });
  const declarations = obligations.map((obligation, index) => makeRunEvent({
    runId: record.id,
    sequence: index + 2,
    type: "guardrail",
    occurredAt,
    actor: "policy-engine",
    from: "executing",
    to: "executing",
    reason: `Guardrail obligation declared for ${obligation.gate}.`,
    evidence: [{ kind: "guardrail", ref: obligation.guardrail, summary: `${obligation.code} must pass at ${obligation.gate}.` }],
    guardrail: obligation.guardrail,
    code: obligation.code,
    enforcement: obligation.enforcement,
    gate: obligation.gate,
    result: "pending",
    scope: obligation.scope || []
  }));
  const events = [event, ...declarations];
  return { body: `# ${title}\n\n${eventsSection(events)}`, event, events };
}

function validateWorkspaceState(value, label) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return [`${label} must be an object`];
  if (value.schema !== 1) errors.push(`${label}.schema must be 1`);
  if (!['git', 'files'].includes(value.mode)) errors.push(`${label}.mode must be git or files`);
  if (!/^[a-f0-9]{64}$/.test(value.fingerprint || "")) errors.push(`${label}.fingerprint must be sha256`);
  if (!Array.isArray(value.files)) errors.push(`${label}.files must be an array`);
  const paths = new Set();
  for (const item of Array.isArray(value.files) ? value.files : []) {
    if (!item || typeof item !== "object" || typeof item.path !== "string" || !item.path || item.path.startsWith("/") || item.path.split("/").includes("..")) {
      errors.push(`${label}.files contains an unsafe path`);
      continue;
    }
    if (paths.has(item.path)) errors.push(`${label}.files contains duplicate path: ${item.path}`);
    paths.add(item.path);
    if (item.sha256 !== null && !/^[a-f0-9]{64}$/.test(item.sha256 || "")) errors.push(`${label}.${item.path}.sha256 is invalid`);
    if (!["file", "missing", "symlink", "other", "clean"].includes(item.kind)) errors.push(`${label}.${item.path}.kind is invalid`);
    if (item.mode !== null && (!Number.isInteger(item.mode) || item.mode < 0 || item.mode > 0o777)) errors.push(`${label}.${item.path}.mode is invalid`);
    if (!["text", "binary", "too-large", "not-applicable"].includes(item.scan)) errors.push(`${label}.${item.path}.scan is invalid`);
    if (item.kind === "file" && !["text", "binary", "too-large"].includes(item.scan)) errors.push(`${label}.${item.path}.scan is invalid for a file`);
    if (item.kind !== "file" && item.scan !== "not-applicable") errors.push(`${label}.${item.path}.scan must be not-applicable`);
  }
  const canonical = value && {
    schema: value.schema,
    mode: value.mode,
    head: value.head || null,
    files: Array.isArray(value.files) ? value.files.map((item) => ({ path: item.path, sha256: item.sha256, kind: item.kind, mode: item.mode, scan: item.scan })) : []
  };
  const fingerprint = crypto.createHash("sha256").update(stableJson(canonical)).digest("hex");
  if (value && value.fingerprint !== fingerprint) errors.push(`${label}.fingerprint does not match its workspace state`);
  return errors;
}

function validateGuardrailEvent(event, declared) {
  const errors = [];
  if (!/^GR-\d{3,}$/.test(event.guardrail || "")) errors.push(`${event.id}.guardrail is invalid`);
  if (!GUARDRAIL_RESULTS.includes(event.result)) errors.push(`${event.id}.result is invalid: ${event.result || "missing"}`);
  if (typeof event.code !== "string" || !event.code.trim()) errors.push(`${event.id}.code is required`);
  if (typeof event.enforcement !== "string" || !event.enforcement.trim()) errors.push(`${event.id}.enforcement is required`);
  if (typeof event.gate !== "string" || !event.gate.trim()) errors.push(`${event.id}.gate is required`);
  if (!Array.isArray(event.scope)) errors.push(`${event.id}.scope must be an array`);
  if (event.result === "pending") {
    if (declared.has(event.guardrail)) errors.push(`${event.id} redeclares ${event.guardrail}`);
    declared.set(event.guardrail, { code: event.code, enforcement: event.enforcement, gate: event.gate, scope: event.scope || [] });
  } else if (!declared.has(event.guardrail)) {
    errors.push(`${event.id} resolves undeclared ${event.guardrail}`);
  } else {
    const original = declared.get(event.guardrail);
    for (const field of ["code", "enforcement", "gate"]) {
      if (event[field] !== original[field]) errors.push(`${event.id}.${field} disagrees with the ${event.guardrail} declaration`);
    }
    if (stableJson(event.scope || []) !== stableJson(original.scope)) errors.push(`${event.id}.scope disagrees with the ${event.guardrail} declaration`);
  }
  return errors;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function safeEventPath(value) {
  return typeof value === "string" && value && !value.startsWith("/") && !value.split("/").includes("..") && value !== ".scrumrun" && !value.startsWith(".scrumrun/");
}

function validateMutationEvent(event, expectedWorkspace, policyFingerprint) {
  const errors = [];
  if (!/^MUT-[A-Za-z0-9-]{8,}$/.test(event.mutation_id || "")) errors.push(`${event.id}.mutation_id is invalid`);
  if (!Array.isArray(event.paths) || !event.paths.length) errors.push(`${event.id}.paths must be a non-empty array`);
  if (!Array.isArray(event.changes) || !event.changes.length) errors.push(`${event.id}.changes must be a non-empty array`);
  if (!/^[a-f0-9]{64}$/.test(event.workspace_before || "")) errors.push(`${event.id}.workspace_before must be sha256`);
  if (expectedWorkspace && event.workspace_before !== expectedWorkspace) errors.push(`${event.id}.workspace_before breaks the mutation chain`);
  if (event.policy_fingerprint !== policyFingerprint) errors.push(`${event.id}.policy_fingerprint disagrees with Run approval`);
  const paths = new Set();
  for (const value of Array.isArray(event.paths) ? event.paths : []) {
    if (!safeEventPath(value)) errors.push(`${event.id}.paths contains an unsafe path`);
    if (paths.has(value)) errors.push(`${event.id}.paths contains duplicate path: ${value}`);
    paths.add(value);
  }
  const changed = new Set();
  for (const change of Array.isArray(event.changes) ? event.changes : []) {
    if (!change || !safeEventPath(change.path)) {
      errors.push(`${event.id}.changes contains an unsafe path`);
      continue;
    }
    if (changed.has(change.path)) errors.push(`${event.id}.changes contains duplicate path: ${change.path}`);
    changed.add(change.path);
    if (![...paths].some((allowed) => change.path === allowed || change.path.startsWith(`${allowed}/`))) errors.push(`${event.id}.${change.path} is outside declared paths`);
    for (const field of ["before_sha256", "after_sha256"]) {
      if (change[field] !== null && !/^[a-f0-9]{64}$/.test(change[field] || "")) errors.push(`${event.id}.${change.path}.${field} is invalid`);
    }
    for (const field of ["before_scan", "after_scan"]) {
      if (!["text", "binary", "too-large", "not-applicable"].includes(change[field])) errors.push(`${event.id}.${change.path}.${field} is invalid`);
    }
    for (const field of ["before_mode", "after_mode"]) {
      if (change[field] !== null && (!Number.isInteger(change[field]) || change[field] < 0 || change[field] > 0o777)) errors.push(`${event.id}.${change.path}.${field} is invalid`);
    }
  }
  if (!event.workspace_after) errors.push(`${event.id}.workspace_after is required`);
  else errors.push(...validateWorkspaceState(event.workspace_after, `${event.id}.workspace_after`));
  return errors;
}

function parseRunLedger(body) {
  const events = [];
  const errors = [];
  const headings = [...String(body || "").matchAll(/^### (RUN-\d{3,}-EVT-\d{3,})[ \t]*$/gm)];
  const blocks = [...String(body || "").matchAll(/^### (RUN-\d{3,}-EVT-\d{3,})[ \t]*\r?\n[ \t]*\r?\n```json[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*$/gm)];
  if (headings.length !== blocks.length) errors.push("one or more Run event blocks are malformed");
  for (const block of blocks) {
    try {
      const event = JSON.parse(block[2]);
      if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("event payload must be an object");
      if (event.id !== block[1]) errors.push(`${block[1]} payload id does not match its heading`);
      events.push(event);
    } catch (error) {
      errors.push(`${block[1]} contains invalid JSON: ${error.message}`);
    }
  }
  return { events, errors };
}

function validateEvidence(event) {
  const errors = [];
  if (!Array.isArray(event.evidence)) return [`${event.id}.evidence must be an array`];
  for (let index = 0; index < event.evidence.length; index++) {
    const item = event.evidence[index];
    const label = `${event.id}.evidence[${index}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      errors.push(`${label} must be an object`);
      continue;
    }
    if (!RUN_EVIDENCE_KINDS.includes(item.kind)) errors.push(`${label}.kind is invalid: ${item.kind || "missing"}`);
    if (!(typeof item.ref === "string" && item.ref.trim()) && !(typeof item.summary === "string" && item.summary.trim())) {
      errors.push(`${label} requires ref or summary`);
    }
  }
  return errors;
}

function validateRunLedger(record, body) {
  const parsed = parseRunLedger(body);
  const errors = [...parsed.errors];
  const events = parsed.events;
  if (record.ledger !== RUN_LEDGER_VERSION) errors.push(`ledger must be ${RUN_LEDGER_VERSION}`);
  if (!events.length) errors.push("Run ledger has no events");
  const ids = new Set();
  let previous = null;
  let previousTime = null;
  const declared = new Map();
  const obligationResults = new Map();
  let expectedWorkspace = events[0] && events[0].workspace_baseline && events[0].workspace_baseline.fingerprint;
  const policyFingerprint = events[0] && events[0].policy_fingerprint;
  for (let index = 0; index < events.length; index++) {
    const event = events[index];
    const expectedSequence = index + 1;
    const match = EVENT_ID.exec(event.id || "");
    if (!match || match[1] !== record.id) errors.push(`invalid event id for ${record.id}: ${event.id || "missing"}`);
    if (ids.has(event.id)) errors.push(`duplicate Run event id: ${event.id}`);
    ids.add(event.id);
    if (event.schema !== RUN_LEDGER_VERSION) errors.push(`${event.id}.schema must be ${RUN_LEDGER_VERSION}`);
    if (event.sequence !== expectedSequence || (match && Number(match[2]) !== expectedSequence)) {
      errors.push(`${event.id}.sequence must be contiguous from 1; expected ${expectedSequence}`);
    }
    if (!RUN_EVENT_TYPES.includes(event.type)) errors.push(`${event.id}.type is invalid: ${event.type || "missing"}`);
    if (!RFC3339.test(event.occurred_at || "") || !Number.isFinite(Date.parse(event.occurred_at))) {
      errors.push(`${event.id}.occurred_at must be a real RFC3339 timestamp`);
    } else {
      const currentTime = Date.parse(event.occurred_at);
      if (previousTime !== null && currentTime < previousTime) errors.push(`${event.id}.occurred_at precedes the previous event`);
      previousTime = currentTime;
    }
    if (!["instant", "date"].includes(event.timestamp_precision)) errors.push(`${event.id}.timestamp_precision must be instant or date`);
    if (typeof event.actor !== "string" || !event.actor.trim()) errors.push(`${event.id}.actor is required`);
    if (typeof event.reason !== "string" || !event.reason.trim()) errors.push(`${event.id}.reason is required`);
    if (containsSecret(JSON.stringify(event))) errors.push(`${event.id} contains secret-like content`);
    errors.push(...validateEvidence(event));

    if (index === 0 && event.type === "snapshot") {
      if (event.from !== null) errors.push(`${event.id} snapshot.from must be null`);
      if (!event.evidence.some((item) => item && ["migration", "legacy"].includes(item.kind))) {
        errors.push(`${event.id} snapshot requires migration or legacy evidence`);
      }
    } else if (["guardrail", "mutation"].includes(event.type)) {
      if (!previous) errors.push(`${event.id} cannot precede the initial Run event`);
      const currentState = previous && previous.to;
      if (event.from !== currentState || event.to !== currentState) errors.push(`${event.id} must not change Run state ${currentState || "unknown"}`);
      if (event.type === "guardrail") {
        errors.push(...validateGuardrailEvent(event, declared));
        if (event.result !== "pending") obligationResults.set(event.guardrail, event.result);
        else obligationResults.set(event.guardrail, "pending");
      } else {
        errors.push(...validateMutationEvent(event, expectedWorkspace, policyFingerprint));
        if (event.workspace_after && event.workspace_after.fingerprint) expectedWorkspace = event.workspace_after.fingerprint;
      }
    } else {
      const expectedFrom = index === 0 ? "created" : previous.to;
      if (event.type !== "transition") errors.push(`${event.id} snapshot is allowed only as the first event`);
      if (event.from !== expectedFrom) errors.push(`${event.id}.from must be ${expectedFrom}`);
      if (event.from === "created") {
        if (event.to !== "executing") errors.push(`${event.id} initial transition must enter executing`);
      } else {
        const allowed = (ARTIFACT_TRANSITIONS.run[event.from] || []);
        if (!allowed.includes(event.to)) errors.push(`${event.id} contains invalid Run transition: ${event.from} -> ${event.to}`);
      }
    }
    if (!["snapshot"].includes(event.type) && !event.evidence.length) errors.push(`${event.id} transition requires evidence`);
    previous = event;
  }
  if (record.workspace === 1 && events[0] && events[0].type !== "snapshot") {
    errors.push(...validateWorkspaceState(events[0].workspace_baseline, `${events[0].id}.workspace_baseline`));
  }
  if (record.guardrails === 1 && events[0] && events[0].type !== "snapshot") {
    if (!/^[a-f0-9]{64}$/.test(events[0].policy_fingerprint || "")) errors.push(`${events[0].id}.policy_fingerprint must be sha256`);
  }
  if (previous && previous.to !== record.status) errors.push(`Run status ${record.status} disagrees with final event state ${previous.to}`);
  if (previous && record.updated !== String(previous.occurred_at || "").slice(0, 10)) {
    errors.push(`Run updated date ${record.updated} disagrees with final event timestamp`);
  }
  if (record.status === "completed" && events[0] && events[0].type !== "snapshot") {
    for (const required of ["validating", "learning", "completed"]) {
      const event = events.find((item) => item.type === "transition" && item.to === required);
      if (!event || !event.evidence.length) errors.push(`completed Run requires evidenced ${required} transition`);
    }
    for (const guardrail of declared.keys()) {
      if (obligationResults.get(guardrail) !== "passed") errors.push(`completed Run has unresolved Guardrail obligation: ${guardrail}`);
    }
  }
  return { events, errors, obligations: [...declared.keys()].map((guardrail) => ({ guardrail, status: obligationResults.get(guardrail) || "pending" })) };
}

function appendAuxiliaryEvent(record, body, details, options = {}) {
  const current = validateRunLedger(record, body);
  if (current.errors.length) throw new Error(`Invalid Run ledger: ${current.errors.join("; ")}`);
  const occurredAt = options.occurredAt ? instant(options.occurredAt) : instant();
  const nextRecord = { ...record, updated: occurredAt.slice(0, 10) };
  const evidence = normalizeEvidence(options.evidence || []);
  if (!evidence.length) throw new Error(`${details.type} event requires structured evidence.`);
  const event = makeRunEvent({
    runId: record.id,
    sequence: current.events.length + 1,
    type: details.type,
    occurredAt,
    actor: options.actor || "agent",
    from: record.status,
    to: record.status,
    reason: String(options.note || evidence.map((item) => item.summary || item.ref).filter(Boolean).join("; ")).trim(),
    evidence,
    ...details
  });
  const nextBody = `${String(body).trimEnd()}\n\n${renderRunEvent(event)}\n`;
  const validated = validateRunLedger(nextRecord, nextBody);
  if (validated.errors.length) throw new Error(`${details.type} event failed validation: ${validated.errors.join("; ")}`);
  return { body: nextBody, record: nextRecord, event, events: validated.events, obligations: validated.obligations };
}

function appendGuardrailEvent(record, body, obligation, result, options = {}) {
  if (!GUARDRAIL_RESULTS.includes(result) || result === "pending") throw new Error(`Guardrail result must be passed or blocked.`);
  return appendAuxiliaryEvent(record, body, {
    type: "guardrail",
    guardrail: obligation.guardrail,
    code: obligation.code,
    enforcement: obligation.enforcement,
    gate: obligation.gate,
    result,
    scope: obligation.scope || []
  }, options);
}

function appendMutationEvent(record, body, mutation, options = {}) {
  return appendAuxiliaryEvent(record, body, { type: "mutation", ...mutation }, options);
}

function guardrailState(record, body) {
  const ledger = validateRunLedger(record, body);
  if (ledger.errors.length) throw new Error(`Invalid Run ledger: ${ledger.errors.join("; ")}`);
  const declarations = new Map();
  const results = new Map();
  for (const event of ledger.events.filter((item) => item.type === "guardrail")) {
    if (event.result === "pending") declarations.set(event.guardrail, event);
    else results.set(event.guardrail, event);
  }
  return [...declarations.values()].map((event) => ({
    guardrail: event.guardrail,
    code: event.code,
    enforcement: event.enforcement,
    gate: event.gate,
    scope: event.scope || [],
    status: results.has(event.guardrail) ? results.get(event.guardrail).result : "pending",
    resultEvent: results.get(event.guardrail) || null
  }));
}

function appendRunEvent(record, body, nextRecord, {
  note,
  evidence = [],
  actor = "agent",
  occurredAt = instant()
} = {}) {
  const current = validateRunLedger(record, body);
  if (current.errors.length) throw new Error(`Invalid Run ledger: ${current.errors.join("; ")}`);
  const normalizedEvidence = evidenceForTransition(nextRecord.status, note, evidence);
  if (!note && !normalizedEvidence.length) throw new Error(`Run transition to ${nextRecord.status} requires a reason or structured evidence.`);
  const reason = String(note || normalizedEvidence.map((item) => item.summary || item.ref).filter(Boolean).join("; ")).trim();
  const event = makeRunEvent({
    runId: record.id,
    sequence: current.events.length + 1,
    occurredAt,
    actor,
    from: record.status,
    to: nextRecord.status,
    reason,
    evidence: normalizedEvidence
  });
  const nextBody = `${String(body).trimEnd()}\n\n${renderRunEvent(event)}\n`;
  const validated = validateRunLedger(nextRecord, nextBody);
  if (validated.errors.length) throw new Error(`Run ledger transition failed validation: ${validated.errors.join("; ")}`);
  return { body: nextBody, event, events: validated.events };
}

function appendTechnicalSummary(record, body, summary) {
  const summaryText = String(summary || "").trim();
  if (!summaryText) return body;
  if (containsSecret(summaryText)) throw new Error("Technical summary contains secret-like content.");
  const validated = validateRunLedger(record, body);
  if (validated.errors.length) throw new Error(`Cannot append technical summary to invalid Run ledger: ${validated.errors.join("; ")}`);
  return `${String(body).trimEnd()}\n\n## Technical Summary\n\n${summaryText}\n`;
}

function extractTechnicalSummary(body) {
  const match = String(body || "").match(/^## Technical Summary[ \t]*\r?\n\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  return match ? match[1].trim() : null;
}

function legacyTransitionEvents(record, body, legacyHash) {
  const raw = [];
  const log = String(body || "").match(/^## Transition Log[ \t]*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  if (log) {
    const initial = log[1].match(/^-\s+(\d{4}-\d{2}-\d{2}):\s*([a-z]+)\s*(?:→|->)\s*([a-z]+)\s*(?:—|-)\s*(.+)$/m);
    if (initial) raw.push({ date: initial[1], from: initial[2], to: initial[3], note: initial[4].trim() });
  }
  for (const match of String(body || "").matchAll(/^## Transition (\d{4}-\d{2}-\d{2}) · ([a-z]+)-to-([a-z]+)[ \t]*\r?\n\r?\n-\s+([^\r\n]+)$/gm)) {
    raw.push({ date: match[1], from: match[2], to: match[3], note: match[4].trim() });
  }
  if (!raw.length) return [];
  let previous = "created";
  for (const item of raw) {
    if (item.from !== previous) return [];
    const allowed = item.from === "created" ? ["executing"] : (ARTIFACT_TRANSITIONS.run[item.from] || []);
    if (!allowed.includes(item.to)) return [];
    previous = item.to;
  }
  if (previous !== record.status) return [];
  return raw.map((item, index) => makeRunEvent({
    runId: record.id,
    sequence: index + 1,
    occurredAt: dateInstant(item.date),
    timestampPrecision: "date",
    actor: "migration",
    from: item.from,
    to: item.to,
    reason: item.note,
    evidence: [
      { kind: index === 0 ? "approval" : "note", summary: item.note },
      { kind: "legacy", ref: `sha256:${legacyHash}`, summary: "Recovered from the byte-exact legacy Run record." }
    ]
  }));
}

function migrateLegacyRun(record, body, { legacyHash, backupRef }) {
  let events = legacyTransitionEvents(record, body, legacyHash);
  let mode = "transitions";
  if (!events.length) {
    mode = "snapshot";
    events = [makeRunEvent({
      runId: record.id,
      sequence: 1,
      type: "snapshot",
      occurredAt: dateInstant(record.updated),
      timestampPrecision: "date",
      actor: "migration",
      from: null,
      to: record.status,
      reason: "Imported the recorded Run state without inventing missing transitions.",
      evidence: [{
        kind: "legacy",
        ref: `sha256:${legacyHash}`,
        summary: `Byte-exact source preserved at ${backupRef}.`
      }]
    })];
  }
  const title = runTitle(body, `Run for ${record.task}`);
  const provenance = `## Ledger Migration\n\n- Mode: ${mode}\n- Legacy SHA-256: \`${legacyHash}\`\n- Byte-exact backup: \`${backupRef}\``;
  const nextRecord = { ...record, ledger: RUN_LEDGER_VERSION };
  const nextBody = `# ${title}\n\n${eventsSection(events)}\n\n${provenance}\n`;
  const validation = validateRunLedger(nextRecord, nextBody);
  if (validation.errors.length) throw new Error(`${record.id} ledger migration failed: ${validation.errors.join("; ")}`);
  return { record: nextRecord, body: nextBody, events, mode };
}

module.exports = {
  appendGuardrailEvent,
  appendMutationEvent,
  appendRunEvent,
  appendTechnicalSummary,
  createRunBody,
  dateInstant,
  eventId,
  eventsSection,
  evidenceForTransition,
  extractTechnicalSummary,
  guardrailState,
  instant,
  makeRunEvent,
  migrateLegacyRun,
  parseRunLedger,
  renderRunEvent,
  validateRunLedger
};
