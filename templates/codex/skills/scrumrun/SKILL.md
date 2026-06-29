---
name: scrumrun
description: Use when initializing ScrumRun projects, planning main goals or isolated features, running or auditing sprints, checking status, resolving decisions, managing golden rules/config/map/review agents, or performing code reviews.
---

# ScrumRun Method

Use this skill for ScrumRun commands and workflows.

ScrumRun separates project rules, the main goal, and isolated feature lanes. A feature lane is isolated from the main goal history, but it still respects project rules, architecture, map, review agents, and safety requirements.

## Command Shape

Commands are consolidated by noun; the action is a flag. A bare base command (no flag) lists the available actions for that group and stops without guessing. Every long flag has a short alias.

```text
/run-sprint --run Sprint 01        (long flag)
/run-sprint -r Sprint 01           (short alias)
/run-sprint                        (no flag -> list this group's actions)
```

## File Layout

Preferred v2 layout:

```text
AGENTS.md
.scrumrun/
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

## Priority Rules

1. Read `.scrumrun/golden-rules.md` before all ScrumRun planning, execution, auditing, and review work.
2. Golden rules are absolute. If a golden rule conflicts with any other instruction, the golden rule wins.
3. Read `.scrumrun/config.md` after golden rules and apply project preferences, especially response language.
4. Read `.scrumrun/map.md` before broad discovery work, repeated searches, or architecture questions.
5. Read `AGENTS.md` and `.scrumrun/runbook.md` before executing or auditing sprints.
6. Read `.scrumrun/knowledge.md` before challenge intake, sprint creation, sprint execution, and feature planning. Only `Approved Knowledge` is planning truth.
7. Keep main goal history and feature lane history separate.

If `.scrumrun/golden-rules.md` does not exist, remind the user they can initialize ScrumRun with `/run-init` or add rules with `/run-golden --add`.

If `.scrumrun/config.md` does not exist, default to English and remind the user they can set language with `/run-config --lang`.

If `.scrumrun/map.md` does not exist or appears stale, say so and suggest `/run-map --build`.

## Core Sprint Protocol

Every sprint follows:

1. Entenda
2. Avalie Impactos
3. Tire Duvidas
4. Execute
5. Teste

## Safety Rules

- Never modify read-only source paths.
- Never commit real secrets.
- Never copy `.scrumrun/vault.local.md` values into committed files, sprint history, reviews, knowledge, backlog, or normal summaries.
- Runtime values must come from env/config.
- External providers require current official docs before implementation.
- Keep work scoped to one requested sprint.
- Update the relevant history file at the end of a sprint.

## `/run-init`

Initialize ScrumRun in the current project.

Modes:

- default / `--local` (`-l`): recommended for existing projects. Create `AGENTS.md` and `.scrumrun/`, add both to `.git/info/exclude`, and keep ScrumRun out of commits.
- `--shared` (`-s`): recommended for teams that want ScrumRun files committed. Create `.scrumrun/` and `AGENTS.md` as versionable project files.
- `--no-agent-hint` (`-n`): with `--local`, skip `AGENTS.md` and create only `.scrumrun/`.

Rules:

1. Inspect the current directory.
2. For mature or existing projects, recommend `scrumrun init` or `scrumrun init --local`.
3. If `AGENTS.md` or `.scrumrun/` files already exist, do not overwrite silently. Ask whether to merge, preserve, or replace unless `--force` was explicitly used at the CLI level.
4. Create or update the `.scrumrun/` control files.
5. Ask whether there is a read-only source project that must never be touched.
6. Ask for stack, project goal, and first implementation priority if not discoverable.
7. Do not create application code unless explicitly requested.

## `/run-uninstall`

Remove ScrumRun from the current project.

Default behavior is conservative:

- remove `.scrumrun/` and `AGENTS.md` entries from `.git/info/exclude`;
- show what would be removed;
- do not delete project files.

With `--force` (`-f`):

- remove `.scrumrun/`;
- remove `AGENTS.md` only if it is recognized as ScrumRun-generated;
- never remove application code or unrelated project files.

## `/run-study`

Read ScrumRun control files and inspect the repository deeply enough to produce a complete operational understanding. This command is expected to be used repeatedly in legacy projects and must be robust.

Include:

- project purpose and stack;
- frameworks, package managers, runtime versions, and local commands;
- architecture, entry points, routing, controllers, services, jobs, and important modules;
- auth, authorization, roles, permissions, policies, guards, and access boundaries;
- data model, migrations, seeds, storage, queues, caches, and external state;
- env/config requirements, secret handling, third-party integrations, and webhooks;
- deployment/infrastructure clues, CI, test strategy, and observability;
- golden rules;
- main goal status;
- feature lanes;
- sprint backlog candidates;
- approved knowledge, pending knowledge proposals, and rejected assumptions;
- review agents;
- open decisions and risks;
- legacy risks, security concerns, performance hotspots, brittle areas, unknowns, and next backlog candidates.

Prefer precise file references over generic statements. If an area cannot be verified from the repo, say it is unknown and explain what evidence is missing. Do not modify files. When recommending sprints, present them as backlog candidates unless the user explicitly asks to create or run a sprint.

## `/run-help`

Show ScrumRun commands grouped by workflow.

If a command or topic is provided, focus on that topic and include examples. Read `.scrumrun/config.md` if it exists to honor the response language. Do not modify files.

## `/run-vault`

Manage `.scrumrun/vault.local.md`, a plaintext local development vault for dev-only credentials and test values.

This is not encrypted storage and must never be treated as a production secret manager.

Actions:

- `/run-vault <name:value> --add` or `/run-vault --add <name:value>`: add a local value.
- `/run-vault --list` (`-l`): list ids and names with values redacted.
- `/run-vault --show` (`-s`) `<id|name>`: reveal exactly one requested local value.
- `/run-vault --remove` (`-r`) `<id|name>`: remove one local value.
- `/run-vault --path`: show the vault file path.

Rules:

1. Store values only in `.scrumrun/vault.local.md`.
2. Ensure `.scrumrun/vault.local.md` is in `.git/info/exclude` when Git is present.
3. Never write vault values into `.scrumrun/knowledge.md`, `.scrumrun/backlog.md`, sprint history, decisions, reviews, commits, logs, or ordinary responses.
4. `/run-study`, `/run-challenge`, `/run-sprint`, and reviews may mention that vault entries exist, but must not print their values.
5. Use vault values only when the user explicitly asks for a local development credential or a command requires it.
6. Do not modify application code.

## `/run-know`

Manage `.scrumrun/knowledge.md`, the approved project knowledge base used before challenge intake and sprint planning. Each entry uses a stable id in the form `K-NNN` (for example `K-001`).

Use this when the user wants the agent to understand a specific topic, flow, rule, module, business behavior, integration, permission model, or legacy constraint before creating sprints.

Modes:

- `/run-know <topic>`: investigate and create a pending knowledge proposal with the next `K-NNN` id.
- `/run-know <topic> --deep` (`-d`): same, plus a code map with key functions or symbols, `file:line` references, entry points, call sites, and relevant types or storage.
- `/run-know K-<id> --edit [text]` (`-e`): rewrite an existing entry under the same id; with no text, reuse its current topic and re-investigate; combine with `-d` to rewrite it deeply. The result is pending and must be re-approved.
- `/run-know K-<id> --rename "title"` (`-rn`): change only the entry's title; the `K-NNN` id is permanent and never changes.
- `/run-know K-<id> --insight <text>` (`-i`): append a dated reasoning to an existing entry without rewriting it or changing its status; insights accumulate as advisory context, not verified planning truth.
- `/run-know K-<id> --remove` (`-r`, or `--delete`): delete that knowledge entry from whichever section it is in.
- `/run-know K-<id> --resume` (`-s`): render that entry as a clean, readable summary (read-only); with no id, summarize the whole base.
- `/run-know approve K-<id>`: move a pending proposal into `Approved Knowledge` only with explicit user approval.
- `/run-know reject K-<id>`: move a pending proposal into `Rejected Proposals`.
- `/run-know list`: show approved, pending, and rejected knowledge.

Rules:

1. Read `.scrumrun/golden-rules.md`, `.scrumrun/config.md`, `.scrumrun/map.md`, `.scrumrun/project.md`, `.scrumrun/knowledge.md`, relevant history files, and source files needed to verify the topic.
2. New knowledge starts as a pending proposal, not approved truth.
3. Each proposal must include its `K-NNN` id, title, user insight, verified facts with file references, assumptions, uncertainty, risks if wrong, affected modules, and suggested future use. With `--deep`, also include a code map: key functions or symbols with `file:line` references, entry points, call sites, and relevant types or storage. Function and symbol names are the stable anchor; line numbers are point-in-time.
4. Only `Approved Knowledge` can influence `/run-challenge`, `/run-sprint --new`, `/run-sprint --run`, and feature planning.
5. Pending proposals are unapproved context. Rejected proposals must not be used for planning except to avoid repeating a known bad assumption.
6. Editing an approved entry returns it to pending for re-approval; never silently keep edited content as approved.
7. Do not change application code, create sprints, add backlog items, or update sprint history.

## `/run-challenge`

Analyze a user challenge after `/run-study` and recommend the safest ScrumRun path. This command is read-only by default.

Use it when the user describes a desired change, problem, feature, refactor, risk, or product idea and wants to know whether it should become a sprint, backlog item, isolated feature lane, discovery task, or be rejected/deferred.

Read, when present:

1. `AGENTS.md`;
2. `.scrumrun/golden-rules.md`;
3. `.scrumrun/config.md`;
4. `.scrumrun/map.md`;
5. `.scrumrun/project.md`;
6. `.scrumrun/knowledge.md`;
7. `.scrumrun/backlog.md`;
8. `.scrumrun/goals/main/sprint.md`;
9. `.scrumrun/goals/main/history.md`;
10. `.scrumrun/goals/main/decisions.md`;
11. `.scrumrun/features/*/feature.md`;
12. `.scrumrun/features/*/sprint.md`;
13. `.scrumrun/features/*/history.md`;
14. `.scrumrun/features/*/decisions.md`;
15. relevant source files needed to verify the challenge.

History reading is mandatory when any history file exists. Use it to detect repeated work, failed attempts, blockers, partial implementations, regressions, and completed related sprints.

Inspect affected areas deeply enough to understand product behavior, stack, architecture, entry points, auth, permissions, roles, data model, env/config, integrations, tests, deployment clues, observability, and operational risk.

Return challenge understanding, approved knowledge used, evidence with file references, history findings, impact analysis, risks, unknowns, options, recommendation, and the suggested next command. Valid recommendations include:

- create a small sprint;
- add to backlog;
- create an isolated feature lane;
- run discovery first;
- reject or defer because it conflicts with architecture, safety, product direction, or missing information.

Do not create backlog items, sprint plans, feature lanes, code changes, commits, tests, or history entries unless the user explicitly asks in a follow-up command.

## `/run-goal`

Manage project goal lanes. A bare `/run-goal` lists the actions below.

- `--new` (`-n`) `<goal>`: plan or replace the main project goal in `.scrumrun/goals/main/sprint.md`. Read `AGENTS.md`, `.scrumrun/golden-rules.md`, `.scrumrun/config.md`, `.scrumrun/map.md`, `.scrumrun/project.md`, `.scrumrun/knowledge.md`, `.scrumrun/agents.md`, and `.scrumrun/goals/main/history.md`; use only `Approved Knowledge`. Detect the stack first, then ask blocking architecture questions (stack, architecture style, auth, hosting/infrastructure, external services, testing strategy, monitoring/logging) before writing the plan. Update `.scrumrun/project.md`, the main sprint plan, and `.scrumrun/goals/main/decisions.md`. Do not implement code. If config says `Sprint Automation: backlog` or `bypass`, treat suggested sprints as backlog candidates and do not generate or run plans automatically unless the user asks for `/run-sprint --new` or `/run-backlog --add`.
- `--show` (`-s`) `[focus]`: show `.scrumrun/project.md`, the main sprint plan, history, and decisions in a concise status view. Do not modify files.
- `--list` (`-l`) `[filter]`: list goal lanes under `.scrumrun/goals/`; the default lane is `main`. Do not modify files.

## `/run-feature`

Manage isolated feature lanes outside the main goal history. A bare `/run-feature` lists the actions below.

- `--new` (`-n`) `<description>`: create a lane under `.scrumrun/features/<slug>/` with `feature.md`, `sprint.md`, `history.md`, and `decisions.md`. Infer a lowercase slug; if it already exists, ask whether to show, revise, or use a different slug. The brief includes name, reason, scope, out of scope, dependencies, risks, and assumptions; the sprint plan includes per-sprint goal, scope, deliverables, acceptance criteria, dependencies, suggested verification, and review checkpoints. Never modify the main sprint plan or main history.
- `--list` (`-l`) `[filter]`: list lanes with status, next sprint, blockers, and open decisions. Do not modify files.
- `--show` (`-s`) `<slug>`: read one lane's four files and show a concise status view. Do not modify files.
- `--run` (`-r`) `<slug> <sprint>`: run one lane sprint. Read global ScrumRun files and the lane files, check feature history first; if the sprint is completed, partial, or blocked, stop and ask. Otherwise follow the sprint protocol, run review agents, and update only the feature lane history. Never update main goal history.
- `--audit` (`-a`) `<slug> <sprint>`: audit a lane sprint from current file state; verify acceptance criteria, tests, env/config handling, and safety rules; report findings by severity. Do not modify code unless explicitly requested.

## `/run-sprint`

Manage main-goal sprints. A bare `/run-sprint` lists the actions below. Use only `Approved Knowledge` before planning or execution.

- `--new` (`-n`) `[*] <name>`: create a main-goal sprint in `.scrumrun/goals/main/sprint.md`; prefix the name with `*` to mark priority; assign the next sprint number; add goal, scope, acceptance criteria, dependencies, suggested verification, and review checkpoints.
- `--list` (`-l`): summarize main-goal sprint status from the sprint plan and history. Do not modify files.
- `--status` (`-st`) `[id]`: read the main sprint plan and history, then output only a compact Markdown table with exactly `Sprint | Breve descricao | Status`. With an id, show only that sprint; without an id, show one row per sprint. Use brief title/goal descriptions and emoji statuses: `✅ feito`, `🚧 parcial`, `⛔ bloqueado`, or `⏳ pendente`. Do not add surrounding narrative. Do not modify files.
- `--show` (`-s`) `<id>`: show the sprint with a prominent plain-language Goal section, scope, acceptance criteria, priority, status, and history entry. Do not modify files.
- `--rename` (`-rn`) `<id> "name"`: rename only the sprint's descriptive label; keep its number/id (history and backlog reference the number), and note "renamed from X to Y" in history.
- `--run` (`-r`) `<id>`: run one main-goal sprint. If the arguments include `--backlog` (`-k`) or `--to-backlog`, add the sprint to `.scrumrun/backlog.md` and stop without executing. Otherwise read `AGENTS.md`, golden-rules, config, map, knowledge, runbook, agents, and the main goal files; if the sprint already has status completed, partial, or blocked, stop and ask whether to audit, rerun/fix, resume, or move on; follow Entenda -> Avalie Impactos -> Tire Duvidas -> Execute -> Teste; run every agent; fix findings before completing; update main history.
- `--audit` (`-a`) `<id>`: audit a main-goal sprint from current file state; report findings by severity. Do not modify code unless explicitly requested.
- `--fix` (`-f`) `<id>`: corrective pass. First ask what went wrong and wait; then, on confirmation, create an executable corrective child sprint `Sprint <id>.M` (dotted, e.g. `02.1`) linked to the parent, leaving the parent intact and marked as patched. Record it in history, capture the lesson in `.scrumrun/knowledge.md` (pending proposal or insight, never auto-approved — ask to approve), and log any decision. Run it with `/run-sprint --run <id>.M`; a fix of a fix is a sibling `<id>.M+1`. Do not change application code.
- `--commit-message` (`-cm`) `<id>`: return a single, succinct commit message for what that sprint delivered — one short line, imperative, lowercase, no trailing period, as few characters as possible. Read-only; output only the message and never stage, commit, or modify files.
- `--discuss` (`-d`) `<id>`: explore the user's concern about the approach, propose 2-3 alternatives with trade-offs, ask for preference before changes, and log the discussion in main history.
- `--bypass` (`-b`) `[context]`: set `.scrumrun/config.md` to `Sprint Automation: backlog` for legacy or hand-managed projects so suggested sprints become backlog candidates until the user chooses what to run. Keep other preferences intact, note the change in `.scrumrun/project.md` or `.scrumrun/goals/main/decisions.md`, and prefer `/run-backlog --add` and `/run-backlog --list`.

## `/run-backlog`

Manage the sprint backlog in `.scrumrun/backlog.md`. A bare `/run-backlog` lists the actions below.

- `--add` (`-a`) `<sprint number or name>`: add a sprint candidate without executing it. Read golden-rules, config, the main sprint plan, main history, and the backlog. Treat the sprint as a candidate; if it exists in the plan, copy its title or focus; otherwise add the label as a manual candidate with details pending. Never run implementation, agents, tests, or audits; never change sprint status; if it already exists, report instead of duplicating.
- `--list` (`-l`) `[filter]`: list candidates, each with matching sprint details when discoverable, current history status if any, and the exact `/run-sprint --run ...` command needed to run it. Do not modify files.

## `/run-agent`

Manage review agents in `.scrumrun/agents.md`. A bare `/run-agent` lists the actions below.

- `--add` (`-a`): ask for agent name, role, run order, checks, and optional technology focus, then append the agent.
- `--list` (`-l`): list configured agents and explain their roles and checkpoints. Do not modify files.
- `--run` (`-r`) `<sprint>`: run all review agents, or one numbered agent, against the requested sprint, and update the relevant history with results.

## `/run-review`

Run a review. A bare `/run-review` lists the actions below.

- `--code` (`-c`) `[focus]`: review the whole codebase and save a timestamped report under `.scrumrun/reviews/YYYY-MM-DD-HHMMSS-code-review.md`. Findings ordered by severity with file/line references. Do not modify code unless explicitly requested.
- `--file` (`-f`) `<path:start_end>`: review only the requested file range in the format `path/to/file.ext:line_start_line_end`. Do not modify code unless explicitly requested.

## `/run-golden`

Manage golden rules in `.scrumrun/golden-rules.md`; they have absolute priority. A bare `/run-golden` lists the actions below.

- `--add` (`-a`) `<rule>`: append a new numbered rule (create the file if missing) and display the updated list.
- `--list` (`-l`): read and list the rules. Do not modify files.
- `--remove` (`-r`) `<number>`: remove rule number N and display the updated list.

## `/run-config`

Manage preferences in `.scrumrun/config.md`. A bare `/run-config` lists the actions below.

- `--show` (`-s`): read and display config, including `Language` and `Sprint Automation` (valid values include `backlog` and legacy `bypass`).
- `--lang` (`-l`) `<language>`: set `Language: <language>` for all ScrumRun responses; preserve unrelated preferences.

## `/run-map`

Manage the project map in `.scrumrun/map.md`. A bare `/run-map` lists the actions below.

- `--build` (`-b`): inspect the project and update the map with top-level folders, important paths, modules, tooling, config files, routes, and data/storage files. Do not include secrets.
- `--view` (`-v`): show a concise project structure view from the map and current folders. Do not modify files.

## `/run-decisions`

Resolve pending decisions, questions, risks, and follow-ups one at a time.

Default scope is the main goal:

- `.scrumrun/goals/main/history.md`
- `.scrumrun/goals/main/decisions.md`

If a feature is specified, use that feature lane's `history.md` and `decisions.md`.

Update the relevant decisions/history file with each resolution.
