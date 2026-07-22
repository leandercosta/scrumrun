"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ARTIFACT_TYPES, ArtifactRepository, sha256 } = require("../v2/artifacts");
const { readProjectModel } = require("../v2/project-store");
const { containsSecret } = require("../security/secrets");
const { parseGuardrails } = require("./policy-engine");

const EXCLUDED_ROOT_ENTRIES = new Set([".git", ".scrumrun", "node_modules", "dist", "build", "coverage"]);

function read(file) {
  return fs.existsSync(file) && fs.lstatSync(file).isFile() ? fs.readFileSync(file, "utf8") : "";
}

function capped(text, limit = 1200) {
  if (text.length <= limit) return text;
  return `${text.slice(0, limit)}\n…[truncated ${text.length - limit} chars]`;
}

function projectScan(projectRoot) {
  const entries = fs.readdirSync(projectRoot, { withFileTypes: true })
    .filter((entry) => !EXCLUDED_ROOT_ENTRIES.has(entry.name))
    .map((entry) => ({ name: entry.name, kind: entry.isDirectory() ? "directory" : "file" }))
    .slice(0, 80);
  const packageFile = path.join(projectRoot, "package.json");
  let packageSummary = null;
  if (fs.existsSync(packageFile) && fs.lstatSync(packageFile).isFile()) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageFile, "utf8"));
      packageSummary = {
        name: pkg.name || null,
        scripts: Object.keys(pkg.scripts || {}).sort(),
        dependencies: Object.keys(pkg.dependencies || {}).sort().slice(0, 100),
        devDependencies: Object.keys(pkg.devDependencies || {}).sort().slice(0, 100)
      };
    } catch {
      packageSummary = { error: "package.json is malformed" };
    }
  }
  return { project: path.basename(projectRoot), entries, package: packageSummary };
}

const guardrailRecords = parseGuardrails;

function artifactSnapshot(scrumDir) {
  const repository = new ArtifactRepository(scrumDir);
  const records = {};
  const hashes = [];
  const warnings = [];
  for (const kind of Object.keys(ARTIFACT_TYPES)) {
    records[kind] = repository.list(kind).map((artifact) => {
      const relative = path.relative(scrumDir, artifact.file).split(path.sep).join("/");
      const content = read(artifact.file);
      hashes.push(`${relative}\0${sha256(content)}`);
      if (containsSecret(content)) {
        warnings.push(`Secret-like content detected in canonical artifact: ${relative}`);
        return { id: artifact.record ? artifact.record.id : path.basename(artifact.file, ".md"), status: "unsafe", title: "[redacted]" };
      }
      return artifact.record ? {
        id: artifact.record.id,
        status: artifact.record.status,
        title: ((artifact.body || "").match(/^# ([^\r\n]+)/m) || [])[1] || artifact.record.id,
        task: artifact.record.task || null,
        sprint: artifact.record.sprint || null,
        feature: artifact.record.feature || null
      } : { id: path.basename(artifact.file, ".md"), status: "invalid", errors: artifact.errors };
    });
  }
  return { records, hashes, warnings };
}

function contextFingerprint(scrumDir, artifactHashes) {
  const canonical = ["guardrails.md", "config.md", "project.md", "method.json"]
    .map((relative) => {
      const content = read(path.join(scrumDir, relative));
      return `${relative}\0${content ? sha256(content) : "missing"}`;
    });
  return sha256([...canonical, ...artifactHashes].sort().join("\n"));
}

function buildContextPackage(projectRoot, request) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  if (!fs.existsSync(scrumDir)) throw new Error("Not a ScrumRun project: .scrumrun/ is missing.");
  const model = readProjectModel(projectRoot);
  const securityWarnings = [];
  const safeControl = (relative, limit) => {
    const content = read(path.join(scrumDir, relative));
    if (containsSecret(content)) {
      securityWarnings.push(`Secret-like content detected in canonical control: ${relative}`);
      return "[redacted: secret-like content]";
    }
    return capped(content, limit);
  };
  const guardrailsContent = safeControl("guardrails.md", 10000);
  const config = safeControl("config.md", 1000);
  const project = safeControl("project.md", 1400);
  const artifacts = model.source === "canonical-v2" ? artifactSnapshot(scrumDir) : { records: {}, hashes: [], warnings: [] };
  const openDecisions = (artifacts.records.decision || []).filter((record) => record.status === "open").slice(-10);
  const recentRuns = (artifacts.records.run || []).slice(-10).reverse();
  const activeWork = ["feature", "task", "sprint", "run"].flatMap((kind) =>
    (artifacts.records[kind] || []).filter((record) => !["completed", "failed", "cancelled"].includes(record.status))
  ).slice(0, 50);
  const missing = [];
  for (const relative of ["guardrails.md", "config.md", "project.md"]) {
    if (!fs.existsSync(path.join(scrumDir, relative))) missing.push(relative);
  }
  const fingerprint = contextFingerprint(scrumDir, artifacts.hashes);
  const stateContent = read(path.join(scrumDir, "state.md"));
  const stateFingerprint = (stateContent.match(/^Source fingerprint:\s*([a-f0-9]{64})$/m) || [])[1];
  if (!stateFingerprint) missing.push("state.md has no source fingerprint and is stale");
  else if (stateFingerprint !== fingerprint) missing.push("state.md source fingerprint is stale");
  return {
    request: capped(request.trim(), 10000),
    layout: model.layout,
    source: model.source,
    fingerprint,
    projectScan: projectScan(projectRoot),
    guardrails: guardrailRecords(guardrailsContent).filter((record) => record.status === "active").slice(0, 100),
    config,
    project: project || "[missing]",
    history: { recentRuns },
    decisions: { open: openDecisions },
    activeWork,
    graph: {
      nodeCount: model.graph.nodes.length,
      edgeCount: model.graph.edges.length
    },
    warnings: [...(model.warnings || []), ...securityWarnings, ...(artifacts.warnings || []), ...missing.map((relative) => relative.startsWith("state.md") ? relative : `Missing canonical context: ${relative}`)]
  };
}

module.exports = { buildContextPackage, contextFingerprint, guardrailRecords, projectScan };
