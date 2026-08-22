"use strict";

// Pretty terminal renderer for `sc plan intake` and related outputs.
// Zero-dep: pure ANSI escapes plus Unicode box drawing. Automatically
// falls back to a plain, machine-friendly format when the environment
// is not an interactive TTY (piped, redirected, NO_COLOR, --json, ...).
//
// Contract:
//   canRenderPretty(stream?) -> boolean
//   renderIntake(plan)       -> string   (pretty; assumes canRenderPretty)
//   renderIntakePlain(plan)  -> string   (existing Markdown-style summary)

const RESET = "\x1b[0m";

const STYLES = {
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  underline: "\x1b[4m"
};

const FG = {
  black: "\x1b[30m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  brightGreen: "\x1b[92m",
  brightYellow: "\x1b[93m",
  brightRed: "\x1b[91m",
  brightCyan: "\x1b[96m"
};

// Signature acid lime (#c9ff5c) via 24-bit truecolor when available.
const ACID_FG = "\x1b[38;2;201;255;92m";
const DIM_ACID_FG = "\x1b[38;2;140;180;60m";

function canRenderPretty(stream = process.stdout) {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR === "0") return false;
  if (process.env.FORCE_COLOR && Number(process.env.FORCE_COLOR) > 0) return true;
  return Boolean(stream && stream.isTTY);
}

function paint(color, text) {
  return `${color}${text}${RESET}`;
}

function stripAnsi(text) {
  return String(text).replace(/\x1b\[[0-9;]*m/g, "");
}

function visibleLength(text) {
  return stripAnsi(text).length;
}

function padEnd(text, width) {
  const visible = visibleLength(text);
  if (visible >= width) return text;
  return text + " ".repeat(width - visible);
}

function terminalWidth(min = 60, max = 90) {
  const columns = (process.stdout && process.stdout.columns) || 80;
  return Math.max(min, Math.min(max, columns - 2));
}

function wrap(text, width) {
  if (!text) return [""];
  const words = String(text).split(/\s+/);
  const lines = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
      continue;
    }
    if ((current + " " + word).length <= width) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function hardWrap(text, width) {
  const source = String(text || "");
  const lines = [];
  for (let index = 0; index < source.length; index += width) {
    lines.push(source.slice(index, index + width));
  }
  return lines.length ? lines : [""];
}

function boxTop(width, title) {
  const label = ` ${title} `;
  const remaining = width - visibleLength(label) - 4;
  const left = "╭─";
  const right = "─".repeat(Math.max(0, remaining)) + "─╮";
  return paint(FG.gray, `${left}${paint(ACID_FG, label)}${paint(FG.gray, right)}`);
}

function boxBottom(width) {
  return paint(FG.gray, `╰${"─".repeat(width - 2)}╯`);
}

function boxBlank(width) {
  return paint(FG.gray, `│`) + " ".repeat(width - 2) + paint(FG.gray, `│`);
}

function boxLine(width, content) {
  const paddedInterior = padEnd(content, width - 4);
  return paint(FG.gray, `│ `) + paddedInterior + paint(FG.gray, ` │`);
}

const RISK_TONE = {
  low: FG.brightGreen,
  medium: FG.brightYellow,
  high: FG.brightRed
};

const CLASSIFICATION_ALIAS = {
  task: "Task",
  fix: "Task (fix)",
  sprint: "Sprint",
  feature: "Feature",
  backlog: "Backlog Task",
  knowledge: "Knowledge discovery",
  reject: "Rejected"
};

function classificationLabel(classification) {
  const alias = CLASSIFICATION_ALIAS[classification.type];
  return alias || classification.type;
}

function classificationLaneLabel(classification) {
  const alias = CLASSIFICATION_ALIAS[classification.type];
  if (alias) return alias.toLowerCase() + " lane";
  return `${classification.type} lane`;
}

function pipelineDot(stage, blocked) {
  const color = blocked && stage === "BLOCKED" ? FG.brightRed : ACID_FG;
  return paint(color, "●");
}

function fieldLine(label, value, width, valueColor = FG.white, labelColor = FG.gray) {
  const labelText = paint(labelColor, padEnd(label.padEnd(15).toUpperCase(), 15));
  const wrapWidth = Math.max(20, width - 4 - 15 - 2);
  const lines = wrap(value, wrapWidth);
  const rendered = [];
  for (let i = 0; i < lines.length; i++) {
    const prefix = i === 0 ? labelText : padEnd("", 15);
    rendered.push(boxLine(width, `${prefix}  ${paint(valueColor, lines[i])}`));
  }
  return rendered;
}

function pipelineDetail(stage, plan) {
  if (stage === "POLICY") {
    return `${plan.policy.checked.length} checked · ${plan.policy.deferred.length} deferred`;
  }
  if (stage === "RISK") {
    return `${plan.risk.level} · ${plan.risk.reasons[0] || ""}`.replace(/·\s*$/, "").trim();
  }
  if (stage === "CLASSIFICATION") {
    return classificationLabel(plan.classification).toLowerCase();
  }
  if (stage === "AWAITING_APPROVAL") return "";
  if (stage === "BLOCKED") return "policy denied — no token issued";
  return "";
}

function renderIntake(plan) {
  const width = terminalWidth();
  const isBlocked = plan.state === "blocked";
  const title = `intake pipeline · ${classificationLaneLabel(plan.classification)}`;
  const lines = [];

  lines.push(boxTop(width, title));
  lines.push(boxBlank(width));

  // Owner prompt
  const promptLines = wrap(plan.request, width - 6);
  for (let i = 0; i < promptLines.length; i++) {
    const marker = i === 0 ? paint(ACID_FG, "❯ ") : "  ";
    lines.push(boxLine(width, `  ${marker}${paint(FG.white, promptLines[i])}`));
  }
  lines.push(boxBlank(width));

  // Pipeline
  for (const stage of plan.pipeline) {
    const upper = stage.toUpperCase();
    const detail = pipelineDetail(upper, plan);
    const dot = pipelineDot(upper, isBlocked);
    const label = paint(isBlocked && upper === "BLOCKED" ? FG.brightRed : FG.white, padEnd(upper, 18));
    const suffix = detail ? paint(FG.gray, detail) : "";
    lines.push(boxLine(width, `  ${dot} ${label} ${suffix}`));
  }
  lines.push(boxBlank(width));

  // Field summary
  const classificationText = classificationLabel(plan.classification);
  lines.push(...fieldLine("Classification", classificationText, width, ACID_FG));
  lines.push(...fieldLine("Why", plan.classification.reason, width, FG.gray));
  if (plan.preview) {
    lines.push(...fieldLine("Preview", plan.preview, width, FG.cyan));
  }
  const riskColor = RISK_TONE[plan.risk.level] || FG.white;
  lines.push(...fieldLine("Risk", `${plan.risk.level} · ${plan.risk.reasons.join("; ")}`, width, riskColor));

  // Deferred guardrails
  const deferred = plan.policy.evaluations.filter((entry) => entry.status === "deferred");
  if (deferred.length) {
    lines.push(boxBlank(width));
    lines.push(boxLine(width, `  ${paint(FG.gray, "DEFERRED GUARDRAILS")}`));
    for (const entry of deferred) {
      const gr = paint(FG.brightYellow, entry.guardrail);
      const code = paint(FG.gray, entry.code);
      const short = entry.message.length > width - 30 ? entry.message.slice(0, width - 33) + "…" : entry.message;
      lines.push(boxLine(width, `  ${gr} ${code}  ${paint(FG.white, short)}`));
    }
  }

  // Approval or blocked
  lines.push(boxBlank(width));
  if (isBlocked) {
    lines.push(boxLine(width, `  ${paint(FG.brightRed, "BLOCKED")} ${paint(FG.gray, "no approval token issued")}`));
    if (plan.policy.violations && plan.policy.violations.length) {
      for (const violation of plan.policy.violations) {
        lines.push(boxLine(width, `  ${paint(FG.brightRed, "!")} ${paint(FG.white, violation)}`));
      }
    }
  } else if (plan.approvalToken) {
    const command = "scrumrun sc plan intake --approve";
    const tokenWidth = Math.max(16, width - 8);
    lines.push(boxLine(width, `  ${paint(FG.gray, "APPROVE · copy the command below to create Task + Run")}`));
    lines.push(boxLine(width, `  ${paint(ACID_FG, "$")} ${paint(FG.white, command)}`));
    for (const chunk of hardWrap(plan.approvalToken, tokenWidth)) {
      lines.push(boxLine(width, `    ${paint(DIM_ACID_FG, chunk)}`));
    }
    lines.push(boxBlank(width));
    lines.push(boxLine(width, `  ${paint(FG.gray, "[ awaiting owner approval ]")}`));
  }
  lines.push(boxBlank(width));
  lines.push(boxBottom(width));
  return lines.join("\n");
}

function renderIntakePlain(plan) {
  const lines = [];
  lines.push("# ScrumRun Intake");
  lines.push(`State: ${plan.state}`);
  lines.push(`Classification: ${plan.classification.type} (${plan.classification.reason})`);
  if (plan.preview) lines.push(`Preview: ${plan.preview}`);
  lines.push(`Risk: ${plan.risk.level} — ${plan.risk.reasons.join("; ")}`);
  lines.push(`Policy: ${plan.policy.status} (${plan.policy.checked.length} checked; ${plan.policy.deferred.length} deferred)`);
  for (const violation of plan.policy.violations || []) lines.push(`BLOCKED: ${violation}`);
  for (const result of plan.policy.evaluations.filter((entry) => entry.status === "deferred")) {
    lines.push(`DEFERRED: ${result.guardrail} ${result.code}: ${result.message}`);
  }
  for (const warning of plan.context.warnings) lines.push(`WARNING: ${warning}`);
  if (plan.approvalToken) lines.push(`Approval: scrumrun sc plan intake --approve ${plan.approvalToken}`);
  return lines.join("\n");
}

module.exports = { canRenderPretty, renderIntake, renderIntakePlain };
