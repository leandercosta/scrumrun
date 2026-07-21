"use strict";

const path = require("node:path");
const { ArtifactRepository, sha256 } = require("../v2/artifacts");
const { createMemory } = require("../memory/service");

function learningSection(body) {
  const match = String(body || "").match(/^## Learning Candidates\s*\r?\n([\s\S]*?)(?=^## |(?![\s\S]))/m);
  return match ? match[1] : "";
}

function parseCandidate(line) {
  const match = line.match(/^\s*-\s*\[([a-z][a-z0-9_]*)\]\s+([^|]+?)\s*\|\s*([^|]+?)(?:\s*\|\s*evidence:\s*([^|]+?))?(?:\s*\|\s*relations?:\s*(.+?))?\s*$/i);
  if (!match) return null;
  const subject = match[2].trim();
  const evidence = match[4] ? match[4].split(/\s*,\s*/).filter(Boolean) : [];
  const relations = match[5]
    ? match[5].split(/\s*,\s*/).map((item) => item.replace(/^([a-z][a-z0-9_]*)\s*=\s*/i, "$1: ")).filter(Boolean)
    : [];
  return { insightKind: match[1].toLowerCase(), subject, content: match[3].trim(), evidence, relations };
}

function extractLearningCandidates(projectRoot, runId) {
  const repository = new ArtifactRepository(path.join(projectRoot, ".scrumrun"));
  const run = repository.read("run", runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  if (!run.record || !["learning", "completed"].includes(run.record.status)) {
    throw new Error(`Run ${runId} must be learning or completed before extracting knowledge.`);
  }
  const lines = learningSection(run.body).split(/\r?\n/).filter((line) => /^\s*-\s+/.test(line) && !/Pending\./i.test(line));
  const created = [];
  const warnings = [];
  const seen = new Set();
  for (const line of lines) {
    const candidate = parseCandidate(line);
    if (!candidate) {
      warnings.push(`Ignored malformed learning candidate: ${line.trim()}`);
      continue;
    }
    const key = sha256(`${candidate.subject}\0${candidate.content}`);
    if (seen.has(key)) continue;
    seen.add(key);
    const generic = candidate.subject.match(/^(function|class|interface|type|enum):(.+)$/);
    const subjectType = candidate.subject.startsWith("symbol:") || generic ? "symbol" : "module";
    try {
      const artifact = createMemory(projectRoot, "insight", {
        title: candidate.content.length > 100 ? `${candidate.content.slice(0, 97)}...` : candidate.content,
        content: candidate.content,
        evidence: [runId, ...candidate.evidence],
        relations: [`derived_from: ${runId}`, `insight_kind: ${candidate.insightKind}`, ...candidate.relations],
        subjectType,
        subjectId: candidate.subject,
        sourceType: "run",
        sourceId: runId,
        confidence: 0.6,
        reviewTrigger: "subject implementation or evidence changes"
      });
      created.push(artifact.record.id);
    } catch (error) {
      warnings.push(`Could not create candidate for ${candidate.subject}: ${error.message}`);
    }
  }
  return { created, warnings };
}

module.exports = { extractLearningCandidates, learningSection, parseCandidate };
