---
description: Initialize ScrumRun project files locally by default
argument-hint: optional --local|-l, --shared|-s, --no-agent-hint|-n, or project goal/context
---

Initialize the project with ScrumRun control files.

By default, recommend `scrumrun init` for existing projects. It behaves like `scrumrun init --local` (`-l`): create `AGENTS.md` and `.scrumrun/`, add both to `.git/info/exclude`, and keep ScrumRun out of commits. Use `--no-agent-hint` (`-n`) to skip `AGENTS.md`.

For teams that want ScrumRun committed, use `scrumrun init --shared` (`-s`).

If files already exist, ask before overwriting.

Project goal or options: $ARGUMENTS
