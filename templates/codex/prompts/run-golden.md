---
description: Manage golden rules — absolute priority, never violated
argument-hint: --add|-a <rule>, --list|-l, --remove|-r <number>
---

Manage golden rules in `.scrumrun/golden-rules.md`; they have absolute priority and are never violated: $ARGUMENTS

If no action flag is present in `$ARGUMENTS`, list the actions below and stop without guessing an action.

Actions:

- `--add` (`-a`) `<rule>`: append a new numbered golden rule to `.scrumrun/golden-rules.md` (create the file if missing) and show the updated list.
- `--list` (`-l`): read and list the golden rules. Do not modify files.
- `--remove` (`-r`) `<number>`: remove rule N from `.scrumrun/golden-rules.md` and show the updated list.
