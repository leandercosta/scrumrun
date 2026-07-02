---
description: Manage the token-safe ScrumRun context snapshot
argument-hint: --build|-b, --update|-u, --show|-s, --clear|-c, --policy|-p
---

Manage ScrumRun context economy for the current project: $ARGUMENTS

If no action flag is present in `$ARGUMENTS`, list the actions below and stop without guessing an action.

Actions:

- `--build` (`-b`): create or fully refresh `.scrumrun/context.md` from canonical ScrumRun files and targeted source inspection. Read `golden-rules.md`, `config.md`, `token-policy.md`, `map.md`, `project.md`, `knowledge.md`, `runbook.md`, active sprint/feature files, relevant history, and decisions. Do not treat the old snapshot as truth.
- `--update` (`-u`) `[reason]`: update only the sections affected by recent work, such as current focus, decisions, risks, map pointers, and staleness triggers. Use after study, challenge, sprint creation, sprint execution, review, or knowledge changes.
- `--show` (`-s`): show `.scrumrun/context.md` as a concise snapshot. Do not modify files.
- `--clear` (`-c`): reset `.scrumrun/context.md` to a safe placeholder that says it is stale and must be rebuilt. Do not delete canonical project files.
- `--policy` (`-p`): show `.scrumrun/token-policy.md` and explain how token economy applies to the current task. Do not modify files.

Rules:

1. `context.md` is a token-saving snapshot, not canonical truth.
2. Never let `context.md` override golden rules, approved knowledge, sprint history, decisions, or source code.
3. Never include `.scrumrun/vault.local.md` values.
4. Prefer short bullets, file references, and "must read" pointers over long pasted content.
5. If a snapshot is stale or unverifiable, mark it stale and ask whether to rebuild.
