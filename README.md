# ScrumRun

ScrumRun is a lightweight workflow for running software projects with AI agents through small, auditable, independently executable sprints.

It is designed for one practical problem: keeping AI work organized when a project has a main goal, new feature ideas, review passes, pending decisions, and long-running implementation history.

ScrumRun gives the agent a stable project memory, a sprint protocol, review checkpoints, and a clean place to separate the main project plan from isolated feature work.

## What ScrumRun Provides

- Global slash commands for Codex, Claude Code, and OpenCode.
- A `scrumrun` skill that tells agents how to plan, run, audit, and review sprints.
- A project control folder under `.scrumrun/`.
- A root `AGENTS.md` file that points agents to the ScrumRun rules.
- Main goal planning under `.scrumrun/goals/main/`.
- Isolated feature lanes under `.scrumrun/features/`.
- A sprint candidate backlog under `.scrumrun/backlog.md`.
- An approved knowledge base under `.scrumrun/knowledge.md`.
- Sprint history, decisions, review agents, golden rules, and project mapping.
- A CLI that installs, updates, checks, initializes, summarizes, and manages local ScrumRun files.

## Core Idea

ScrumRun separates three kinds of context:

```text
Project rules
  Global constraints that every agent must follow.

Main goal
  The primary project plan and execution history.

Feature lanes
  Isolated plans for new features that should not pollute the main goal.
```

This matters because a feature idea can be valid without being part of the current main sprint sequence. ScrumRun lets that feature be planned separately while still respecting project rules, architecture, safety boundaries, and review standards.

## Project Layout

After initialization, a project should look like this:

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
  vault.local.md      # optional, local-only, never committed
  goals/
    main/
      sprint.md
      history.md
      decisions.md
  features/
    example-feature/
      feature.md
      sprint.md
      history.md
      decisions.md
  reviews/
```

### `AGENTS.md`

Root instruction file for AI agents.

It should stay short and point agents to ScrumRun files:

```text
.scrumrun/golden-rules.md
.scrumrun/config.md
.scrumrun/map.md
.scrumrun/knowledge.md
.scrumrun/runbook.md
.scrumrun/backlog.md
.scrumrun/goals/main/sprint.md
.scrumrun/goals/main/history.md
```

### `.scrumrun/config.md`

Project-level ScrumRun preferences.

Typical contents:

- response language;
- preferred review behavior;
- project-specific workflow preferences.
- sprint automation mode.

### `.scrumrun/golden-rules.md`

Absolute rules for the project.

Golden rules have the highest priority. If a golden rule conflicts with any other ScrumRun instruction, the golden rule wins.

### `.scrumrun/map.md`

Compact project map.

Agents read this before broad discovery work so they do not repeatedly search the whole repository. It is a navigation aid, not a source of truth. Agents must still verify files before editing.

### `.scrumrun/agents.md`

Review agent definitions.

By default, ScrumRun expects three review roles:

- Code Review: checks implementation quality, patterns, performance, and linting.
- QA: checks acceptance criteria, tests, edge cases, and user-facing behavior.
- Architecture: checks design decisions, data flow, security posture, and golden rules.

### `.scrumrun/runbook.md`

Execution protocol for sprints.

Every sprint follows:

```text
Entenda -> Avalie Impactos -> Tire Duvidas -> Execute -> Teste
```

### `.scrumrun/project.md`

High-level project description.

It should document the product goal, stack, architecture, infrastructure, important constraints, and active planning lanes.

### `.scrumrun/backlog.md`

Sprint candidate backlog.

This is where suggested or manually selected sprint candidates can be parked without starting implementation. It is useful for legacy projects where `/run-study` may discover many important issues, but the user still needs full control over which work is allowed to run.

### `.scrumrun/knowledge.md`

Approved project knowledge base.

Use this for domain facts, legacy behavior, permission rules, integration details, known constraints, and user insights that should influence future challenges and sprint planning.

Knowledge starts as a pending proposal. Only the `Approved Knowledge` section should be used as planning truth. Pending proposals can be mentioned as unapproved context, and rejected proposals should only be used to avoid repeating known bad assumptions.

### `.scrumrun/vault.local.md`

Optional local development vault.

Use this for dev-only credentials and local test values that help you work on the project. It is plaintext Markdown, not encrypted storage, and must never be committed or used as a production secret manager.

ScrumRun adds `.scrumrun/vault.local.md` to `.git/info/exclude` when initializing a Git project. Agents may mention that local vault entries exist, but they must not print vault values in study reports, sprint history, knowledge, reviews, backlog, commits, or normal summaries.

### `.scrumrun/goals/main/sprint.md`

Sprint plan for the main project goal.

This is the structured plan for main-goal sprints. A sprint listed here is not active work until the user explicitly runs `/run-sprint --run`.

### `.scrumrun/goals/main/history.md`

Execution history for the main goal.

Agents must check this before running a sprint:

- `completed`: do not rerun silently; ask whether to audit, rerun/fix, or continue.
- `partial`: ask whether to resume, audit, or move on.
- `blocked`: read the blocker and ask whether it is resolved.
- no entry: proceed if dependencies are satisfied.

### `.scrumrun/goals/main/decisions.md`

Open and resolved decisions for the main goal.

Use this for architectural calls, unresolved questions, trade-offs, and follow-ups that should not be buried inside sprint history.

### `.scrumrun/features/<feature>/feature.md`

Feature brief.

It records:

- feature name;
- reason for the feature;
- intended user or business value;
- scope;
- out-of-scope items;
- dependencies on the main project;
- risks and assumptions.

### `.scrumrun/features/<feature>/sprint.md`

Sprint plan for one isolated feature lane.

This file is separate from the main goal sprint plan. A new feature can be planned without changing `.scrumrun/goals/main/sprint.md`.

### `.scrumrun/features/<feature>/history.md`

Execution history for one feature lane.

This prevents feature work from polluting the main goal history.

### `.scrumrun/features/<feature>/decisions.md`

Feature-specific decisions, questions, and follow-ups.

## Install

Run directly from GitHub:

```bash
npx github:leandercosta/scrumrun install
```

Install only one target:

```bash
npx github:leandercosta/scrumrun install codex
npx github:leandercosta/scrumrun install opencode
npx github:leandercosta/scrumrun install claude
```

Install targets write to different client directories:

```text
codex    -> ~/.codex/prompts and ~/.codex/skills
claude   -> ~/.claude/commands and ~/.claude/skills
opencode -> ~/.config/opencode/commands and ~/.config/opencode/skills
```

Optional global install:

```bash
npm install -g github:leandercosta/scrumrun
scrumrun install
```

## Update

Update installed command and skill files:

```bash
npx github:leandercosta/scrumrun update
npx github:leandercosta/scrumrun update codex
npx github:leandercosta/scrumrun update opencode
npx github:leandercosta/scrumrun update claude
```

## Doctor

Check whether the global files are installed:

```bash
npx github:leandercosta/scrumrun doctor
```

## Initialize A Project

By default, ScrumRun initializes locally and keeps its files out of commits:

```bash
npx github:leandercosta/scrumrun init
```

This is equivalent to:

```bash
npx github:leandercosta/scrumrun init --local
```

Local mode creates `AGENTS.md` and `.scrumrun/`. When the directory is already a Git repository, it adds both paths to `.git/info/exclude`, so they stay local.

For a new project where ScrumRun should be committed with the repository:

```bash
npx github:leandercosta/scrumrun init --shared
```

Shared mode creates versionable ScrumRun project files:

```text
AGENTS.md
.scrumrun/config.md
.scrumrun/golden-rules.md
.scrumrun/map.md
.scrumrun/agents.md
.scrumrun/runbook.md
.scrumrun/project.md
.scrumrun/backlog.md
.scrumrun/knowledge.md
.scrumrun/goals/main/sprint.md
.scrumrun/goals/main/history.md
.scrumrun/goals/main/decisions.md
.scrumrun/features/
.scrumrun/reviews/
```

Even in shared mode, `.scrumrun/vault.local.md` is local-only and should never be committed.

For an existing project that has been running for months or years, use local adoption:

```bash
npx github:leandercosta/scrumrun init --local
```

Local mode creates `AGENTS.md` and `.scrumrun/` but keeps them out of commits by adding these entries to `.git/info/exclude`:

```text
AGENTS.md
.scrumrun/
```

This does not modify `.gitignore` and does not touch application code. It is the lowest-friction way to start using ScrumRun in an established repository without changing what the team sees in Git.

If you do not want ScrumRun to create `AGENTS.md`, use:

```bash
npx github:leandercosta/scrumrun init --local --no-agent-hint
```

That creates only `.scrumrun/` and adds `.scrumrun/` to `.git/info/exclude`.

Use `--force` only when you intentionally want to overwrite existing ScrumRun files:

```bash
npx github:leandercosta/scrumrun init --force
```

### Existing Project Workflow

Recommended flow for an established project:

```bash
cd existing-project
npx github:leandercosta/scrumrun init --local
```

Then, inside your AI client:

```text
/run-study
/run-know The reports export checks tenant membership before file generation
/run-know approve K-001
/run-challenge The existing reports module needs tenant-level permissions before export
/run-map --build
/run-goal --new Continue evolving this existing product without rewriting the architecture
```

In established projects, `/run-study` is intentionally deep. It should inspect stack, architecture, permissions, auth, data model, integrations, env/config, deployment clues, tests, risks, and current ScrumRun files. It is read-only and should recommend sprint candidates without running them.

When the study surfaces possible work, park candidates in the backlog first:

```text
/run-challenge The current permissions screen needs role inheritance support
/run-backlog --add Sprint 01
/run-backlog --list
```

Only run a sprint when you explicitly choose it:

```text
/run-sprint --run Sprint 01
```

You can also send a sprint candidate to the backlog from the run command:

```text
/run-sprint --run Sprint 01 --backlog
```

For a new isolated feature:

```text
/run-feature --new Add a billing dashboard with invoices and subscription controls
```

Use `--shared` only when the repository owner or team explicitly wants ScrumRun files committed. ScrumRun does not require methodology files to be committed.

## Migrate An Existing Project

For projects using the old flat layout, migrate files into `.scrumrun/`:

```bash
npx github:leandercosta/scrumrun migrate
```

Migration map:

```text
asm-config.md          -> .scrumrun/config.md
golden-rules.md        -> .scrumrun/golden-rules.md
map.md                 -> .scrumrun/map.md
review-agents.md       -> .scrumrun/agents.md
ai-sprint-runbook.md   -> .scrumrun/runbook.md
sprint.md              -> .scrumrun/goals/main/sprint.md
history.md             -> .scrumrun/goals/main/history.md
```

## Typical Workflow

Start a project:

```text
/run-init
/run-help
/run-config --lang pt-BR
/run-study
/run-know Billing seat limits depend on active subscriptions, not invited users
/run-know approve K-001
/run-challenge Users need team billing limits before creating paid seats
/run-goal --new Build a SaaS task manager with teams and Stripe billing
/run-map --build
/run-backlog --add Sprint 01
/run-backlog --list
/run-sprint --run Sprint 01
/run-sprint --audit Sprint 01
```

Start an isolated feature:

```text
/run-feature --new Add a marketplace with sellers, commissions, and Stripe Connect
/run-feature --show marketplace
/run-feature --run marketplace Sprint 01
/run-feature --audit marketplace Sprint 01
```

Review work:

```text
/run-review --code
/run-review --file src/auth/login.ts:40_120
/run-decisions
```

## Slash Commands

Commands are grouped by noun. The action is a flag, and every long flag has a short alias (for example `--run` / `-r`). Running a base command with no flag lists that group's actions.

### Project

#### `/run-help`

Shows ScrumRun commands grouped by workflow.

Examples:

```text
/run-help
/run-help feature
/run-help /run-sprint
```

#### `/run-init`

Initializes ScrumRun in the current project. Creates `AGENTS.md` and `.scrumrun/` control files. It does not create application code.

#### `/run-uninstall`

Removes ScrumRun from the current project.

Default behavior is conservative: it removes ScrumRun entries from `.git/info/exclude` and reports what would be deleted. Use `--force` (`-f`) to remove `.scrumrun/` and remove `AGENTS.md` only when it is recognized as ScrumRun-generated.

Examples:

```text
/run-uninstall
/run-uninstall --force
```

#### `/run-study`

Deep-studies the project and summarizes the operational state: stack, architecture, entry points, auth, permissions, data model, env/config, integrations, deployment clues, tests, observability, risks, and unknowns. Read-only; recommended work is presented as backlog candidates, not executed.

#### `/run-know`

Creates and manages project knowledge before sprint planning. Each entry has a stable id in the form `K-NNN` (for example `K-001`). New knowledge is never approved automatically — `/run-know <topic>` writes a pending proposal in `.scrumrun/knowledge.md` and asks for approval. Only approved knowledge influences `/run-challenge`, `/run-sprint --new`, `/run-sprint --run`, and feature planning.

Flags:

- `--deep` (`-d`): also capture a code map — key functions or symbols with `file:line` references, entry points, call sites, and relevant types or storage. Function and symbol names are the stable anchor; line numbers are point-in-time.
- `--edit` (`-e`) `K-<id> [text]`: rewrite an existing entry under the same id. With no text it reuses the entry's topic and re-investigates; combine with `-d` to rewrite it deeply. The result returns to pending for re-approval.
- `--rename` (`-rn`) `K-<id> "title"`: change only the entry's title; the `K-NNN` id never changes.
- `--insight` (`-i`) `K-<id> <text>`: append a dated reasoning to an entry without rewriting it or changing its status. Insights accumulate over time as advisory context.
- `--remove` (`-r`, or `--delete`) `K-<id>`: delete a knowledge entry.
- `--resume` (`-s`) `[K-<id>]`: render a knowledge entry (or the whole base, if no id) as a clean, readable summary. Read-only.

Examples:

```text
/run-know Understand how tenant permissions work for report exports
/run-know --deep How report export permissions are enforced
/run-know K-001 -d -e
/run-know K-002 --remove
/run-know K-001 --resume
/run-know K-001 --insight This flow is also hit by the nightly export job, so permission changes must cover that path
/run-know K-001 --rename Report export tenant permission model
/run-know list
/run-know approve K-001
/run-know reject K-002 because exports are handled by the billing service, not reports
```

#### `/run-vault`

Manages local development credentials in `.scrumrun/vault.local.md`.

This is intentionally local-only. It is useful for development credentials, sandbox API keys, local test tokens, and throwaway values. It is plaintext, so do not use it as a production secret manager.

Examples:

```text
/run-vault OPENAI_API_KEY:sk-local-dev --add
/run-vault --add STRIPE_SECRET_KEY:sk_test_local
/run-vault --list
/run-vault --show OPENAI_API_KEY
/run-vault --remove OPENAI_API_KEY
/run-vault --path
```

Rules:

- values go only to `.scrumrun/vault.local.md`;
- `.scrumrun/vault.local.md` must stay out of Git;
- values must not be copied into knowledge, sprint history, reviews, backlog, decisions, commits, or normal summaries;
- `/run-study` and `/run-challenge` may mention that vault entries exist, but must not reveal values.

#### `/run-challenge`

Analyzes a concrete user challenge against the studied project and recommends the safest ScrumRun path. It reads existing history and uses only `Approved Knowledge` as planning truth. Read-only by default; it returns challenge understanding, evidence with file references, history findings, impact, risks, options (sprint, backlog, feature lane, discovery, or reject/defer), and a recommended next command.

Examples:

```text
/run-challenge The export flow needs tenant-level permission checks before CSV download
/run-challenge Add invoice retry logic, but only if it does not conflict with current Stripe webhooks
```

#### `/run-update`

Updates installed global command and skill files.

```text
/run-update
/run-update codex
/run-update opencode
/run-update claude
```

### Configuration

#### `/run-config`

Manages `.scrumrun/config.md`.

- `--show` (`-s`): display preferences, including `Language` and `Sprint Automation`.
- `--lang` (`-l`) `<language>`: set the response language for all commands.

```text
/run-config --show
/run-config --lang pt-BR
/run-config -l English
```

### Golden Rules

#### `/run-golden`

Manages golden rules in `.scrumrun/golden-rules.md` — absolute priority, never violated.

- `--list` (`-l`): list current rules.
- `--add` (`-a`) `<rule>`: add a rule.
- `--remove` (`-r`) `<number>`: remove a rule by number.

```text
/run-golden --list
/run-golden --add Always use TypeScript with strict mode
/run-golden --remove 2
```

### Map

#### `/run-map`

Manages the project map in `.scrumrun/map.md`.

- `--build` (`-b`): build or refresh the map.
- `--view` (`-v`): display the map without modifying files.

```text
/run-map --build
/run-map --build src/auth
/run-map --view
```

### Goals

#### `/run-goal`

Manages project goal lanes.

- `--new` (`-n`) `<goal>`: plan or replace the main project goal. The agent asks architectural questions before creating sprints. If `Sprint Automation: backlog` (or legacy `bypass`) is set, suggested sprints become candidates; add them with `/run-backlog --add` and review with `/run-backlog --list`.
- `--show` (`-s`) `[focus]`: show the current main goal plan and status.
- `--list` (`-l`) `[filter]`: list goal lanes; the default lane is `main`.

```text
/run-goal --new Build a headless CMS with GraphQL API and S3 media uploads
/run-goal --show
/run-goal --list
```

### Features

#### `/run-feature`

Manages isolated feature lanes under `.scrumrun/features/<slug>/`, kept out of the main goal history.

- `--new` (`-n`) `<description>`: create a lane (`feature.md`, `sprint.md`, `history.md`, `decisions.md`).
- `--list` (`-l`) `[filter]`: list lanes and their status.
- `--show` (`-s`) `<slug>`: show one lane's brief, plan, history, and decisions.
- `--run` (`-r`) `<slug> <sprint>`: run one sprint from a lane.
- `--audit` (`-a`) `<slug> <sprint>`: audit one sprint from a lane.

```text
/run-feature --new Add a billing dashboard with invoices and subscription controls
/run-feature --list
/run-feature --show billing-dashboard
/run-feature --run billing-dashboard Sprint 01
/run-feature --audit billing-dashboard Sprint 01
```

### Sprints

Before creating or running sprints, agents read `.scrumrun/knowledge.md` and use only `Approved Knowledge` as planning truth.

#### `/run-sprint`

Manages main-goal sprints.

- `--new` (`-n`) `[*] <name>`: create a sprint; prefix the name with `*` to mark priority.
- `--list` (`-l`): list sprints and status.
- `--status` (`-st`) `[id]`: show only a compact `Sprint | Breve descricao | Status` table. With an id, shows one sprint; without an id, shows all sprints. Status uses `✅ feito`, `🚧 parcial`, `⛔ bloqueado`, or `⏳ pendente`.
- `--show` (`-s`) `<id>`: show full details for one sprint.
- `--rename` (`-rn`) `<id> "name"`: rename only the sprint's descriptive label; the number/id stays the same.
- `--run` (`-r`) `<id>`: run one sprint (history check, protocol, review agents, history update). Add `--backlog` (`-k`) to send it to the backlog instead of executing.
- `--audit` (`-a`) `<id>`: audit an executed sprint.
- `--fix` (`-f`) `<id>`: corrective pass — asks what went wrong, then (on confirmation) creates an executable corrective child sprint `NN.M` (e.g. `02.1`) linked to the parent, captures the lesson in the knowledge base (pending proposal or insight, never auto-approved), and logs decisions. Run it with `/run-sprint --run 02.1`. Does not change application code.
- `--commit-message` (`-cm`) `<id>`: print a short, succinct commit message for the sprint's delivered work — one line, minimal characters. Read-only (does not commit).
- `--discuss` (`-d`) `<id>`: discuss the approach and log the decision.
- `--bypass` (`-b`) `[context]`: put sprint planning into backlog mode for legacy or hand-managed projects; prefer `/run-backlog --add` and `/run-backlog --list` afterward.

```text
/run-sprint --new Add dark mode toggle
/run-sprint --new * Fix critical auth bug
/run-sprint --list
/run-sprint --status
/run-sprint --status Sprint 01
/run-sprint --show Sprint 01
/run-sprint --run Sprint 01
/run-sprint --run Sprint 01 --backlog
/run-sprint --audit Sprint 01
/run-sprint --commit-message Sprint 01
/run-sprint --fix Sprint 01
/run-sprint --rename Sprint 01 Tenant-aware CSV export
/run-sprint --discuss 04 Should we use SQLite instead of Postgres?
/run-sprint --bypass
```

#### `/run-backlog`

Manages sprint candidates in `.scrumrun/backlog.md`.

- `--add` (`-a`) `<sprint number or name>`: add a candidate without executing it.
- `--list` (`-l`) `[filter]`: list candidates with the command needed to run each.

```text
/run-backlog --add Sprint 01
/run-backlog --add Audit permissions and role policies
/run-backlog --list
```

### Review Agents

#### `/run-agent`

Manages review agents in `.scrumrun/agents.md`.

- `--add` (`-a`): add a review agent.
- `--list` (`-l`): list configured agents.
- `--run` (`-r`) `<sprint>`: run all agents, or one numbered agent, against a sprint.

```text
/run-agent --add Security review
/run-agent --list
/run-agent --run Sprint 01
/run-agent --run 2 Sprint 01
```

### Reviews

#### `/run-review`

Runs a review.

- `--code` (`-c`) `[focus]`: review the whole codebase and save a timestamped report under `.scrumrun/reviews/YYYY-MM-DD-HHMMSS-code-review.md`.
- `--file` (`-f`) `<path:start_end>`: review one file range without changing code.

```text
/run-review --code
/run-review --file src/auth/login.ts:40_120
```

### Decisions

#### `/run-decisions`

Resolves pending decisions, questions, risks, and follow-ups one by one. With no argument it scans the main goal; pass a feature slug to use that lane's history and decisions.

```text
/run-decisions
/run-decisions billing-dashboard
```

## CLI Reference

The CLI manages local ScrumRun files and installed slash commands. It does not replace Codex, Claude Code, or OpenCode as the AI execution layer.

Use slash commands inside your AI client for deep repository analysis and implementation. Use the CLI for local project setup, status, simple backlog/knowledge file operations, and generating prompts to paste into the client.

### `install [all|codex|opencode|claude]`

Installs global slash commands and skills.

```bash
npx github:leandercosta/scrumrun install
npx github:leandercosta/scrumrun install codex
npx github:leandercosta/scrumrun install opencode
npx github:leandercosta/scrumrun install claude
```

### `update [all|codex|opencode|claude]`

Updates global slash commands and skills.

```bash
npx github:leandercosta/scrumrun update
npx github:leandercosta/scrumrun update codex
npx github:leandercosta/scrumrun update opencode
npx github:leandercosta/scrumrun update claude
```

### `init [--local|--shared] [--no-agent-hint] [--force]`

Creates ScrumRun project files.

```bash
npx github:leandercosta/scrumrun init
npx github:leandercosta/scrumrun init --local
npx github:leandercosta/scrumrun init --shared
npx github:leandercosta/scrumrun init --local --no-agent-hint
```

Default behavior is local with an agent hint. Use `--local` explicitly when you want to be clear. It writes `AGENTS.md` and `.scrumrun/` to `.git/info/exclude` so ScrumRun files stay out of commits.

Use `--shared` when ScrumRun should be committed as part of the repository.

Use `--no-agent-hint` when you want `.scrumrun/` only.

### `status`

Shows a local ScrumRun project summary: required control files, local Git exclude status, backlog count, knowledge counts, planned sprint count, and history status counts.

```bash
npx github:leandercosta/scrumrun status
```

### `commands`

Lists installed slash command names and useful CLI helpers.

```bash
npx github:leandercosta/scrumrun commands
```

### `vault`

Manages `.scrumrun/vault.local.md` for local development secrets. Values are stored as plaintext and are hidden by default in list output.

```bash
npx github:leandercosta/scrumrun vault add OPENAI_API_KEY sk-local-dev
npx github:leandercosta/scrumrun vault add STRIPE_SECRET_KEY:sk_test_local
npx github:leandercosta/scrumrun vault list
npx github:leandercosta/scrumrun vault show OPENAI_API_KEY
npx github:leandercosta/scrumrun vault remove OPENAI_API_KEY
npx github:leandercosta/scrumrun vault path
```

### `backlog`

Manages `.scrumrun/backlog.md` without running any sprint.

```bash
npx github:leandercosta/scrumrun backlog add "Sprint 01"
npx github:leandercosta/scrumrun backlog list
npx github:leandercosta/scrumrun backlog list permissions
```

Legacy aliases are also available:

```bash
npx github:leandercosta/scrumrun backlog-add "Sprint 01"
npx github:leandercosta/scrumrun backlog-list
```

### `know`

Manages `.scrumrun/knowledge.md` locally. CLI-created knowledge starts as pending and should still be verified by an agent before approval.

```bash
npx github:leandercosta/scrumrun know add "Tenant permissions for report exports"
npx github:leandercosta/scrumrun know list
npx github:leandercosta/scrumrun know approve K-001
npx github:leandercosta/scrumrun know reject K-002 "Wrong module"
npx github:leandercosta/scrumrun know insight K-001 "Also used by nightly export"
npx github:leandercosta/scrumrun know resume
npx github:leandercosta/scrumrun know resume K-001
npx github:leandercosta/scrumrun know remove K-001
```

For deep verification, use the slash command in your AI client:

```text
/run-know --deep Tenant permissions for report exports
```

### `prompt`

Generates a slash command line for your AI client without running the agent.

```bash
npx github:leandercosta/scrumrun prompt study
npx github:leandercosta/scrumrun prompt challenge "Exports need tenant permission checks"
npx github:leandercosta/scrumrun prompt know "Tenant permissions for report exports"
npx github:leandercosta/scrumrun prompt vault "OPENAI_API_KEY:sk-local-dev --add"
npx github:leandercosta/scrumrun prompt goal-new "Continue evolving this legacy product"
npx github:leandercosta/scrumrun prompt sprint-new "Implement tenant-safe CSV export"
npx github:leandercosta/scrumrun prompt sprint-run "Sprint 01"
npx github:leandercosta/scrumrun prompt backlog-add "Sprint 01"
```

### `uninstall [--force]`

Removes ScrumRun from the current project.

```bash
npx github:leandercosta/scrumrun uninstall
npx github:leandercosta/scrumrun uninstall --force
```

Without `--force`, it only removes ScrumRun entries from `.git/info/exclude` and reports what would be removed.

With `--force`, it removes `.scrumrun/` and removes `AGENTS.md` only if that file is recognized as ScrumRun-generated. It does not remove application code or unrelated project files.

### `migrate`

Moves an old flat ScrumRun project into the v2 `.scrumrun/` layout.

```bash
npx github:leandercosta/scrumrun migrate
```

### `doctor`

Checks whether global commands and skills are installed.

```bash
npx github:leandercosta/scrumrun doctor
npx github:leandercosta/scrumrun doctor codex
npx github:leandercosta/scrumrun doctor claude
npx github:leandercosta/scrumrun doctor opencode
```

## Safety Rules

- Always read `.scrumrun/golden-rules.md` before sprint execution.
- Never modify read-only source paths.
- Never commit real secrets.
- Runtime values must come from env/config.
- External providers require current official docs before implementation.
- Audit source code read-only before migrating behavior.
- Work one sprint at a time.
- Update the relevant history file after every sprint.
- Main goal history and feature history must stay separate.

## Naming Rules

Use domain-first command names:

```text
run-goal-*
run-feature-*
run-sprint-*
run-review-*
run-agent-*
run-golden-*
run-config-*
run-map-*
```

Avoid old planning names such as:

```text
run-plan-goal
run-plan-task
run-plan-edit
```

The v2 model uses `goal` for the main project direction and `feature` for isolated new work.

## Design Principle

ScrumRun does not remove context. It separates context.

A feature lane is isolated from the main goal history, but it still respects project rules, architecture, map, review agents, and safety requirements.
