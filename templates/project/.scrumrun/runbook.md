# ScrumRun Runbook

## Purpose

This runbook lets an AI agent execute one sprint independently and safely.

## Required Start Sequence

1. Read `AGENTS.md`.
2. Read `.scrumrun/golden-rules.md`.
3. Read `.scrumrun/config.md`.
4. Read `.scrumrun/map.md`.
5. Read `.scrumrun/runbook.md`.
6. Read the relevant sprint plan:
   - main goal: `.scrumrun/goals/main/sprint.md`
   - feature lane: `.scrumrun/features/<feature>/sprint.md`
7. Read the relevant history file.
8. Check whether the requested sprint already has `Status: completed.`, `Status: partial.`, or `Status: blocked.`.
9. If it already ran, ask whether to audit, rerun/fix, resume, or continue to another sprint.
10. Identify dependencies, impacted files, env/config impact, database impact, and test plan.
11. Only then implement.

## Sprint Analysis Template

```text
Sprint:
Lane: main goal | feature <slug>
History status:
Goal:
Relevant docs/specs:
Source areas to audit:
External docs needed:
Expected files:
Env/config impact:
Database impact:
Test plan:
Open questions:
```

## Execution Protocol

1. Entenda
2. Avalie Impactos
3. Tire Duvidas
4. Execute
5. Teste

## Safety Rules

- Never modify read-only source paths.
- Never commit real secrets.
- Use env/config for runtime values.
- Ask before changing behavior that is ambiguous or production-sensitive.
- Use mocks/fakes for external providers in automated tests.
- Keep main goal and feature lane histories separate.

## History Update Template

```md
### YYYY-MM-DD - Sprint NN: Name

Status: completed|partial|blocked

Summary:
- ...

Files changed:
- ...

Commands run:
- ...

Tests/verification:
- ...

Env/config:
- Added variable names only, no values: ...

Decisions:
- ...

Risks/follow-ups:
- ...
```
