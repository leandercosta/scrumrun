"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { parseRunLedger } = require("../runtime/run-ledger");

function readFrontmatter(body) {
  const match = String(body || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/i);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === "null" || value === "") value = null;
    else if (/^-?\d+$/.test(value)) value = Number(value);
    result[kv[1]] = value;
  }
  return result;
}

function loadRuns(cwd) {
  const dir = path.join(cwd, ".scrumrun", "runs");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((name) => /^RUN-\d{3,}\.md$/.test(name))
    .sort()
    .map((name) => {
      const file = path.join(dir, name);
      const body = fs.readFileSync(file, "utf8");
      return { id: name.replace(/\.md$/, ""), file, body, frontmatter: readFrontmatter(body) };
    });
}

function transitions(events) {
  return events.filter((event) => event && event.type === "transition");
}

function firstEntryInto(events, status) {
  for (const event of transitions(events)) {
    if (event.to === status) return event.occurred_at;
  }
  return null;
}

function lastExitFrom(events, status) {
  let last = null;
  for (const event of transitions(events)) {
    if (event.from === status) last = event.occurred_at;
  }
  return last;
}

function durationMs(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const delta = new Date(endIso).valueOf() - new Date(startIso).valueOf();
  return Number.isFinite(delta) && delta >= 0 ? delta : null;
}

function percentile(sortedMs, p) {
  if (!sortedMs.length) return null;
  const rank = Math.min(sortedMs.length - 1, Math.max(0, Math.floor((p / 100) * sortedMs.length)));
  return sortedMs[rank];
}

function humanMs(ms) {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "-";
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (minutes < 60) return rem ? `${minutes}m ${rem}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mrem = minutes % 60;
  return mrem ? `${hours}h ${mrem}m` : `${hours}h`;
}

function computeStats(cwd, filters = {}) {
  const runs = loadRuns(cwd).filter((run) => {
    if (filters.task && run.frontmatter.task !== filters.task) return false;
    if (filters.feature && run.frontmatter.feature !== filters.feature) return false;
    if (filters.sprint && run.frontmatter.sprint !== filters.sprint) return false;
    return true;
  });

  const summary = {
    total: runs.length,
    byStatus: {},
    validating: { count: 0, samples: [], p50: null, p95: null, max: null },
    executing: { count: 0, samples: [], p50: null, p95: null, max: null },
    attempts: { max: 0, byTask: {} },
    guardrails: { passed: 0, deferred: 0, blocked: 0 },
    mutations: 0,
    completionsWithFailurePredecessor: 0
  };

  const failedTaskIds = new Set();

  for (const run of runs) {
    const status = run.frontmatter.status || "unknown";
    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1;

    const attempt = Number(run.frontmatter.attempt) || 1;
    if (attempt > summary.attempts.max) summary.attempts.max = attempt;
    if (run.frontmatter.task) {
      summary.attempts.byTask[run.frontmatter.task] = Math.max(summary.attempts.byTask[run.frontmatter.task] || 0, attempt);
    }

    if (status === "failed" && run.frontmatter.task) failedTaskIds.add(run.frontmatter.task);
    if (status === "completed" && run.frontmatter.task && failedTaskIds.has(run.frontmatter.task)) {
      summary.completionsWithFailurePredecessor += 1;
    }

    const { events } = parseRunLedger(run.body);
    const enterValidating = firstEntryInto(events, "validating");
    const exitValidating = lastExitFrom(events, "validating");
    const validatingMs = durationMs(enterValidating, exitValidating);
    if (validatingMs !== null) {
      summary.validating.count += 1;
      summary.validating.samples.push(validatingMs);
    }

    const enterExecuting = firstEntryInto(events, "executing");
    const exitExecuting = lastExitFrom(events, "executing");
    const executingMs = durationMs(enterExecuting, exitExecuting);
    if (executingMs !== null) {
      summary.executing.count += 1;
      summary.executing.samples.push(executingMs);
    }

    for (const event of events) {
      if (event.type === "guardrail") {
        const state = String(event.status || event.result || "").toLowerCase();
        if (state === "passed") summary.guardrails.passed += 1;
        else if (state === "deferred") summary.guardrails.deferred += 1;
        else if (state === "blocked") summary.guardrails.blocked += 1;
      } else if (event.type === "mutation") {
        summary.mutations += 1;
      }
    }
  }

  for (const key of ["validating", "executing"]) {
    const samples = summary[key].samples.slice().sort((a, b) => a - b);
    summary[key].p50 = percentile(samples, 50);
    summary[key].p95 = percentile(samples, 95);
    summary[key].max = samples[samples.length - 1] ?? null;
    delete summary[key].samples;
  }

  return summary;
}

function renderStats(summary, filters = {}) {
  const lines = [];
  const scope = [];
  if (filters.task) scope.push(`task=${filters.task}`);
  if (filters.feature) scope.push(`feature=${filters.feature}`);
  if (filters.sprint) scope.push(`sprint=${filters.sprint}`);
  lines.push(`Run statistics${scope.length ? ` (${scope.join(", ")})` : ""}`);
  lines.push("─".repeat(72));
  lines.push(`total runs                       ${summary.total}`);

  const statusEntries = Object.entries(summary.byStatus).sort((a, b) => b[1] - a[1]);
  if (statusEntries.length) {
    lines.push("");
    lines.push("by status");
    for (const [status, count] of statusEntries) {
      lines.push(`  ${status.padEnd(30, " ")} ${count}`);
    }
  }

  lines.push("");
  lines.push("time in VALIDATING");
  lines.push(`  runs sampled                   ${summary.validating.count}`);
  lines.push(`  p50                            ${humanMs(summary.validating.p50)}`);
  lines.push(`  p95                            ${humanMs(summary.validating.p95)}`);
  lines.push(`  max                            ${humanMs(summary.validating.max)}`);

  lines.push("");
  lines.push("time in EXECUTING");
  lines.push(`  runs sampled                   ${summary.executing.count}`);
  lines.push(`  p50                            ${humanMs(summary.executing.p50)}`);
  lines.push(`  p95                            ${humanMs(summary.executing.p95)}`);
  lines.push(`  max                            ${humanMs(summary.executing.max)}`);

  lines.push("");
  lines.push("retries and recovery");
  lines.push(`  highest attempt observed       ${summary.attempts.max}`);
  const retriedTasks = Object.entries(summary.attempts.byTask).filter(([, n]) => n > 1);
  lines.push(`  tasks that retried             ${retriedTasks.length}`);
  lines.push(`  completions after prior fail   ${summary.completionsWithFailurePredecessor}`);

  lines.push("");
  lines.push("guardrails and edit permits");
  lines.push(`  guardrail events passed        ${summary.guardrails.passed}`);
  lines.push(`  guardrail events deferred      ${summary.guardrails.deferred}`);
  lines.push(`  guardrail events blocked       ${summary.guardrails.blocked}`);
  lines.push(`  recorded mutation events       ${summary.mutations}`);

  return lines.join("\n");
}

module.exports = { computeStats, renderStats, loadRuns };
