"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ArtifactRepository, graphFromRecords } = require("./artifacts");
const { MANIFEST_PATH, migrationPlan } = require("./migration");

const LEGACY_PATHS = [
  "backlog.md",
  "fixes.md",
  "golden-rules.md",
  "knowledge.md",
  path.join("goals", "main", "sprint.md"),
  path.join("goals", "main", "history.md"),
  path.join("goals", "main", "decisions.md")
];

function readProjectModel(projectRoot) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  if (!fs.existsSync(scrumDir)) throw new Error("Not a ScrumRun project: .scrumrun/ is missing.");
  const hasV2Marker = fs.existsSync(path.join(scrumDir, "method.json")) || fs.existsSync(path.join(scrumDir, MANIFEST_PATH));
  const hasLegacy = LEGACY_PATHS.some((relative) => fs.existsSync(path.join(scrumDir, relative)));

  if (hasV2Marker) {
    const repository = new ArtifactRepository(scrumDir);
    return {
      layout: hasLegacy ? "mixed" : "v2",
      source: "canonical-v2",
      graph: repository.graph(),
      warnings: []
    };
  }

  const plan = migrationPlan(projectRoot);
  return {
    layout: "v1",
    source: "read-only-v2-projection",
    graph: graphFromRecords(plan.artifacts.map((artifact) => artifact.record)),
    warnings: plan.warnings,
    errors: plan.errors
  };
}

module.exports = { LEGACY_PATHS, readProjectModel };
