"use strict";

const { ARTIFACT_TYPES } = require("../v2/schema");
const { ArtifactRepository } = require("../v2/artifacts");
const { artifactSnapshot, canonicalFingerprint, canonicalWatchSnapshot } = require("./canonical-snapshot");
const { extractTechnicalSummary } = require("./run-ledger");

const TERMINAL = new Set(["completed", "failed", "cancelled", "resolved", "rejected", "deprecated", "invalidated", "archived", "passed"]);

function briefLine(record, kind) {
  const marker = record.status === "completed" || record.status === "passed" || record.status === "resolved" ? "\u2713" : record.status === "failed" ? "\u2717" : "\u2022";
  return `- ${record.id} ${marker} ${record.title || record.id}`;
}

function generateBriefing(scrumDir, repository) {
  const repo = repository || new ArtifactRepository(scrumDir);
  const snapshot = artifactSnapshot(scrumDir);
  const sourceFingerprint = canonicalFingerprint(scrumDir, snapshot.hashes);
  const watch = canonicalWatchSnapshot(scrumDir);

  const activeWork = ["feature", "task", "sprint", "run", "review"]
    .flatMap((kind) => (snapshot.records[kind] || [])
      .filter((r) => r.id && !TERMINAL.has(r.status))
      .map((r) => r.assignee && r.assignee !== "agent"
        ? `- ${r.id} | ${r.status} | ${r.assignee} | ${r.title || r.id}`
        : `- ${r.id} | ${r.status} | ${r.title || r.id}`))
    .slice(0, 5);

  const completedRuns = (snapshot.records.run || [])
    .filter((r) => r.status === "completed")
    .slice(-5)
    .reverse();

  const recentLines = [];
  for (const run of completedRuns.slice(0, 3)) {
    const artifact = repo.read("run", run.id);
    const summary = artifact ? extractTechnicalSummary(artifact.body) : null;
    const text = summary ? summary.slice(0, 120) : (run.title || run.id);
    recentLines.push(`- ${run.id} \u2713 ${text}`);
  }

  const openDecisions = (snapshot.records.decision || [])
    .filter((r) => r.status === "open")
    .slice(-5)
    .map((r) => `- ${r.id} \u2014 ${r.title || r.id}`);

  const activeMemory = [
    ...(snapshot.records.knowledge || []).filter((r) => r.status === "approved").slice(-3),
    ...(snapshot.records.insight || []).filter((r) => r.status === "confirmed").slice(-3),
    ...(snapshot.records.decision || []).filter((r) => r.status === "resolved").slice(-3)
  ].map((r) => `- ${r.id} \u2014 ${r.title || r.id} (${r.status})`);

  const backlogTasks = (snapshot.records.task || [])
    .filter((r) => r.status === "backlog")
    .slice(0, 3)
    .map((r) => `- ${r.id} \u2014 ${r.title || r.id}`);

  const counts = {};
  for (const kind of Object.keys(ARTIFACT_TYPES)) {
    counts[kind] = (snapshot.records[kind] || []).length;
  }

  const content = `# ScrumRun Briefing

Projection schema: 2
Generated: ${new Date().toISOString()}
Source fingerprint: ${sourceFingerprint}
Watch fingerprint: ${watch.fingerprint}
Authority: none; rebuild from canonical artifacts.
Progressive disclosure: read this first; go deeper only if the briefing lacks what you need.

## Now

${activeWork.length ? activeWork.join("\n") : "- No active canonical work."}

## Recent

${recentLines.length ? recentLines.join("\n") : "- No completed Runs."}

## Open Decisions

${openDecisions.length ? openDecisions.join("\n") : "- None."}

## Active Memory

${activeMemory.length ? activeMemory.slice(0, 5).join("\n") : "- No active canonical memory."}

## Next Up

${backlogTasks.length ? backlogTasks.join("\n") : "- No backlog Tasks."}

## Where to look

- Guardrails: .scrumrun/guardrails.md
- Tasks: .scrumrun/tasks/ (${counts.task || 0} total)
- Runs: .scrumrun/runs/ (${counts.run || 0} total)
- Semantic: sc knowledge study "<topic>" for deep queries
- Full state: rebuild with sc config doctor --recover
`;

  return { content, sourceFingerprint, watchFingerprint: watch.fingerprint, sourceFiles: watch.files };
}

module.exports = { TERMINAL, generateBriefing };
