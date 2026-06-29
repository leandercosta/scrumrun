# ScrumRun Core

ScrumRun is a portable workflow for using AI agents on software projects without relying on a specific AI client.

Slash commands are optional shortcuts. If the current AI client does not support ScrumRun commands, read this file and execute the matching workflow manually.

After ScrumRun is initialized in a project, this file is mandatory project methodology. Any AI agent working in the project must follow it before planning, changing, auditing, or reviewing work.

## Operating Rule

Before planning, changing, auditing, or reviewing work, read these files when they exist:

1. `.scrumrun/core.md`
2. `.scrumrun/golden-rules.md`
3. `.scrumrun/config.md`
4. `.scrumrun/map.md`
5. `.scrumrun/project.md`
6. `.scrumrun/knowledge.md`
7. `.scrumrun/backlog.md`
8. `.scrumrun/runbook.md`
9. `.scrumrun/agents.md`
10. `.scrumrun/goals/main/sprint.md`
11. `.scrumrun/goals/main/history.md`
12. `.scrumrun/goals/main/decisions.md`

Golden rules have the highest priority. If a golden rule conflicts with any other instruction, the golden rule wins.

Only approved knowledge is planning truth. Pending knowledge is unverified context. Rejected knowledge must not be used except to avoid repeating a known bad assumption.

If the current AI client does not support slash commands, do not invent a different workflow. Use the command equivalents in this file.

If this file was loaded from `AGENTS.md`, treat it as the active project methodology.

If the user asks for work without mentioning ScrumRun, still follow ScrumRun because the project was initialized with it.

## Project Layout

```text
AGENTS.md
.scrumrun/
  core.md
  config.md
  golden-rules.md
  map.md
  agents.md
  runbook.md
  project.md
  backlog.md
  knowledge.md
  vault.local.md
  goals/
    main/
      sprint.md
      history.md
      decisions.md
  features/
    <feature>/
      feature.md
      sprint.md
      history.md
      decisions.md
  reviews/
```

## Safety Rules

- Do not start implementation unless the owner explicitly asks for it.
- Never modify read-only source paths.
- Never commit real secrets.
- Never print `.scrumrun/vault.local.md` values in normal summaries, history, knowledge, backlog, reviews, commits, or logs.
- Runtime values must come from environment/config, not hardcoded strings.
- Keep main goal history and feature lane history separate.
- Before running a sprint, check the relevant history file.
- If a sprint is completed, partial, or blocked, stop and ask whether to audit, resume, fix, rerun, or move on.

## Sprint Protocol

Every sprint follows:

1. Entenda
2. Avalie Impactos
3. Tire Duvidas
4. Execute
5. Teste

Do not skip the first three steps. They are what prevent confident but unsafe execution.

## Command Equivalents

Use these workflows even when slash commands are unavailable.

### `/run-help`

Explain ScrumRun commands and workflows. Read `.scrumrun/config.md` first to honor the response language. Do not modify files.

### `/run-init`

Initialize ScrumRun. In CLI form, run:

```bash
npx github:leandercosta/scrumrun init
```

Default init is local: it creates `AGENTS.md` and `.scrumrun/`, then adds them to `.git/info/exclude` when Git is present. This keeps ScrumRun out of commits unless the owner chooses `--shared`.

### `/run-study`

Perform a deep, read-only project study.

Inspect:

- product purpose and stack;
- package managers, frameworks, runtime versions, and local commands;
- architecture, entry points, routing, controllers, services, jobs, and modules;
- auth, authorization, roles, permissions, policies, guards, and access boundaries;
- data model, migrations, seeds, storage, queues, caches, and external state;
- env/config, secret handling, integrations, webhooks, and provider boundaries;
- deployment, infrastructure, CI, test strategy, and observability clues;
- golden rules, approved knowledge, backlog, current sprint plan, history, and decisions;
- security risks, performance hotspots, brittle areas, unknowns, and next backlog candidates.

Return evidence with file references. If something cannot be verified, say it is unknown and explain what evidence is missing. Do not modify files. Recommend sprint candidates as backlog candidates unless the user explicitly asks to create or run a sprint.

### `/run-know`

Investigate a specific topic and write a pending knowledge proposal in `.scrumrun/knowledge.md` using the next `K-NNN` id.

Each entry should include:

- title;
- user insight;
- verified facts with file references;
- assumptions and uncertainty;
- risks if wrong;
- affected modules;
- suggested future use.

With deep knowledge, also include key functions, symbols, entry points, call sites, and relevant types/storage.

Do not treat new or edited knowledge as approved. Ask the owner to approve or reject it.

### `/run-challenge`

Analyze a user challenge after study and recommend the safest path.

Read project files, approved knowledge, backlog, sprint plan, history, decisions, feature lanes, and relevant source code. History reading is mandatory when history exists.

Return:

- challenge understanding;
- approved knowledge used;
- evidence with file references;
- history findings;
- impact analysis;
- risks and unknowns;
- options;
- recommendation;
- suggested next command or manual workflow.

Valid recommendations include creating a small sprint, adding to backlog, creating a feature lane, running discovery first, or rejecting/defering the request.

Do not create backlog items, sprints, feature lanes, code changes, commits, tests, or history entries unless the user explicitly asks.

### `/run-goal`

Manage the main project goal in `.scrumrun/goals/main/`.

When creating or changing the goal, read project rules, map, approved knowledge, review agents, main history, and decisions. Detect the stack first, ask blocking architecture questions, then update `.scrumrun/project.md`, `.scrumrun/goals/main/sprint.md`, and `.scrumrun/goals/main/decisions.md`.

Do not implement code.

### `/run-feature`

Create or manage isolated feature lanes under `.scrumrun/features/<slug>/`.

Feature lanes must have separate `feature.md`, `sprint.md`, `history.md`, and `decisions.md`. They must respect project rules and approved knowledge but must not pollute main goal history.

### `/run-sprint`

Manage or run main-goal sprints.

For a new sprint, add it to `.scrumrun/goals/main/sprint.md` with goal, scope, acceptance criteria, dependencies, suggested verification, and review checkpoints.

For sprint execution:

1. Read `AGENTS.md`, core, golden rules, config, map, knowledge, runbook, agents, sprint plan, history, and decisions.
2. Use only approved knowledge.
3. Check whether the sprint is completed, partial, or blocked.
4. Follow Entenda -> Avalie Impactos -> Tire Duvidas -> Execute -> Teste.
5. Run configured review agents.
6. Fix findings before marking complete.
7. Update main history and decisions.

If the owner asks to send a sprint to backlog, add it to `.scrumrun/backlog.md` and stop without executing.

### `/run-backlog`

Manage `.scrumrun/backlog.md`.

Backlog items are candidates, not active work. Adding to backlog must not change sprint status, run tests, execute agents, or modify application code.

### `/run-agent`

Manage review agents in `.scrumrun/agents.md` or run them against a sprint. Agent findings should be recorded in the relevant history file.

### `/run-review`

Run a code review. Findings must be ordered by severity and include file/line references. Do not modify code unless explicitly asked.

### `/run-config`

Manage `.scrumrun/config.md`, including response language and sprint automation preferences.

### `/run-golden`

Manage `.scrumrun/golden-rules.md`. Golden rules are absolute and must be checked before every planning or execution workflow.

### `/run-map`

Build or view `.scrumrun/map.md`. The map is a navigation aid, not source of truth. Verify files before editing.

### `/run-decisions`

Resolve open decisions one at a time in the relevant decisions/history file.

### `/run-vault`

Manage `.scrumrun/vault.local.md`, a plaintext local development vault.

This file is for development-only credentials and local test values. It is not encrypted and is not a production secret manager. Values must never be committed or copied into normal ScrumRun records.

## Manual Usage Without Installation

If commands are unavailable, ask the agent to do this:

```text
Read .scrumrun/core.md and follow ScrumRun.
I want the equivalent of /run-study.
Do not modify files.
```

Or:

```text
Read .scrumrun/core.md and follow ScrumRun.
I want the equivalent of /run-challenge:
<challenge>
Show options and recommendation only. Do not execute.
```

Or:

```text
Read .scrumrun/core.md and follow ScrumRun.
Run the equivalent of /run-sprint --run Sprint 01.
Follow the sprint protocol and update history when done.
```

## Bootstrap Prompt

For AI clients that do not reliably read project instructions automatically, paste this at the start of the session:

```text
Read AGENTS.md and .scrumrun/core.md before doing anything else.
Follow ScrumRun exactly.
If slash commands are unavailable, execute the equivalent workflow from .scrumrun/core.md manually.
Do not plan, edit, run, or review work until you have applied the ScrumRun safety rules, project files, approved knowledge, sprint history, and decision history.
```
