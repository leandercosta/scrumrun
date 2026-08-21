"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { containsSecret } = require("../security/secrets");

const GUARDRAIL_STATUSES = new Set(["active", "retired", "superseded"]);
const ENFORCEMENTS = new Set([
  "manual",
  "builtin:secret-boundary",
  "builtin:approval-gate",
  "builtin:read-only-path",
  "builtin:owner-work",
  "builtin:canonical-write",
  "builtin:canonical-truth",
  "builtin:memory-candidate",
  "builtin:migration-integrity",
  "builtin:review-gate"
]);
const SCOPES = new Set(["all", "intake", "execution", "mutation", "canonical", "memory", "migration", "validation", "learning", "completion", "commit", "release", "logs"]);

function normalized(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function capped(value, limit = 500) {
  const text = String(value || "").trim();
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
}

function fieldMap(block) {
  const fields = {};
  for (const match of block.matchAll(/^([A-Za-z][A-Za-z _-]*):\s*(.+)$/gm)) {
    fields[normalized(match[1]).replace(/[ _-]+/g, "_")] = match[2].trim();
  }
  return fields;
}

function proseRule(block) {
  const lines = block.split(/\r?\n/).slice(1);
  const prose = [];
  for (const line of lines) {
    if (/^#{1,6}\s/.test(line)) break;
    if (/^[A-Za-z][A-Za-z _-]*:\s*/.test(line)) continue;
    if (!line.trim() && prose.length) break;
    if (line.trim()) prose.push(line.trim());
  }
  return prose.join(" ");
}

function inferEnforcement(title, rule) {
  const normalizedTitle = normalized(title);
  const text = normalized(`${title} ${rule}`);
  if (/secret|credential|vault|segredo|credencial/.test(text)) return "builtin:secret-boundary";
  if (/intake|pre-approval|pre approval|recebimento/.test(text) && /approval|approve|aprov|consent/.test(text)) return "builtin:approval-gate";
  if (/read.?only|somente leitura|path marked|caminho marcado/.test(text)) return "builtin:read-only-path";
  if (/owner work|trabalho do dono/.test(text) || (/(owner|dono|user changes|mudancas do usuario)/.test(text) && /(preserv|overwrite|sobrescrev)/.test(text))) return "builtin:owner-work";
  if (/migration|migracao|migrat|never guesses|nunca adivinha/.test(normalizedTitle)) return "builtin:migration-integrity";
  if (/commit|release|publish|lancamento|publica/.test(normalizedTitle) || (/(review|revis)/.test(normalizedTitle) && /gate|bloque|obrigator/.test(normalizedTitle))) return "builtin:review-gate";
  return "manual";
}

function parseGuardrails(content) {
  const source = String(content || "");
  const headings = [...source.matchAll(/^## (GR-\d{3,})\s*[-—:]\s*([^\r\n]+)$/gm)];
  return headings.map((heading, index) => {
    const end = index + 1 < headings.length ? headings[index + 1].index : source.length;
    const block = source.slice(heading.index, end);
    const fields = fieldMap(block);
    const title = heading[2].trim();
    const rule = capped(fields.rule || proseRule(block) || title);
    const status = normalized(fields.status || "active").replace(/[._-]+$/, "");
    const enforcement = normalized(fields.enforcement || inferEnforcement(title, rule));
    const scope = (fields.scope || "all").split(/\s*,\s*/).map((value) => normalized(value)).filter(Boolean);
    return {
      id: heading[1],
      title,
      rule,
      status,
      enforcement,
      scope,
      source: fields.source || null,
      explicit: {
        status: Object.prototype.hasOwnProperty.call(fields, "status"),
        enforcement: Object.prototype.hasOwnProperty.call(fields, "enforcement"),
        scope: Object.prototype.hasOwnProperty.call(fields, "scope"),
        rule: Object.prototype.hasOwnProperty.call(fields, "rule")
      }
    };
  });
}

function configFields(content) {
  return fieldMap(String(content || ""));
}

function agentIdentity(scrumDir) {
  if (process.env.SCRUMRUN_AGENT) {
    const env = String(process.env.SCRUMRUN_AGENT).trim();
    if (/^[A-Za-z0-9._-]{1,64}$/.test(env)) return env;
  }
  const configFile = path.join(scrumDir, "config.md");
  if (!fs.existsSync(configFile) || !fs.lstatSync(configFile).isFile()) return null;
  let content;
  try {
    content = fs.readFileSync(configFile, "utf8");
  } catch {
    return null;
  }
  const value = configFields(content).agent_identity;
  if (!value) return null;
  const clean = String(value).trim();
  return /^[A-Za-z0-9._-]{1,64}$/.test(clean) ? clean : null;
}

function readOnlyPaths(content) {
  const value = configFields(content).read_only_paths;
  if (!value) return [];
  return value.split(/\s*,\s*/).map((entry) => entry.trim()).filter(Boolean);
}

function configWeakeningAttempts(content) {
  const text = String(content || "");
  const fields = configFields(text);
  const violations = [];
  if (/^(?:never|off|disabled|automatic|nunca|desativad[oa]|automatic[oa])$/i.test(normalized(fields.execution_approval || ""))) {
    violations.push(`Execution Approval cannot be ${fields.execution_approval}.`);
  }
  if (/\b(?:disable|ignore|bypass|weaken|desativar|ignorar|contornar|enfraquecer)\s+(?:active\s+|ativ[oa]s?\s+)?(?:guardrail|policy|politica)/i.test(normalized(text))) {
    violations.push("Configuration attempts to disable or bypass active Guardrails.");
  }
  for (const entry of readOnlyPaths(text)) {
    if (entry.startsWith("/") || entry.includes("..") || entry === "." || entry === "~") violations.push(`Read-Only Paths contains an unsafe path: ${entry}`);
  }
  return violations;
}

function requestMentionsPath(request, configuredPath) {
  const clean = normalized(configuredPath.replace(/^\.\//, ""));
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[\\s"'\`:(])${escaped}(?=$|[/\\\\\\s"'\`:),])`).test(normalized(request));
}

function evaluation(guardrail, status, code, message, evidence = []) {
  return { guardrail: guardrail.id, status, code, message, enforcement: guardrail.enforcement, scope: guardrail.scope, evidence };
}

function evaluateGuardrail(guardrail, context) {
  const request = context.request || "";
  const requestText = normalized(request);
  switch (guardrail.enforcement) {
    case "builtin:secret-boundary": {
      const unsafeRequest = containsSecret(request);
      const unsafeContext = context.warnings.some((warning) => /secret-like/i.test(warning));
      if (unsafeRequest || unsafeContext) {
        return evaluation(guardrail, "blocked", "SECRET_BOUNDARY", "secret-like content must be removed or redacted before planning.", [unsafeRequest ? "request" : "canonical-context"]);
      }
      return evaluation(guardrail, "passed", "SECRET_BOUNDARY", "No secret-like request or canonical context was detected.");
    }
    case "builtin:approval-gate":
      return evaluation(guardrail, "passed", "APPROVAL_GATE", "Intake remains read-only and execution still requires the emitted approval token.", ["pipeline:awaiting_approval"]);
    case "builtin:read-only-path": {
      const paths = readOnlyPaths(context.config);
      const matched = paths.filter((entry) => requestMentionsPath(request, entry));
      if (matched.length) return evaluation(guardrail, "blocked", "READ_ONLY_PATH", `Request targets configured read-only path(s): ${matched.join(", ")}.`, matched);
      return evaluation(guardrail, paths.length ? "passed" : "deferred", "READ_ONLY_PATH", paths.length ? "Configured read-only paths were checked." : "No structured Read-Only Paths are configured; enforce owner path constraints during execution.", paths);
    }
    case "builtin:owner-work":
      return evaluation(guardrail, "deferred", "OWNER_WORK", "Mutation-time hashes, scoped staging, and transaction preconditions enforce owner-work preservation.");
    case "builtin:canonical-write":
      return evaluation(guardrail, "deferred", "CANONICAL_WRITE", "Canonical writes require the lossless transaction gateway and post-write validation.");
    case "builtin:canonical-truth":
      return evaluation(guardrail, "deferred", "CANONICAL_TRUTH", "Completion must prove that generated caches did not replace canonical Markdown truth.");
    case "builtin:memory-candidate":
      return evaluation(guardrail, "deferred", "MEMORY_CANDIDATE", "Learning and memory mutations must preserve candidate-first AI knowledge.");
    case "builtin:migration-integrity":
      return evaluation(guardrail, /migrat|migrac/.test(requestText) ? "deferred" : "passed", "MIGRATION_INTEGRITY", /migrat|migrac/.test(requestText) ? "The explicit migration preflight/apply/rollback gate must enforce this Guardrail." : "Request does not invoke migration.");
    case "builtin:review-gate":
      return evaluation(guardrail, /commit|release|publish|publica|lanc|deploy/.test(requestText) ? "deferred" : "passed", "REVIEW_GATE", /commit|release|publish|publica|lanc|deploy/.test(requestText) ? "Configured reviews and the external owner gate must pass before the requested boundary." : "Request does not cross a commit or release gate.");
    default:
      return evaluation(guardrail, "deferred", "MANUAL_GUARDRAIL", "This Guardrail has no deterministic matcher and requires execution-time review.");
  }
}

function evaluatePolicy(context) {
  const activeGuardrails = context.guardrails.filter((guardrail) => guardrail.status === "active");
  const evaluations = activeGuardrails.map((guardrail) => evaluateGuardrail(guardrail, context));
  if (context.layout === "v1") evaluations.push({ guardrail: "I-15", status: "blocked", code: "V1_REQUIRES_MIGRATION", message: "Project must be explicitly migrated to v2 before approved execution.", enforcement: "builtin", evidence: [] });
  if (!activeGuardrails.length) evaluations.push({ guardrail: "I-06", status: "blocked", code: "GUARDRAILS_MISSING", message: "No active canonical Guardrail could be loaded.", enforcement: "builtin", evidence: [] });
  if (context.warnings.some((warning) => warning.includes("guardrails.md"))) evaluations.push({ guardrail: "I-06", status: "blocked", code: "GUARDRAILS_MISSING", message: "Canonical guardrails.md is missing.", enforcement: "builtin", evidence: [] });
  for (const message of configWeakeningAttempts(context.config)) {
    evaluations.push({ guardrail: "I-06", status: "blocked", code: "CONFIG_WEAKENS_POLICY", message, enforcement: "builtin", evidence: ["config.md"] });
  }
  if (containsSecret(context.request) && !evaluations.some((item) => item.code === "SECRET_BOUNDARY" && item.status === "blocked")) {
    evaluations.push({ guardrail: "I-11", status: "blocked", code: "SECRET_BOUNDARY", message: "Request appears to contain a secret; remove or redact it.", enforcement: "builtin", evidence: ["request"] });
  }
  const blocked = evaluations.filter((item) => item.status === "blocked");
  const postApprovalScopes = new Set(["all", "execution", "mutation", "canonical", "memory", "migration", "validation", "learning", "completion", "commit", "release", "logs"]);
  const continuousEnforcement = new Set(["builtin:secret-boundary", "builtin:owner-work", "builtin:read-only-path", "builtin:canonical-write", "builtin:canonical-truth", "builtin:memory-candidate"]);
  const obligations = evaluations
    .filter((item) => item.status === "deferred" || (item.status === "passed" && continuousEnforcement.has(item.enforcement) && (item.scope || []).some((scope) => postApprovalScopes.has(scope))))
    .map((item) => ({
      guardrail: item.guardrail,
      code: item.code,
      enforcement: item.enforcement,
      scope: item.scope,
      gate: obligationGate(item)
    }));
  return {
    status: blocked.length ? "blocked" : "passed",
    checked: [...new Set(evaluations.map((item) => item.guardrail))],
    deferred: [...new Set(evaluations.filter((item) => item.status === "deferred").map((item) => item.guardrail))],
    obligations,
    evaluations,
    violations: blocked.map((item) => `${item.guardrail} ${item.code}: ${item.message}`)
  };
}

function obligationGate(evaluationResult) {
  const scopes = evaluationResult.scope || [];
  for (const gate of ["mutation", "migration", "validation", "learning", "completion", "commit", "release", "memory", "canonical"]) {
    if (scopes.includes(gate)) return gate;
  }
  switch (evaluationResult.enforcement) {
    case "builtin:owner-work":
    case "builtin:read-only-path":
    case "builtin:secret-boundary":
      return "mutation";
    case "builtin:migration-integrity":
      return "migration";
    case "builtin:memory-candidate":
      return "learning";
    case "builtin:review-gate":
      return "commit";
    default:
      return "completion";
  }
}

function validateGuardrailDocument(content) {
  const records = parseGuardrails(content);
  const errors = [];
  const ids = new Set();
  for (const record of records) {
    if (ids.has(record.id)) errors.push(`Duplicate Guardrail id: ${record.id}`);
    ids.add(record.id);
    if (!GUARDRAIL_STATUSES.has(record.status)) errors.push(`${record.id} has invalid status: ${record.status || "missing"}`);
    if (!record.rule.trim()) errors.push(`${record.id} has no rule content`);
    if (!ENFORCEMENTS.has(record.enforcement)) errors.push(`${record.id} has unknown enforcement: ${record.enforcement}`);
    if (!record.scope.length) errors.push(`${record.id} has no scope`);
    for (const scope of record.scope) if (!SCOPES.has(scope)) errors.push(`${record.id} has unknown scope: ${scope}`);
  }
  return { records, errors };
}

function normalizeGuardrailDocument(content) {
  const source = String(content || "");
  const records = parseGuardrails(source);
  const headings = [...source.matchAll(/^## (GR-\d{3,})\s*[-—:]\s*([^\r\n]+)$/gm)];
  let next = source;
  for (let index = headings.length - 1; index >= 0; index--) {
    const heading = headings[index];
    const record = records.find((item) => item.id === heading[1]);
    if (!record) continue;
    const missing = [];
    if (!record.explicit.status) missing.push(`Status: ${record.status}`);
    if (!record.explicit.enforcement) missing.push(`Enforcement: ${record.enforcement}`);
    if (!record.explicit.scope) missing.push(`Scope: ${record.scope.join(", ") || "all"}`);
    if (!record.explicit.rule) missing.push(`Rule: ${record.rule}`);
    if (!missing.length) continue;
    const lineEnd = next.indexOf("\n", heading.index);
    const insertAt = lineEnd < 0 ? next.length : lineEnd + 1;
    next = `${next.slice(0, insertAt)}\n${missing.join("\n")}\n${next.slice(insertAt)}`;
  }
  return next.endsWith("\n") ? next : `${next}\n`;
}

module.exports = {
  agentIdentity,
  configWeakeningAttempts,
  evaluatePolicy,
  inferEnforcement,
  normalizeGuardrailDocument,
  obligationGate,
  normalized,
  parseGuardrails,
  readOnlyPaths,
  validateGuardrailDocument
};
