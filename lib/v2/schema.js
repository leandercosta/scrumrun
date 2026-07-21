"use strict";

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

const METHOD_VERSION = "2.0.0";

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
    initial: ["backlog", "proposed", "running"],
    statuses: ["backlog", "proposed", "running", "validating", "learning", "partial", "completed", "failed", "blocked", "cancelled"]
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
    backlog: ["proposed", "running", "cancelled"], proposed: ["running", "cancelled"], running: ["validating", "failed", "blocked", "cancelled"], validating: ["learning", "failed", "blocked"], learning: ["completed", "failed", "blocked"], partial: ["running", "cancelled"], failed: ["running", "cancelled"], blocked: ["running", "cancelled"]
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
  task: { targetKind: "task", cardinality: "1 for Run; otherwise 0..1", requiredFor: ["run"], meaning: "atomic work executed or reviewed by the artifact" }
});

const SCALAR_FIELDS = deepFreeze({
  attempt: { kinds: ["run"], required: true, type: "positive integer", meaning: "monotonic execution-attempt number within one Task" }
});

const TRUTH_OWNERSHIP = deepFreeze({
  feature: { question: "Why does this initiative exist?", truth: "initiative purpose, scope, dependencies, and lifecycle" },
  task: { question: "What approved atomic outcome is intended?", truth: "scope, acceptance criteria, approval, and intended status" },
  sprint: { question: "When are related Tasks grouped?", truth: "timebox or delivery-batch membership; never execution history" },
  run: { question: "How did one execution attempt actually happen?", truth: "append-only execution events, evidence, result, and attempt number" },
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
  METHOD_VERSION,
  SCALAR_FIELDS,
  STRUCTURAL_RELATIONS,
  TRUTH_OWNERSHIP,
  deepFreeze
};
