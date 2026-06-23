---
description: Manage the project map — build, view
argument-hint: --build|-b, --view|-v
---

Manage the project map in `.scrumrun/map.md`: $ARGUMENTS

If no action flag is present in `$ARGUMENTS`, list the actions below and stop without guessing an action.

Actions:

- `--build` (`-b`): build or refresh `.scrumrun/map.md` with the project structure, important paths, modules, and key files. Do not include secrets.
- `--view` (`-v`): show a concise project structure view using `.scrumrun/map.md` and current folders without modifying files.
