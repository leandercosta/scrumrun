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

If \`$ARGUMENTS\` is empty, show the five nouns below and the current project status; do not guess an action. Otherwise parse exactly \`/sc <noun> <subject> <action> [args]\`.

## Grammar

${grammarLines().join("\n")}

## Execution contract

- Natural-language product work enters through \`plan intake\` automatically.
- Intake, contextualization, policy, risk, classification, and planning are read-only until explicit approval.
- Approved work creates/updates a Task and creates a Run; a Sprint only groups Tasks when a real timebox/batch exists.
- Run execution follows \`executing → validating → learning → completed|failed|blocked\`.
- Run owns one structured, evidenced event ledger; Task synchronizes current status without copying Run history.
- \`guardrails.md\` is canonical project policy; \`golden-rules.md\` is v1 compatibility only.
- Knowledge/Decision/Insight records require evidence; AI-proposed Insights remain \`candidate\` until confirmed.
- Never print vault values or write before approval.
- Unknown nouns, subjects, actions, ids, or ambiguous approval must produce a deterministic explanation, never a guessed mutation.

Method: ${METHOD_VERSION}. Command grammar source: \`lib/commands/manifest.js\`.
`;
}

function renderCompatibilityPrompt(alias) {
  const spec = aliases[alias];
  if (!spec) throw new Error(`Unknown compatibility alias: ${alias}`);
  const target = `/sc ${spec.target.join(" ")}`;
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
  const nounLines = Object.entries(nouns).map(([noun, spec]) => `  /sc ${noun.padEnd(10)} ${spec.description}`);
  const aliasLines = Object.entries(aliases).map(([alias, spec]) => `  /${alias.padEnd(14)} -> /sc ${spec.target.join(" ")}`);
  return `ScrumRun ${METHOD_VERSION} command grammar:

Canonical root:
  /sc <noun> <subject> <action> [args]

Nouns:
${nounLines.join("\n")}

Compatibility adapters (upgrade only; not installed for fresh v2 users):
${aliasLines.join("\n")}`;
}

module.exports = { grammarLines, renderCommandHelp, renderCompatibilityPrompt, renderRootPrompt };
