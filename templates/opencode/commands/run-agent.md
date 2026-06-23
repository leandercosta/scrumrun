---
description: Manage review agents — add, list, run
argument-hint: --add|-a, --list|-l, --run|-r <sprint>
---

Manage review agents in `.scrumrun/agents.md`: $ARGUMENTS

If no action flag is present in `$ARGUMENTS`, list the actions below and stop without guessing an action.

Actions:

- `--add` (`-a`): create a new review agent in `.scrumrun/agents.md` by asking role, checks, run order, and optional technology focus first.
- `--list` (`-l`): list all agents from `.scrumrun/agents.md` and explain their roles and checkpoints. Do not modify files.
- `--run` (`-r`) `<sprint>`: run review agents from `.scrumrun/agents.md` against the requested sprint — all agents or a specific numbered one — and update the relevant history file with the results.
