---
description: Manage isolated feature lanes — new, list, show, run, audit
argument-hint: --new|-n <description>, --list|-l, --show|-s <slug>, --run|-r <slug> <sprint>, --audit|-a <slug> <sprint>
---

Manage isolated feature lanes under `.scrumrun/features/`: $ARGUMENTS

If no action flag is present in `$ARGUMENTS`, list the actions below and stop without guessing an action.

Actions:

- `--new` (`-n`) `<description>`: create a new isolated feature lane under `.scrumrun/features/<slug>/`. Read `AGENTS.md`, `.scrumrun/golden-rules.md`, `.scrumrun/config.md`, `.scrumrun/map.md`, `.scrumrun/project.md`, `.scrumrun/agents.md`, and `.scrumrun/goals/main/history.md`. Do not modify `.scrumrun/goals/main/sprint.md` or `.scrumrun/goals/main/history.md`. Create `feature.md`, `sprint.md`, `history.md`, and `decisions.md`. The brief must include name, reason, scope, out of scope, dependencies, risks, and assumptions; the sprint plan must be modular, auditable, and independently executable.
- `--list` (`-l`) `[filter]`: list feature lanes under `.scrumrun/features/`, summarizing each brief, sprint status, open decisions, and next recommended sprint. Do not modify files.
- `--show` (`-s`) `<slug>`: read the requested lane and show its `feature.md`, `sprint.md`, `history.md`, and `decisions.md` in a concise status view. Do not modify files.
- `--run` (`-r`) `<slug> <sprint>`: run one sprint from a feature lane. Read `AGENTS.md`, `.scrumrun/golden-rules.md`, `.scrumrun/config.md`, `.scrumrun/map.md`, `.scrumrun/runbook.md`, `.scrumrun/agents.md`, and the lane's four files. Check feature history first; if the sprint is completed, partial, or blocked, stop and ask how to proceed. Otherwise follow Entenda -> Avalie Impactos -> Tire Duvidas -> Execute -> Teste, run review agents, and update the feature lane history only.
- `--audit` (`-a`) `<slug> <sprint>`: read the lane's four files plus `AGENTS.md`, `.scrumrun/golden-rules.md`, `.scrumrun/config.md`, `.scrumrun/map.md`, and `.scrumrun/agents.md`. Review changed files from current state, verify acceptance criteria, tests, env/config handling, and safety rules. Report findings ordered by severity. Do not modify application code unless explicitly requested.
