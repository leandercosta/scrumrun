"use strict";

const {
  ARTIFACT_TRANSITIONS,
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
  evidence = []
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
    evidence: normalizeEvidence(evidence)
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
  evidence = null
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
    evidence: eventEvidence
  });
  return { body: `# ${title}\n\n${eventsSection([event])}`, event };
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
  if (previous && previous.to !== record.status) errors.push(`Run status ${record.status} disagrees with final event state ${previous.to}`);
  if (previous && record.updated !== String(previous.occurred_at || "").slice(0, 10)) {
    errors.push(`Run updated date ${record.updated} disagrees with final event timestamp`);
  }
  if (record.status === "completed" && events[0] && events[0].type !== "snapshot") {
    for (const required of ["validating", "learning", "completed"]) {
      const event = events.find((item) => item.type === "transition" && item.to === required);
      if (!event || !event.evidence.length) errors.push(`completed Run requires evidenced ${required} transition`);
    }
  }
  return { events, errors };
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
  appendRunEvent,
  createRunBody,
  dateInstant,
  eventId,
  eventsSection,
  evidenceForTransition,
  instant,
  makeRunEvent,
  migrateLegacyRun,
  parseRunLedger,
  renderRunEvent,
  validateRunLedger
};
