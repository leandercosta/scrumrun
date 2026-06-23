# AGENTS.md - {{PROJECT_NAME}}

## ScrumRun

This project uses ScrumRun.

Before planning, executing, auditing, or reviewing work, read:

1. `.scrumrun/golden-rules.md` — **MANDATORY. Highest priority. Never violate.**
2. `.scrumrun/config.md` — response language and ScrumRun behavior preferences.
3. `.scrumrun/map.md` — project folders, paths, modules, and key files.
4. `.scrumrun/runbook.md`
5. `.scrumrun/project.md`
6. `.scrumrun/goals/main/sprint.md`
7. `.scrumrun/goals/main/history.md`
8. `.scrumrun/agents.md`

## Absolute Safety Rules

- Do not start a sprint unless the owner explicitly asks for that sprint.
- Before executing any main-goal sprint, check `.scrumrun/goals/main/history.md`.
- Before executing any feature sprint, check that feature lane's `history.md`.
- If a sprint is `completed`, ask whether to audit, rerun/fix, or continue to the next sprint.
- If a sprint is `partial` or `blocked`, ask whether to resume, audit, or move to another sprint.
- Never commit real secrets.
- Runtime-specific values must come from env/config, not hardcoded strings.
- If a project has a read-only source path, never modify it.
- Keep main goal history and feature lane history separate.

## Sprint Protocol

Every sprint must follow:

1. Entenda
2. Avalie Impactos
3. Tire Duvidas
4. Execute
5. Teste

## Handoff

At the end of each sprint, update the relevant history file with status, files changed, commands run, tests, decisions, env variable names, risks, and follow-ups.
