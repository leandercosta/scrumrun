---
description: Manage ScrumRun language, intake, approval, and quick-task preferences
argument-hint: --show|-s, --lang|-l <language>, --interaction <mode>, --approval <policy>, --quick-tasks <policy>
---

Manage ScrumRun preferences in `.scrumrun/config.md`: $ARGUMENTS

If no action flag is present in `$ARGUMENTS`, list the actions below and stop without guessing an action.

Actions:

- `--show` (`-s`): show `.scrumrun/config.md`, including language, intake, approval, quick-task, and sprint automation preferences. Do not modify files.
- `--lang` (`-l`) `<language>`: set the response language for all ScrumRun commands in `.scrumrun/config.md`. Preserve unrelated preferences.
- `--interaction` (`-i`) `<guided|concise|autonomous-planning|strict>`: set how natural-language intake responds. `strict` disables automatic intake.
- `--approval` (`-a`) `<always|implementation-only>`: `always` requires approval before planning records or code changes; `implementation-only` allows the recommended planning record after intake but still requires approval before application changes.
- `--quick-tasks` (`-q`) `<ask|allow|backlog>`: ask before a quick task, allow clearly scoped low-risk quick tasks after classification, or park them in backlog.

Reject unknown values. Preserve every unrelated preference and never weaken golden rules or sprint history checks.
