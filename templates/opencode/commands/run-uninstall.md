---
description: Remove ScrumRun from the current project
argument-hint: optional --force|-f
---

Remove ScrumRun from the current project.

Default behavior is conservative: remove ScrumRun entries from `.git/info/exclude` and show what would be removed.

With `--force` (`-f`), remove `.scrumrun/` and remove `AGENTS.md` only if it is recognized as ScrumRun-generated.

Do not remove application code or unrelated project files.

Options: $ARGUMENTS
