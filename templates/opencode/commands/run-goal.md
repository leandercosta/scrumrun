---
description: Manage project goal lanes — new, show, list
argument-hint: --new|-n <goal>, --show|-s [focus], --list|-l [filter]
---

Manage the project goal lanes under `.scrumrun/goals/`: $ARGUMENTS

If no action flag is present in `$ARGUMENTS`, list the actions below and stop without guessing an action.

Actions:

- `--new` (`-n`) `<goal>`: plan or replace the main project goal in `.scrumrun/goals/main/sprint.md`. Read `AGENTS.md`, `.scrumrun/golden-rules.md`, `.scrumrun/config.md`, `.scrumrun/map.md`, `.scrumrun/project.md`, `.scrumrun/knowledge.md`, `.scrumrun/agents.md`, and `.scrumrun/goals/main/history.md`. Use only `Approved Knowledge` as planning truth. If `.scrumrun/config.md` says `Sprint Automation: backlog` or `bypass`, treat suggested sprints as backlog candidates and do not generate, modify, or run sprint plans automatically unless the user explicitly requests `/run-sprint --new` or `/run-backlog --add`. Ask all blocking architecture and stack questions before writing the plan, then update `.scrumrun/project.md`, `.scrumrun/goals/main/sprint.md`, and `.scrumrun/goals/main/decisions.md` as needed.
- `--show` (`-s`) `[focus]`: read `.scrumrun/project.md`, `.scrumrun/goals/main/sprint.md`, `.scrumrun/goals/main/history.md`, and `.scrumrun/goals/main/decisions.md`, and show the main goal status, next sprint, blockers, and open decisions. Do not modify files.
- `--list` (`-l`) `[filter]`: list goal lanes under `.scrumrun/goals/`, including each lane's sprint and history status. The default lane is `main`. Do not modify files.
