---
description: Record fixes and browse the fix log for future reference
argument-hint: --add|-a "what broke", --list|-l, --show|-s <id>, --insight|-i <id>
---

Manage the fix log in `.scrumrun/fixes.md`: $ARGUMENTS

Each fix entry uses a stable id in the form `F-NNN` (for example `F-001`), assigned sequentially. The log tracks what went wrong and what was done — a corpus for detecting recurring problems.

If no action flag is present in `$ARGUMENTS`, list the actions below and stop.

Actions:

- `--add` (`-a`) `"description"`: register a new fix entry with the next `F-NNN` id, stamped with today's date. Describe what broke, what was done, and optionally reference the relevant sprint or `K-NNN` knowledge entry.
- `--list` (`-l`): list all entries, most recent first, showing the id, date, and the first line of the description. Do not modify files.
- `--show` (`-s`) `<id>`: show the full details of a single `F-NNN` entry. Do not modify files.
- `--insight` (`-i`) `<id>`: read this fix entry and the full fix log to detect recurring patterns. If repeated failures are found, create a pending knowledge proposal (or add an insight to an existing `K-NNN`) so the lesson becomes durable. Ask the user before creating any knowledge entry.

When `/sc-sprint --fix` creates a corrective child sprint, it automatically registers an entry in `.scrumrun/fixes.md` — no manual `--add` is needed for sprint-originated fixes.

Do not modify application code.
