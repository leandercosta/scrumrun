"use strict";

// Single source of truth for the canonical layout inside `.scrumrun/`.
//
// This module powers `method.json.paths` — the machine-readable index a
// ScrumRun-aware agent must consult BEFORE searching. Any change here
// must land in the template, the migration generator, and the doctor
// invariant together so no drift is possible.

const CANONICAL_PATHS = Object.freeze({
  guardrails: "guardrails.md",
  config: "config.md",
  project: "project.md",
  core: "core.md",
  state_view: "state.md",
  map_view: "map.md",
  tasks: "tasks/",
  sprints: "sprints/",
  features: "features/",
  runs: "runs/",
  reviews: "reviews/",
  memory: Object.freeze({
    knowledge: "memory/knowledge/",
    decisions: "memory/decisions/",
    insights: "memory/insights/",
    dossiers: "memory/dossiers/"
  }),
  vault_local: "vault.local.md",
  cache: ".cache/"
});

const PATHS_SCHEMA_VERSION = 1;

function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(clone);
  const out = {};
  for (const [key, entry] of Object.entries(value)) out[key] = clone(entry);
  return out;
}

function canonicalPaths() {
  return clone(CANONICAL_PATHS);
}

function flattenPaths(paths = CANONICAL_PATHS, prefix = "") {
  const out = [];
  for (const [key, value] of Object.entries(paths)) {
    const label = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      out.push(...flattenPaths(value, label));
    } else if (typeof value === "string") {
      out.push({ label, relative: value });
    }
  }
  return out;
}

function renderMethodJson({ methodVersion, layout = "v2", schemas = {}, workflow = { daily: "markdown-first" }, migratedFrom, migration } = {}) {
  const payload = {
    method: methodVersion,
    layout,
    workflow,
    paths_schema: PATHS_SCHEMA_VERSION,
    paths: canonicalPaths(),
    schemas
  };
  if (migratedFrom) payload.migrated_from = migratedFrom;
  if (migration) payload.migration = migration;
  return `${JSON.stringify(payload, null, 2)}\n`;
}

module.exports = { CANONICAL_PATHS, PATHS_SCHEMA_VERSION, canonicalPaths, flattenPaths, renderMethodJson };
