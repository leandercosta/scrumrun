"use strict";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

const METHOD_VERSION = "2.0.0";
const RUN_LEDGER_VERSION = 1;

const RUN_EVENT_TYPES = deepFreeze(["transition", "snapshot", "guardrail", "mutation"]);
const RUN_EVIDENCE_KINDS = deepFreeze([
  "approval",
  "command",
  "test",
  "file",
  "review",
  "decision",
  "insight",
  "risk",
  "note",
  "migration",
  "legacy",
  "guardrail",
  "mutation"
]);

const GUARDRAIL_RESULTS = deepFreeze(["pending", "passed", "blocked"]);

const ARTIFACT_TYPES = deepFreeze({
  feature: {
    prefix: "FEAT",
    directory: "features",
    initial: ["backlog", "proposed"],
    statuses: ["backlog", "proposed", "active", "completed", "paused", "cancelled"]
  },
  task: {
    prefix: "TASK",
    directory: "tasks",
    initial: ["backlog", "proposed", "in_progress", "running"],
    statuses: ["backlog", "proposed", "in_progress", "running", "validating", "learning", "partial", "completed", "failed", "blocked", "cancelled"]
  },
  sprint: {
    prefix: "SPRINT",
    directory: "sprints",
    initial: ["proposed"],
    statuses: ["proposed", "running", "partial", "completed", "blocked", "cancelled"]
  },
  run: {
    prefix: "RUN",
    directory: "runs",
    initial: ["executing"],
    statuses: ["executing", "validating", "learning", "partial", "completed", "failed", "blocked"]
  },
  review: {
    prefix: "REV",
    directory: "reviews",
    initial: ["proposed"],
    statuses: ["proposed", "running", "passed", "failed", "archived"]
  },
  knowledge: {
    prefix: "K",
    directory: "memory/knowledge",
    initial: ["candidate"],
    statuses: ["candidate", "approved", "rejected", "deprecated", "invalidated"]
  },
  decision: {
    prefix: "DEC",
    directory: "memory/decisions",
    initial: ["open"],
    statuses: ["open", "resolved", "deprecated", "invalidated"]
  },
  insight: {
    prefix: "INS",
    directory: "memory/insights",
    initial: ["candidate"],
    statuses: ["candidate", "confirmed", "stale", "deprecated", "invalidated"]
  },
  dossier: {
    prefix: "DOS",
    directory: "memory/dossiers",
    initial: ["active"],
    statuses: ["active", "stale", "deprecated", "archived"]
  }
});

const ARTIFACT_TRANSITIONS = deepFreeze({
  feature: {
    backlog: ["proposed", "active", "cancelled"], proposed: ["active", "cancelled"], active: ["paused", "completed", "cancelled"], paused: ["active", "cancelled"]
  },
  task: {
    backlog: ["proposed", "in_progress", "running", "cancelled"], proposed: ["in_progress", "running", "cancelled"], in_progress: ["completed", "failed", "blocked", "cancelled"], running: ["validating", "completed", "failed", "blocked", "cancelled"], validating: ["learning", "completed", "failed", "blocked"], learning: ["completed", "failed", "blocked"], partial: ["in_progress", "running", "cancelled"], failed: ["in_progress", "running", "cancelled"], blocked: ["in_progress", "running", "cancelled"]
  },
  sprint: {
    proposed: ["running", "cancelled"], running: ["partial", "completed", "blocked", "cancelled"], partial: ["running", "completed", "cancelled"], blocked: ["running", "cancelled"]
  },
  run: {
    executing: ["validating", "failed", "blocked"], validating: ["learning", "failed", "blocked"], learning: ["completed", "failed", "blocked"], partial: ["executing", "failed", "blocked"], blocked: ["executing", "failed"]
  },
  review: { proposed: ["running"], running: ["passed", "failed"], failed: ["running", "archived"], passed: ["archived"] },
  knowledge: { candidate: ["approved", "rejected"], approved: ["deprecated", "invalidated"], rejected: ["candidate"], deprecated: ["approved"], invalidated: [] },
  decision: { open: ["resolved", "deprecated", "invalidated"], resolved: ["deprecated", "invalidated"], deprecated: ["open"], invalidated: [] },
  insight: { candidate: ["confirmed", "invalidated"], confirmed: ["stale", "deprecated", "invalidated"], stale: ["confirmed", "deprecated", "invalidated"], deprecated: ["confirmed"], invalidated: [] },
  dossier: { active: ["stale", "deprecated", "archived"], stale: ["active", "deprecated", "archived"], deprecated: ["archived"], archived: [] }
});

const STRUCTURAL_RELATIONS = deepFreeze({
  feature: { targetKind: "feature", cardinality: "0..1", meaning: "long-lived initiative containing the artifact" },
  sprint: { targetKind: "sprint", cardinality: "0..1", meaning: "optional delivery batch containing a Task or Run" },
  task: { targetKind: "task", cardinality: "0..1", meaning: "atomic work executed or reviewed by the artifact" }
});

const SCALAR_FIELDS = deepFreeze({
  attempt: { kinds: ["run"], required: true, type: "positive integer", meaning: "monotonic execution-attempt number within one Task" },
  ledger: { kinds: ["run"], required: false, type: `integer ${RUN_LEDGER_VERSION}`, meaning: "canonical Run event-ledger schema; required for newly authored Runs" },
  guardrails: { kinds: ["run"], required: false, type: "integer 1", meaning: "append-only Guardrail obligation schema" },
  workspace: { kinds: ["run"], required: false, type: "integer 1", meaning: "workspace mutation-gateway schema" }
});

const TRUTH_OWNERSHIP = deepFreeze({
  feature: { question: "Why does this initiative exist?", truth: "initiative purpose, scope, dependencies, and lifecycle" },
  task: { question: "What concrete outcome is intended?", truth: "scope, owner-defined sections, links, and status" },
  sprint: { question: "Which Tasks are grouped for this delivery?", truth: "timebox or delivery-batch membership; may be feature, fix, or maintenance" },
  run: { question: "What happened while executing a Task or Sprint?", truth: "optional human-readable execution record and outcome" },
  review: { question: "What independent validation was performed?", truth: "scoped findings, checks, evidence, and verdict" },
  knowledge: { question: "What verified project fact is reusable?", truth: "approved evidence-backed fact and validity" },
  decision: { question: "What normative choice constrains future work?", truth: "decision, rationale, validity, and lifecycle" },
  insight: { question: "Why is something arranged or constrained this way?", truth: "explanatory candidate/confirmed context and evidence" },
  dossier: { question: "What evidence belongs to one retrieval topic?", truth: "reviewed topic bundle and freshness" }
});

const AUTHORITY = deepFreeze({
  semantics: { source: "SPEC.md", scope: "normative meanings and invariants" },
  schema: { source: "lib/v2/schema.js", scope: "machine-enforced ids, paths, statuses, transitions, relations, and ownership metadata" },
  commands: { source: "lib/commands/manifest.js", scope: "public command grammar and compatibility routes" },
  projectPolicy: { source: ".scrumrun/guardrails.md", scope: "owner/project constraints" },
  projectTruth: { source: ".scrumrun/**/*.md", scope: "authored canonical project records" },
  projections: { source: ".scrumrun/state.md, .scrumrun/map.md, .scrumrun/.cache/", scope: "disposable derived views; never authority" }
});

module.exports = {
  ARTIFACT_TRANSITIONS,
  ARTIFACT_TYPES,
  AUTHORITY,
  GUARDRAIL_RESULTS,
  METHOD_VERSION,
  RUN_EVENT_TYPES,
  RUN_EVIDENCE_KINDS,
  RUN_LEDGER_VERSION,
  SCALAR_FIELDS,
  STRUCTURAL_RELATIONS,
  TRUTH_OWNERSHIP,
  deepFreeze
};
