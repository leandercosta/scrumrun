"use strict";

const fs = require("node:fs");
const path = require("node:path");

const { parseRunLedger } = require("../runtime/run-ledger");

const RULE = "─".repeat(72);

function formatInstant(iso) {
  if (!iso) return "                     ";
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return String(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} UTC`;
}

function humanDuration(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const delta = new Date(endIso).valueOf() - new Date(startIso).valueOf();
  if (!Number.isFinite(delta) || delta < 0) return null;
  const seconds = Math.round(delta / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const rem = seconds % 60;
  if (minutes < 60) return rem ? `${minutes}m ${rem}s` : `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const mrem = minutes % 60;
  return mrem ? `${hours}h ${mrem}m` : `${hours}h`;
}

function readFrontmatter(body) {
  const match = String(body || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result = {};
  for (const line of match[1].split(/\r?\n/)) {
    const kv = line.match(/^([a-z_][a-z0-9_]*):\s*(.*)$/i);
    if (!kv) continue;
    let value = kv[2].trim();
    if (value === "null") value = null;
    else if (/^-?\d+$/.test(value)) value = Number(value);
    result[kv[1]] = value;
  }
  return result;
}

function readTitle(body) {
  const match = String(body || "").match(/^#\s+([^\r\n]+)/m);
  return match ? match[1].trim() : null;
}

function summarizeEvidence(evidence) {
  if (!Array.isArray(evidence) || !evidence.length) return [];
  return evidence.map((item) => {
    if (!item || typeof item !== "object") return String(item);
    const kind = item.kind || "evidence";
    if (item.ref && item.summary) return `${kind}: ${item.ref} — ${item.summary}`;
    if (item.ref) return `${kind}: ${item.ref}`;
    if (item.command) return `${kind}: ${item.command}${item.result ? ` → ${item.result}` : ""}`;
    if (item.test) return `${kind}: ${item.test}${item.result ? ` → ${item.result}` : ""}`;
    if (item.summary) return `${kind}: ${item.summary}`;
    return kind;
  });
}

function headline(event) {
  const type = event.type || "event";
  if (type === "transition") {
    const from = event.from || "?";
    const to = event.to || "?";
    return `${from} → ${to}`;
  }
  if (type === "snapshot") return "snapshot (baseline)";
  if (type === "guardrail") {
    const status = event.status || event.result || "recorded";
    return `guardrail ${event.guardrail || event.code || ""} ${status}`.trim();
  }
  if (type === "mutation") {
    const permit = event.mutation || event.permit || "";
    return `mutation ${permit}`.trim();
  }
  return type;
}

function renderEvent(event, indent = "  ") {
  const lines = [];
  const time = formatInstant(event.occurred_at);
  const actor = String(event.actor || "?").padEnd(8, " ");
  lines.push(`${time}  ${actor}${event.id || ""}  ${headline(event)}`);
  if (event.reason) {
    lines.push(`${indent}reason    ${event.reason}`);
  }
  const evidence = summarizeEvidence(event.evidence);
  if (evidence.length) {
    lines.push(`${indent}evidence  ${evidence[0]}`);
    for (let i = 1; i < evidence.length; i++) {
      lines.push(`${indent}          ${evidence[i]}`);
    }
  }
  if (event.type === "mutation" && Array.isArray(event.paths) && event.paths.length) {
    lines.push(`${indent}paths     ${event.paths.join(", ")}`);
  }
  if (event.type === "guardrail" && event.gate) {
    lines.push(`${indent}gate      ${event.gate}`);
  }
  return lines.join("\n");
}

function renderRun({ id, file, body }) {
  const frontmatter = readFrontmatter(body);
  const title = readTitle(body) || id;
  const { events, errors } = parseRunLedger(body);

  const header = [
    `${id}  ${title}`,
    `status ${frontmatter.status || "unknown"}   task ${frontmatter.task || "-"}   attempt ${frontmatter.attempt ?? "-"}   sprint ${frontmatter.sprint || "-"}`,
    file ? `file   ${path.relative(process.cwd(), file)}` : null,
    RULE
  ].filter(Boolean);

  const body_lines = [];
  if (!events.length) {
    body_lines.push("(no ledger events found)");
  } else {
    for (let i = 0; i < events.length; i++) {
      body_lines.push(renderEvent(events[i]));
      if (i < events.length - 1) body_lines.push("");
    }
  }

  const first = events[0]?.occurred_at;
  const last = events[events.length - 1]?.occurred_at;
  const duration = humanDuration(first, last);

  const footer = [
    RULE,
    `${events.length} event${events.length === 1 ? "" : "s"}${duration ? `   span ${duration}` : ""}`
  ];

  if (errors.length) {
    footer.push("");
    footer.push("Ledger validation warnings:");
    for (const err of errors) footer.push(`  - ${err}`);
  }

  return [...header, ...body_lines, ...footer].join("\n");
}

function locateRun(cwd, runId) {
  const file = path.join(cwd, ".scrumrun", "runs", `${runId}.md`);
  if (!fs.existsSync(file)) return null;
  return { id: runId, file, body: fs.readFileSync(file, "utf8") };
}

function renderRunFromDisk(cwd, runId) {
  const run = locateRun(cwd, runId);
  if (!run) throw new Error(`Run not found: ${runId}`);
  return renderRun(run);
}

module.exports = { renderRun, renderRunFromDisk, formatInstant, humanDuration, summarizeEvidence };
