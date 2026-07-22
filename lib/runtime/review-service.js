"use strict";

const path = require("node:path");
const { ArtifactRepository, METHOD_VERSION, withArtifactLock } = require("../v2/artifacts");
const { auditProject } = require("../v2/conformance");
const { assertCanonicalWrite } = require("./mutation-gateway");

function today() {
  return new Date().toISOString().slice(0, 10);
}

function oneLine(value, label) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) throw new Error(`${label} is required.`);
  if (text.length > 500) throw new Error(`${label} exceeds 500 characters.`);
  return text;
}

function nextReviewId(repository) {
  const highest = repository.list("review").reduce((max, artifact) => {
    const match = artifact.record.id.match(/-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `REV-${String(highest + 1).padStart(3, "0")}`;
}

function recordArtifactReviewUnlocked(projectRoot, options) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const repository = new ArtifactRepository(scrumDir);
  const taskId = oneLine(options.task, "task");
  const task = repository.read("task", taskId);
  if (!task || task.errors.length) throw new Error(`Review Task is missing or invalid: ${taskId}`);
  const runId = options.run ? oneLine(options.run, "run") : null;
  if (runId) {
    const run = repository.read("run", runId);
    if (!run || run.errors.length) throw new Error(`Review Run is missing or invalid: ${runId}`);
    if (run.record.task !== taskId) throw new Error(`${runId} belongs to ${run.record.task}, not ${taskId}.`);
  }
  const title = oneLine(options.title || `Artifact conformance review for ${runId || taskId}`, "title");
  const suppliedEvidence = (Array.isArray(options.evidence) ? options.evidence : []).map((item) => oneLine(item, "evidence"));
  const audit = auditProject(projectRoot);
  const created = today();
  const record = {
    id: nextReviewId(repository),
    kind: "review",
    status: audit.passed ? "passed" : "failed",
    created,
    updated: created,
    method: METHOD_VERSION,
    task: taskId
  };
  const findings = audit.findings.length
    ? audit.findings.map((finding) => `- ${finding.severity}: ${finding.code} — ${finding.message}`)
    : ["- No conformance findings."];
  const evidence = [
    `- Artifact audit: ${audit.invariants} invariants; ${audit.findings.length} finding(s); passed=${audit.passed}.`,
    ...(runId ? [`- Run under review: ${runId}.`] : []),
    ...suppliedEvidence.map((item) => `- ${item}`)
  ];
  const verdict = audit.passed
    ? "Passed. The machine-readable artifact audit has no blocking finding."
    : "Failed. Blocking conformance findings must be resolved in a separately authorized mutation.";
  const body = [
    `# ${title}`,
    "",
    "## Scope",
    "",
    `Review canonical project conformance for ${runId || taskId}.`,
    "",
    "## Evidence",
    "",
    ...evidence,
    "",
    "## Findings",
    "",
    ...findings,
    "",
    "## Verdict",
    "",
    verdict
  ].join("\n");
  assertCanonicalWrite(projectRoot, "record-artifact-review", [title, ...suppliedEvidence, body]);
  repository.write(record, body);
  return { review: repository.read("review", record.id), audit };
}

function recordArtifactReview(projectRoot, options = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  return withArtifactLock(scrumDir, "review-artifact", () => recordArtifactReviewUnlocked(projectRoot, options));
}

module.exports = { recordArtifactReview };
