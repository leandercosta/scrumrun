"use strict";

const { sha256 } = require("../v2/artifacts");
const { buildContextPackage } = require("./context");
const { containsSecret } = require("../security/secrets");
const { evaluatePolicy, normalized } = require("./policy-engine");
const { workspaceState } = require("./workspace-state");

function assessRisk(request) {
  const text = normalized(request);
  const high = [
    ["destructive", /\b(delete|drop|truncate|erase|wipe|apagar|excluir|remover tudo)\b/],
    ["migration", /\b(migrat\w*|migrac\w*)\b/],
    ["external-release", /\b(publish|release|deploy|publicar|lancar|implant|producao)\b/],
    ["security-boundary", /\b(auth|authorization|permission|security|secret|credential|autentic|autoriz|permiss|seguranca|segredo|credencial)\b/],
    ["money", /\b(payment|pricing|billing|pagamento|preco|faturamento)\b/]
  ];
  const medium = [
    ["data-or-contract", /\b(database|schema|api|contract|banco|contrato)\b/],
    ["runtime-kernel", /\b(runtime|kernel|transaction|journal|recovery|multi-file|transacion|recuperac|multi-arquivo)\b/],
    ["performance-or-cache", /\b(cache|performance|latency|index|desempenho|latencia|indice)\b/],
    ["dependency-or-upgrade", /\b(dependency|upgrade|package|version|dependencia|atualiz|versao)\b/],
    ["cross-cutting-change", /\b(refactor|rename|move|architecture|cli|refator|renome|mover|arquitetura)\b/]
  ];
  const highSignals = high.filter(([, matcher]) => matcher.test(text)).map(([signal]) => `high-impact signal: ${signal}`);
  if (highSignals.length) return { level: "high", reasons: highSignals.slice(0, 6) };
  const mediumSignals = medium.filter(([, matcher]) => matcher.test(text)).map(([signal]) => `cross-cutting signal: ${signal}`);
  if (mediumSignals.length) return { level: "medium", reasons: mediumSignals.slice(0, 6) };
  return { level: "low", reasons: ["no high-impact signals detected; validate scope before execution"] };
}

function classifyRequest(request) {
  const text = normalized(request);
  if (/\b(investigat|analy[sz]|study|discover|pesquis|analis|estud|descobr)/.test(text)) {
    return { type: "discovery", taskType: "discovery", reason: "request is primarily knowledge-seeking" };
  }
  if (/\b(bug|fix|broken|regression|erro|falha|corrigir|consertar)\b/.test(text)) {
    return { type: "fix", taskType: "fix", reason: "request describes corrective work" };
  }
  if (/\b(initiative|epic|roadmap|program|iniciativa|programa)\b/.test(text)) {
    return { type: "feature", taskType: "feature", reason: "request describes a long-lived product initiative" };
  }
  if (/\b(sprint|timebox|batch|release train|lote)\b/.test(text) && /\b(tasks?|tarefas?|entregas?)\b/.test(text)) {
    return { type: "sprint", taskType: "task", reason: "request explicitly asks for a timebox or delivery batch" };
  }
  const documentation = /\b(document|docs|readme|typo|texto|documenta)/.test(text);
  const implementation = /\b(implement\w*|build\w*|creat\w*|add\w*|runtime|kernel|schema|migrat\w*|migrac\w*|transaction\w*|code|cli|criar|adicionar|construir|codigo|transacion\w*)\b/.test(text);
  if (documentation && !implementation) {
    return { type: "task", taskType: "docs", reason: "request appears bounded to documentation" };
  }
  return { type: "task", taskType: "task", reason: "request is best represented as one atomic Task" };
}

function applyPolicy(context) {
  return evaluatePolicy(context);
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
    workspaceFingerprint: plan.workspaceFingerprint,
    preview: plan.preview || null,
    issuedAt: plan.issuedAt
  };
  const encoded = Buffer.from(stableJson(payload)).toString("base64url");
  const checksum = sha256(`scrumrun-v2-approval\0${encoded}`);
  return `${encoded}.${checksum}`;
}

function decodeApproval(token) {
  const cleaned = String(token || "").replace(/\s+/g, "");
  const [encoded, checksum, extra] = cleaned.split(".");
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

const TYPE_MAP = {
  fix: { type: "fix", taskType: "fix" },
  task: { type: "task", taskType: "task" },
  feature: { type: "feature", taskType: "feature" },
  docs: { type: "task", taskType: "docs" },
  discovery: { type: "discovery", taskType: "discovery" }
};

function planRequest(projectRoot, request, { typeOverride = null, preview = null } = {}) {
  const normalized = String(request || "").trim();
  if (!normalized) throw new Error("A non-empty request is required for intake.");
  if (normalized.length > 10000) throw new Error("Request exceeds the 10,000 character intake limit.");
  const context = buildContextPackage(projectRoot, normalized);
  const workspaceFingerprint = workspaceState(projectRoot).fingerprint;
  const policy = applyPolicy(context);
  const risk = assessRisk(normalized);
  let classification = classifyRequest(normalized);
  if (typeOverride) {
    const override = TYPE_MAP[typeOverride];
    if (!override) throw new Error(`Invalid --type: ${typeOverride}. Valid: ${Object.keys(TYPE_MAP).join(", ")}.`);
    classification = { type: override.type, taskType: override.taskType, reason: "explicitly specified by agent" };
  }
  let safePreview = null;
  if (preview) {
    if (containsSecret(preview)) throw new Error("Preview contains secret-like content.");
    safePreview = String(preview).trim().slice(0, 2000);
  }
  const plan = {
    state: policy.status === "passed" ? "awaiting_approval" : "blocked",
    pipeline: ["received", "contextualizing", "policy", "risk", "classification", "planning", policy.status === "passed" ? "awaiting_approval" : "blocked"],
    request: normalized,
    context,
    workspaceFingerprint,
    policy,
    risk,
    classification,
    preview: safePreview,
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
