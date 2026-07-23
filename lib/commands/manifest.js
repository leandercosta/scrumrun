"use strict";

const { METHOD_VERSION } = require("../v2/schema");

const nouns = Object.freeze({
  plan: {
    description: "turn intent into Features, Tasks, Sprints, and Runs",
    subjects: {
      task: ["--add [--type fix] [--status backlog]", "--list", "--show", "--run", "--audit", "--cancel", "--retry"],
      sprint: ["--add", "--list", "--show", "--start", "--complete", "--block"],
      feature: ["--add", "--list", "--show", "--activate", "--complete"],
      run: [
        "--list",
        "--show",
        "--render <RUN-NNN>",
        "--stats [--task <TASK-NNN>] [--feature <FEAT-NNN>] [--sprint <SPRINT-NNN>] [--json]",
        "--authorize-mutation <RUN-NNN> --path <relative-path>",
        "--record-mutation <RUN-NNN> --permit <MUT-id> [--note] [--actor]",
        "--satisfy-guardrail <RUN-NNN> --guardrail <GR-NNN> [--note] [--evidence] [--review] [--migration] [--actor]",
        "--validate [--note] [--evidence] [--command] [--test] [--file] [--review] [--actor] [--at]",
        "--learn [--note] [--evidence] [--decision] [--insight] [--file] [--actor] [--at]",
        "--complete [--note] [--evidence] [--review] [--test] [--file] [--actor] [--at]",
        "--resume [--note] [--evidence] [--risk] [--actor] [--at]",
        "--fail [--note] [--evidence] [--risk] [--test] [--actor] [--at]",
        "--block [--note] [--evidence] [--risk] [--actor] [--at]"
      ],
      intake: ["<request>", "--request", "--approve"],
      challenge: ["<question>"]
    }
  },
  knowledge: {
    description: "manage evidence-backed project memory and bounded context",
    subjects: {
      fact: ["--add [--title] [--content] [--evidence] [--relation] [--subject] [--source] [--source-id] [--valid-from] [--valid-until] [--review-trigger]", "--list [--include-inactive]", "--show", "--approve [--evidence] [--note]", "--reject [--note]", "--deprecate [--note]", "--invalidate [--note]"],
      decision: ["--add [--title] [--content] [--evidence] [--relation] [--subject] [--source] [--source-id] [--valid-from] [--valid-until] [--review-trigger]", "--list [--include-inactive]", "--show", "--resolve [--evidence] [--note]", "--deprecate [--note]", "--invalidate [--note]"],
      insight: ["--propose [--title] [--content] [--evidence] [--relation] [--subject] [--source] [--source-id] [--confidence] [--valid-from] [--valid-until] [--review-trigger]", "--list [--include-inactive]", "--show", "--confirm [--evidence] [--note]", "--stale [--note]", "--reject [--note]", "--deprecate [--note]", "--invalidate [--note]"],
      dossier: ["--add [--title] [--content] [--evidence] [--relation] [--subject] [--source] [--source-id] [--valid-from] [--valid-until] [--review-trigger]", "--list [--include-inactive]", "--show", "--refresh [--evidence] [--note]", "--stale [--note]", "--deprecate [--note]", "--archive [--note]"],
      context: ["--build", "--update", "--show", "--clear"],
      map: ["--build", "--show"],
      study: ["<focus>"],
      vault: ["--add", "--list", "--show", "--remove", "--path"]
    }
  },
  rules: {
    description: "manage mandatory project guardrails and reviewers",
    subjects: {
      guardrail: ["--add", "--list", "--show", "--retire"],
      reviewer: ["--add", "--list", "--show", "--run"]
    }
  },
  review: {
    description: "run scoped evidence-based quality gates",
    subjects: {
      code: ["--run"],
      artifact: ["--run", "--record --task <TASK-NNN> [--run <RUN-NNN>] [--title] [--evidence]"],
      migration: ["--run"],
      release: ["--run"]
    }
  },
  config: {
    description: "manage project preferences, lifecycle, migration, and help",
    subjects: {
      project: ["--show", "--language", "--interaction", "--approval", "--quick-tasks"],
      init: ["--local", "--shared", "--lean", "--no-agent-hint", "--force"],
      update: ["all [--migrate]", "codex [--migrate]", "opencode [--migrate]", "claude [--migrate]"],
      migrate: ["--to 2 --dry-run", "--to 2 --apply", "--to 2 --rollback"],
      doctor: ["all [--strict] [--recover] [--dry-run]", "codex [--strict] [--recover] [--dry-run]", "opencode [--strict] [--recover] [--dry-run]", "claude [--strict] [--recover] [--dry-run]"],
      uninstall: ["--force"],
      help: ["<topic>"]
    }
  }
});

const aliases = Object.freeze({
  "sc-sprint": { target: ["plan", "sprint"] },
  "sc-fix": { target: ["plan", "task"], note: "Treat the Task as type fix." },
  "sc-feature": { target: ["plan", "feature"] },
  "sc-backlog": { target: ["plan", "task"], note: "Treat the Task status as backlog." },
  "sc-goal": { target: ["plan", "feature"], note: "Treat this as the main project initiative." },
  "sc-decisions": { target: ["knowledge", "decision"] },
  "sc-intake": { target: ["plan", "intake"] },
  "sc-challenge": { target: ["plan", "challenge"] },
  "sc-know": { target: ["knowledge", "fact"] },
  "sc-vault": { target: ["knowledge", "vault"] },
  "sc-context": { target: ["knowledge", "context"] },
  "sc-map": { target: ["knowledge", "map"] },
  "sc-study": { target: ["knowledge", "study"] },
  "sc-golden": { target: ["rules", "guardrail"] },
  "sc-agent": { target: ["rules", "reviewer"] },
  "sc-review": { target: ["review", "code"] },
  "sc-config": { target: ["config", "project"] },
  "sc-help": { target: ["config", "help"] },
  "sc-init": { target: ["config", "init"] },
  "sc-uninstall": { target: ["config", "uninstall"] },
  "sc-update": { target: ["config", "update"] }
});

function resolveRoute(parts) {
  const [noun, subject, ...args] = parts;
  if (!noun) return { type: "help", level: "root" };
  const nounSpec = nouns[noun];
  if (!nounSpec) return { type: "error", message: `Unknown ScrumRun noun: ${noun}` };
  if (!subject) return { type: "help", level: "noun", noun, spec: nounSpec };
  if (!nounSpec.subjects[subject]) return { type: "error", message: `Unknown ${noun} subject: ${subject}` };
  const actions = nounSpec.subjects[subject];
  if (!args.length) return { type: "help", level: "subject", noun, subject, actions };
  const acceptsNaturalLanguage = actions.some((action) => action.startsWith("<"));
  if (acceptsNaturalLanguage && !args[0].startsWith("-")) return { type: "route", noun, subject, args, actions };
  const declaredFlags = [...new Set(actions.flatMap((action) => action.match(/--[a-z0-9-]+/g) || []))];
  const unknownFlag = args.find((arg) => arg.startsWith("-") && declaredFlags.length && !declaredFlags.includes(arg));
  if (unknownFlag) {
    return { type: "error", message: `Unknown ${noun} ${subject} action: ${unknownFlag}` };
  }
  return { type: "route", noun, subject, args, actions };
}

function resolveAlias(alias, args = []) {
  const spec = aliases[alias];
  if (!spec) return null;
  return { alias, noun: spec.target[0], subject: spec.target[1], args, note: spec.note || null };
}

module.exports = { METHOD_VERSION, aliases, nouns, resolveAlias, resolveRoute };
