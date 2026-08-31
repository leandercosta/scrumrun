"use strict";

const { METHOD_VERSION, aliases, nouns } = require("./manifest");

function grammarLines() {
  return Object.entries(nouns).flatMap(([noun, spec]) => [
    `- **${noun}** — ${spec.description}`,
    ...Object.entries(spec.subjects).map(([subject, actions]) => `  - \`${subject}\`: ${actions.join(", ")}`)
  ]);
}

function renderRootPrompt() {
  return `---
description: ScrumRun ${METHOD_VERSION} — one root command for planning, execution, memory, rules, reviews, and configuration
argument-hint: <noun> <subject> <action> [args]
---

Execute ScrumRun with this request: $ARGUMENTS

Use the installed \`scrumrun\` skill as the authoritative workflow. This prompt is the only canonical slash-command entry point.

If \`$ARGUMENTS\` is empty, show the five nouns below and the current project status; do not guess an action. Otherwise parse exactly \`<noun> <subject> <action> [args]\`. \`/sc\` is a client shortcut retained for compatibility, never a reason to use \`npx\`. The CLI is optional maintenance; do not turn ordinary product work into a sequence of CLI calls.

## Grammar

${grammarLines().join("\n")}

## Execution contract

- Natural-language product work begins with a read-only understanding pass; do not invoke \`plan intake\` merely to satisfy procedure.
- Intake, contextualization, policy, risk, classification, and planning are read-only until explicit approval.
- After approval, work directly in source files and relevant \`.scrumrun/\` Markdown until the approved Task is delivered. Keep executing discover → implement → verify → fix → verify; a progress report is allowed only when the owner asks for it and never ends the workflow. Do not answer with an inventory, partial progress report, decomposition, or remaining-work list; those are internal steps. A gap discovered in scope is work to implement now, not a “next step”. Feature/Sprint/Run are useful only when they add context.
- A Run is optional audit/handoff context, never a prerequisite for starting, amending, or completing a Task. Do not block on a missing Run, a legacy status, or stale generated state.
- The CLI can inspect/repair/report structured artifacts, but it does not own the daily workflow.
- \`guardrails.md\` is canonical project policy; \`golden-rules.md\` is v1 compatibility only.
- Evaluate active Guardrails as \`passed\`, \`blocked\`, or \`deferred\`; cite exact \`GR-NNN\` ids and keep deferred execution gates visible.
- Block only for an explicit Guardrail, secret/security risk, destructive action without approval, or an unmet required delivery criterion. \`Follow-ups\` may only contain work outside the approved \`Done when\` contract; optional unrun E2E/review coverage is a follow-up/risk, not a failed Run.
- Use the CLI only for \`init\`, \`update --project\`, \`migrate\`, \`repair\`, \`doctor\`, reports, or release checks. Do not invoke \`npx scrumrun@latest\` during execution.
- Never invoke \`plan run --fail|--block|--retry|--finalize|--complete|--validate\` or \`plan task --start\` during normal work. These optional strict-audit commands must not decide a Task outcome.
- Strict per-path Mutation Gateway permits and ledger finalization remain available only when the owner explicitly requests strict execution.
- Never edit \`core.md\` or \`guardrails.md\` during product work. They are sealed policy; owner-requested policy changes are reviewed and sealed at the maintenance edge.
- Knowledge/Decision/Insight records require evidence; AI-proposed Insights remain \`candidate\` until confirmed.
- Never print vault values or write before approval.
- Unknown nouns, subjects, actions, ids, or ambiguous approval must produce a deterministic explanation, never a guessed mutation.

Method: ${METHOD_VERSION}. Command grammar source: \`lib/commands/manifest.js\`.
`;
}

function renderCompatibilityPrompt(alias) {
  const spec = aliases[alias];
  if (!spec) throw new Error(`Unknown compatibility alias: ${alias}`);
  const target = `scrumrun ${spec.target.join(" ")}`;
  return `---
description: Deprecated ScrumRun v1 adapter — executes ${target}
argument-hint: [action] [args]
---

Compatibility adapter for \`/${alias}\`.

Execute this request now as \`${target} $ARGUMENTS\` using the installed \`scrumrun\` skill. Do not ask the user to re-enter the command and do not merely print a redirect.

Emit one concise deprecation note: \`/${alias}\` becomes \`${target}\` in ScrumRun 2.0. ${spec.note || ""}
`;
}

function renderCommandHelp() {
  const nounLines = Object.entries(nouns).map(([noun, spec]) => `  scrumrun ${noun.padEnd(10)} ${spec.description}`);
  const aliasLines = Object.entries(aliases).map(([alias, spec]) => `  /${alias.padEnd(14)} -> scrumrun ${spec.target.join(" ")}`);
  return `ScrumRun ${METHOD_VERSION} command grammar:

Canonical root:
  scrumrun <noun> <subject> <action> [args]

Client compatibility shortcut:
  /sc <noun> <subject> <action> [args]

Nouns:
${nounLines.join("\n")}

Compatibility adapters (upgrade only; not installed for fresh v2 users):
${aliasLines.join("\n")}`;
}

module.exports = { grammarLines, renderCommandHelp, renderCompatibilityPrompt, renderRootPrompt };
