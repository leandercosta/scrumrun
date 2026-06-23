---
description: Run a ScrumRun review — full codebase or a single file range
argument-hint: --code|-c [focus], --file|-f <path:start_end>
---

Run a ScrumRun review: $ARGUMENTS

If no action flag is present in `$ARGUMENTS`, list the actions below and stop without guessing an action.

Actions:

- `--code` (`-c`) `[focus]`: review the full codebase and save a timestamped report under `.scrumrun/reviews/`. Order findings by severity with file and line references. Do not modify code unless explicitly requested.
- `--file` (`-f`) `<path:start_end>`: review the requested file range only, without changing code unless explicitly asked.
