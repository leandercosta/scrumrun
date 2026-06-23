# Main Goal Sprint Plan - {{PROJECT_NAME}}

Created: {{DATE}}

## Global Rules

- Execute one sprint at a time.
- Read `.scrumrun/golden-rules.md`, `.scrumrun/config.md`, and `.scrumrun/map.md` before executing any sprint.
- Check `.scrumrun/goals/main/history.md` before executing any main-goal sprint.
- If the sprint is already `completed`, ask whether to audit, rerun/fix, or continue.
- If the sprint is `partial` or `blocked`, ask whether to resume, audit, or move on.
- Follow: Entenda -> Avalie Impactos -> Tire Duvidas -> Execute -> Teste.
- Never commit real secrets.
- Use env/config for runtime-specific values.
- Update `.scrumrun/goals/main/history.md` at the end of every main-goal sprint.

## Sprint 00 - Governance and Planning

**Goal:** The project has clear rules, boundaries, and a step-by-step plan. Everyone knows what to build and in which order.

**Scope:**

- Confirm project goal.
- Confirm stack.
- Confirm whether there is a read-only source project.
- Confirm env/secrets policy.
- Create or refine sprint list.
- Create initial history handoff.

**Acceptance:**

- The project has `AGENTS.md` and the `.scrumrun/` control files.
- The next sprint is clear.
- No application code is created unless explicitly requested.

## Sprint 01 - Project Foundation

**Goal:** Anyone can open this project and run it locally with a single command. The foundation is ready for the first real feature.

**Scope:**

- Define project setup.
- Add minimal toolchain.
- Add smoke verification.
- Document commands.

**Acceptance:**

- The project can be bootstrapped or verified locally.
- `.scrumrun/goals/main/history.md` records commands and results.

## Add More Sprints

Use `/scr-goal --new` for the main project direction, `/scr-feature --new` for isolated feature lanes, or `/scr-sprint --new` for one additional main-goal sprint.
