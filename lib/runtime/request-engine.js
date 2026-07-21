"use strict";

const { sha256 } = require("../v2/artifacts");
const { buildContextPackage } = require("./context");
const { containsSecret } = require("../security/secrets");

function assessRisk(request) {
  const text = request.toLowerCase();
  const high = ["delete", "drop ", "migration", "migrate", "payment", "pricing", "auth", "permission", "security", "secret", "production", "publish", "release", "deploy"];
  const medium = ["database", "schema", "api", "cache", "performance", "refactor", "dependency", "upgrade", "rename", "move"];
  const reasons = [];
  for (const term of high) if (text.includes(term)) reasons.push(`high-impact term: ${term.trim()}`);
  if (reasons.length) return { level: "high", reasons: [...new Set(reasons)].slice(0, 6) };
  for (const term of medium) if (text.includes(term)) reasons.push(`cross-cutting term: ${term}`);
  if (reasons.length) return { level: "medium", reasons: [...new Set(reasons)].slice(0, 6) };
  return { level: "low", reasons: ["no high-impact signals detected; validate scope before execution"] };
}

function classifyRequest(request) {
  const text = request.toLowerCase();
  if (/\b(investigat|analy[sz]|study|discover|pesquis|analis|estud|descobr)/.test(text)) {
    return { type: "discovery", taskType: "discovery", reason: "request is primarily knowledge-seeking" };
  }
  if (/\b(bug|fix|broken|regression|erro|falha|corrigir|consert)/.test(text)) {
    return { type: "fix", taskType: "fix", reason: "request describes corrective work" };
  }
  if (/\b(feature|initiative|epic|iniciativa|funcionalidade)\b/.test(text)) {
    return { type: "feature", taskType: "feature", reason: "request describes a long-lived product initiative" };
  }
  if (/\b(sprint|timebox|batch|release train|lote)\b/.test(text)) {
    return { type: "sprint", taskType: "task", reason: "request explicitly asks for a timebox or delivery batch" };
  }
  if (/\b(document|docs|readme|typo|texto|documenta)/.test(text)) {
    return { type: "task", taskType: "docs", reason: "request appears bounded to documentation" };
  }
  return { type: "task", taskType: "task", reason: "request is best represented as one atomic Task" };
}

function applyPolicy(context) {
  const violations = [];
  if (context.layout === "v1") violations.push("Project must be explicitly migrated to v2 before approved execution.");
  if (containsSecret(context.request)) violations.push("Request appears to contain a secret; remove/redact it before planning or persistence.");
  if (context.warnings.some((warning) => warning.includes("Secret-like content"))) violations.push("Canonical project context contains secret-like content; remove it before planning.");
  if (!context.guardrails.length) violations.push("No active canonical guardrail could be loaded.");
  if (context.warnings.some((warning) => warning.includes("guardrails.md"))) violations.push("Canonical guardrails are missing.");
  return {
    status: violations.length ? "blocked" : "passed",
    checked: context.guardrails.map((guardrail) => guardrail.id),
    violations
  };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function encodeApproval(plan) {
  const payload = {
    schema: 1,
    method: "2.0.0",
    request: plan.request,
    fingerprint: plan.context.fingerprint,
    classification: plan.classification,
    risk: plan.risk,
    policy: plan.policy,
    issuedAt: plan.issuedAt
  };
  const encoded = Buffer.from(stableJson(payload)).toString("base64url");
  const checksum = sha256(`scrumrun-v2-approval\0${encoded}`);
  return `${encoded}.${checksum}`;
}

function decodeApproval(token) {
  const [encoded, checksum, extra] = String(token || "").split(".");
  if (!encoded || !checksum || extra || sha256(`scrumrun-v2-approval\0${encoded}`) !== checksum) {
    throw new Error("Approval token is malformed or was modified.");
  }
  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new Error("Approval token payload is invalid.");
  }
  if (payload.schema !== 1 || payload.method !== "2.0.0") throw new Error("Approval token version is unsupported.");
  return payload;
}

function planRequest(projectRoot, request) {
  const normalized = String(request || "").trim();
  if (!normalized) throw new Error("A non-empty request is required for intake.");
  if (normalized.length > 10000) throw new Error("Request exceeds the 10,000 character intake limit.");
  const context = buildContextPackage(projectRoot, normalized);
  const policy = applyPolicy(context);
  const risk = assessRisk(normalized);
  const classification = classifyRequest(normalized);
  const plan = {
    state: policy.status === "passed" ? "awaiting_approval" : "blocked",
    pipeline: ["received", "contextualizing", "policy", "risk", "classification", "planning", policy.status === "passed" ? "awaiting_approval" : "blocked"],
    request: normalized,
    context,
    policy,
    risk,
    classification,
    proposal: {
      create: ["Task", "Run"],
      sprint: classification.type === "sprint" ? "propose only after confirming real batch/timebox membership" : null,
      validation: risk.level === "high" ? "targeted tests plus configured reviewers" : "targeted tests"
    },
    issuedAt: new Date().toISOString()
  };
  plan.approvalToken = policy.status === "passed" ? encodeApproval(plan) : null;
  return plan;
}

module.exports = {
  applyPolicy,
  assessRisk,
  classifyRequest,
  containsSecret,
  decodeApproval,
  encodeApproval,
  planRequest,
  stableJson
};
