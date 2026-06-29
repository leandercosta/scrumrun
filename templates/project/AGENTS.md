# AGENTS.md - {{PROJECT_NAME}}

## ScrumRun

This project uses ScrumRun.

ScrumRun is mandatory in this project. Slash commands are optional shortcuts; the methodology is not optional.

Before planning, executing, auditing, or reviewing work, read:

1. `.scrumrun/core.md` — portable ScrumRun method and command equivalents.
2. `.scrumrun/golden-rules.md` — **MANDATORY. Highest priority. Never violate.**
3. `.scrumrun/config.md` — response language and ScrumRun behavior preferences.
4. `.scrumrun/map.md` — project folders, paths, modules, and key files.
5. `.scrumrun/knowledge.md`
6. `.scrumrun/runbook.md`
7. `.scrumrun/project.md`
8. `.scrumrun/goals/main/sprint.md`
9. `.scrumrun/goals/main/history.md`
10. `.scrumrun/agents.md`

If the current AI client does not support `/run-*` slash commands, read `.scrumrun/core.md` and execute the matching ScrumRun workflow manually.

If the user asks for work without mentioning ScrumRun, still follow ScrumRun because this project was initialized with it.

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
