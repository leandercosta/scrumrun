---
description: Manage the sprint backlog — add, list
argument-hint: --add|-a <sprint number or name>, --list|-l [filter]
---

Manage the sprint backlog in `.scrumrun/backlog.md`: $ARGUMENTS

If no action flag is present in `$ARGUMENTS`, list the actions below and stop without guessing an action.

Actions:

- `--add` (`-a`) `<sprint number or name>`: add the requested sprint candidate to `.scrumrun/backlog.md` without executing code or updating sprint history. Read `.scrumrun/golden-rules.md`, `.scrumrun/config.md`, `.scrumrun/goals/main/sprint.md`, `.scrumrun/goals/main/history.md`, and `.scrumrun/backlog.md` if present. Treat the sprint as a candidate, not active work. If it exists in the sprint plan, copy its title or focus; if not, add the label as a manual candidate with details pending. Do not run implementation, agents, tests, or audits; do not change sprint status; if it already exists, report instead of duplicating.
- `--list` (`-l`) `[filter]`: read `.scrumrun/backlog.md`, `.scrumrun/goals/main/sprint.md`, and `.scrumrun/goals/main/history.md`, then list backlog candidates showing the backlog item, the matching sprint title or focus when discoverable, whether history marks it completed, partial, or blocked, and the exact command to run it, such as `/sc-sprint --run Sprint 01`. Do not modify files.
