# ScrumRun Context Snapshot - {{PROJECT_NAME}}

This file is a token-safe snapshot. It helps agents decide what to read next, but it is not a source of truth.

Canonical sources remain `golden-rules.md`, `config.md`, `project.md`, `knowledge.md`, `runbook.md`, sprint/feature plans, history, decisions, and source code.

Last updated: {{DATE}}
Updated by: init
Confidence: initial placeholder

## Current Focus

- Main goal: pending.
- Active sprint: pending.
- Active feature lane: none.
- Current challenge: none.

## Must Read For Current Work

- `AGENTS.md`
- `.scrumrun/core.md`
- `.scrumrun/golden-rules.md`
- `.scrumrun/config.md`
- `.scrumrun/token-policy.md`
- `.scrumrun/map.md`
- `.scrumrun/project.md`
- `.scrumrun/knowledge.md`
- `.scrumrun/runbook.md`

## Read Only If Needed

- Full historical reviews under `.scrumrun/reviews/`
- Full old sprint history unrelated to the current lane
- Large generated files, build outputs, dependency folders, and logs

## Current Decisions

- Pending: none.

## Current Risks

- Do not treat this snapshot as canonical truth.
- Do not use pending knowledge as approved planning truth.
- Never print or copy `.scrumrun/vault.local.md` values.

## Current Map Pointers

- Pending: run `/run-map --build` or `/run-context --build`.

## Staleness Triggers

Refresh this snapshot after:

- `/run-study`
- `/run-goal --new`
- `/run-feature --new`
- `/run-sprint --new`
- `/run-sprint --run`
- `/run-sprint --fix`
- `/run-review --code`
- major changes to `knowledge.md`, `project.md`, `map.md`, `history.md`, or `decisions.md`
