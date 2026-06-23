---
description: Manage ScrumRun preferences — show, set language
argument-hint: --show|-s, --lang|-l <language>
---

Manage ScrumRun preferences in `.scrumrun/config.md`: $ARGUMENTS

If no action flag is present in `$ARGUMENTS`, list the actions below and stop without guessing an action.

Actions:

- `--show` (`-s`): show or update `.scrumrun/config.md` preferences, including `Language` and `Sprint Automation` (valid values include `backlog` and legacy `bypass`).
- `--lang` (`-l`) `<language>`: set the response language for all ScrumRun commands in `.scrumrun/config.md`. Preserve unrelated preferences.
