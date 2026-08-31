# ScrumRun Core 2.0

ScrumRun is a portable, evidence-driven Agile runtime for AI agents. It makes intended work, execution attempts, decisions, and project learning explicit without turning the project into a ceremony engine.

Method version: `2.0.0`

## One command

The canonical command is:

```text
scrumrun <noun> <subject> <action> [args]
```

The five nouns are:

- `plan` — Features, Tasks, Sprints, Runs, intake, and challenge;
- `knowledge` — facts, Decisions, Insights, dossiers, context, map, study, and vault;
- `rules` — guardrails and reviewers;
- `review` — code, artifact, migration, and release gates;
- `config` — project preferences, lifecycle, migration, doctor, and help.

Incomplete syntax lists only valid next tokens. Unknown syntax never guesses or mutates.

The command manifest at `lib/commands/manifest.js` generates client prompts, compatibility adapters, help, and grammar tests. The installed CLI is canonical; `/sc` is a client shortcut. A v1 upgrade may install generated compatibility adapters for one release cycle.

## Entity model

The exact machine contract is `lib/v2/schema.js`; `docs/SCHEMA.md` is its generated human-readable form. This guide explains how to operate that contract and must not redefine its status sets or cardinalities.

```text
FEAT-003
   └── TASK-018
          ├── executed_by → RUN-044
          ├── included_in → SPRINT-012
          ├── constrained_by → DEC-018
          └── generated → INS-041
```

- Feature (`FEAT-NNN`) is the long-lived initiative: why the work matters.
- Task (`TASK-NNN`) is the atomic intended change: what must be done.
- Sprint (`SPRINT-NNN`) is a real timebox or delivery batch: when related Tasks are grouped.
- Run (`RUN-NNN`) is one concrete execution attempt: how a Task actually happened.
- Review (`REV-NNN`) records a scoped quality gate.
- Memory records what the project knows and why: Knowledge (`K-NNN`), Decision (`DEC-NNN`), Insight (`INS-NNN`), and Dossier (`DOS-NNN`).

A Task may exist without a Sprint. A retry creates a new Run and never overwrites the previous attempt. A fix is a Task with `type: fix`; backlog is a generated view of Tasks with `status: backlog`.

## Canonical project tree

```text
AGENTS.md
.scrumrun/
  core.md
  guardrails.md
  config.md
  project.md
  state.md                         # generated, not authoritative
  map.md                           # generated, not authoritative
  method.json
  tasks/
    TASK-NNN.md
  sprints/
    SPRINT-NNN.md
  features/
    FEAT-NNN.md
  runs/
    RUN-NNN.md
  memory/
    knowledge/
      K-NNN.md
    decisions/
      DEC-NNN.md
    insights/
      INS-NNN.md
    dossiers/
      DOS-NNN.md
  reviews/
    REV-NNN.md
  .cache/                          # ignored and disposable
    semantic-index.sqlite
    contexts/
```

**Before querying project state, read `.scrumrun/method.json`.** Its `paths` block is the authoritative index of every canonical location in this project. Navigate by that index; if a path is not declared there, it is not canonical truth. Directory listing and grep are fallbacks — never the first step. A ScrumRun-aware agent must never search for `goals/`, `backlog.md`, `sprint.md`, or any legacy layout: those are absent by design once migration completes and are surfaced only through `.scrumrun/.migration-backup/`.

**Markdown is the normal runtime.** After explicit approval, work directly in source files and relevant `.scrumrun/` Markdown. A Task is free to be created, refined, started, completed, and handed off in Markdown; a Run is optional audit context, never a state machine that can prevent daily work. Update the Task's scope, Acceptance Criteria, Technical Summary, and Follow-ups directly. Do not use `npx scrumrun@latest` or normal `scrumrun plan/run` commands during execution.

**The CLI is maintenance, not a work gate.** Use it for `init`, `update --project`, `migrate`, `repair`, `doctor`, reports, and release checks. Strict per-edit permits and ledger finalization remain available only when the owner asks for that audit level. Missing/invalid Runs, old status vocabulary, stale projections, and optional tests are warnings to reconcile in Markdown — never an automatic blocker.

**Block only on real constraints.** An agent must stop for an explicit active Guardrail, secret/security risk, destructive action without approval, or an unmet required Acceptance Criterion. It must not manufacture a failed/blocked Run because optional E2E coverage, an optional reviewer, or a non-required environment is unavailable; record meaningful gaps in `## Follow-ups` or a risk note.

Canonical truth is Markdown. SQLite/cache data stores only rebuildable indexes, symbol projections, relations, and bounded context packages. Deleting `.cache/` must never delete authored truth.

`state.md` and the semantic index use two-tier freshness checks. Matching path/stat watch fingerprints avoid rereading unchanged sources; any metadata drift falls back to complete content hashing. A cache schema mismatch rebuilds the disposable index once. Watch metadata is only an optimization and never authority.

`vault.local.md`, migration backups, and caches are local-only. Their values never appear in logs, history, reviews, memory, reports, commits, or normal responses.

## Authority and read policy

Apply project context in this order:

1. owner/system instructions;
2. universal method invariants in this guide and `SPEC.md`;
3. `guardrails.md`;
4. relevant confirmed Decisions and approved Knowledge;
5. active Feature, Task, Sprint, and Run;
6. relevant history and evidence;
7. generated `state.md`, `map.md`, and cache projections.

Normal read path:

1. `AGENTS.md`;
2. `.scrumrun/guardrails.md`;
3. `.scrumrun/state.md` — the **briefing**: a bounded summary of active work, recent completions with their technical summaries, open decisions, active memory, the backlog queue, and pointers;
4. only the canonical ids and evidence relevant to current work;
5. `.scrumrun/core.md` when method details or exceptional transitions are needed.

The briefing is a progressive-disclosure index, not full context. Read it first and follow its pointers to specific artifacts (`## Where to look`, `scrumrun knowledge study "<topic>"`). Go deeper — a Task body, a Run ledger, a Decision — only when the briefing lacks what you need. Never treat the briefing as a substitute for the canonical artifact it points to.

Lean mode is this bounded read policy; it is not permission to omit canonical truth.

`guardrails.md` is the sole canonical project-policy file. `golden-rules.md` is a v1 migration source/compatibility pointer, not a competing authority. `config.md` stores interaction preferences and cannot weaken guardrails.

## Request lifecycle

Everything before approval is transient and read-only:

```text
USER REQUEST
     ↓
RECEIVED
     ↓
CONTEXTUALIZING
  ├── Project Scan
  ├── History Engine
  └── Decision Engine
     ↓
CONTEXT PACKAGE
     ↓
POLICY ENGINE
     ↓
RISK ASSESSMENT
     ↓
CLASSIFICATION
     ↓
PLANNING
     ↓
AWAITING APPROVAL
```

Intake must:

1. understand outcome, urgency, scope, risk, uncertainty, and current-work relationship;
2. retrieve only relevant project/code/history/decision evidence;
3. apply guardrails before making a recommendation;
4. classify as standalone Task, Sprint batch, Feature, discovery, fix Task, backlog Task, quick Task, or reject/defer;
5. recommend one route and, in guided mode, at most two useful alternatives;
6. ask one explicit approval question before execution; config may change presentation, never remove the gate.

Policy evaluation is structured per active `GR-NNN`: `passed`, `blocked`, or `deferred`. A block must cite the exact Guardrail id and reason code. Deferred checks must be visible in the plan and re-evaluated at their named execution boundary; they are never silently counted as passed. Invalid/duplicate Guardrails or configuration that weakens approval block conformance and intake.

The agent may assert the classification explicitly with `scrumrun plan intake "…" --type fix|task|feature|docs|discovery`, overriding keyword inference (validated, with a stable reason). It may also attach a short technical explanation with `--preview "…"`, rendered in the pretty terminal layout, bound into the approval token, and stored as `## Preview` on the Task.

Before approval, do not create canonical files, update status, edit application code, or retain request content outside ignored disposable context cache. The approval token binds both canonical context and the workspace fingerprint; drift in either requires a new intake. Ambiguous acknowledgement is not approval.

## Execution lifecycle

Explicit approval authorizes direct source and Markdown work. The normal lifecycle is a human-readable Task handoff:

```text
understand → approve → work → validate required criteria → hand off
```

Rules:

- a Task carries the intended scope, `## Acceptance Criteria`, `## Technical Summary`, and relevant `## Follow-ups`;
- validation matches risk and acceptance criteria; tests, reviews, and environments are gates only when explicitly required by the owner, the Task, or an active Guardrail;
- direct Markdown workflow never blocks on Run linkage, status syntax, stale generated views, or missing optional coverage. If an optional check matters, record it as a follow-up/risk instead of fabricating failure;
- configured reviews run only when a Guardrail requires one;
- a structured Run may be created for audit/release work. When used, it follows `executing → validating → learning → completed|failed|blocked` and preserves prior attempts;
- strict permits, workspace-drift checks, and append-only Guardrail obligations apply only to that optional strict audit path;
- learning proposes memory candidates when work reveals reusable context and never auto-confirms AI inference;
- complete a Sprint only when its included Tasks meet its real exit gate;
- do not mark work complete merely because time or token budget ended.

Canonical mutations are schema-validated, lossless, and atomic. Preserve unknown fields, prose, and unrelated owner edits. A failed mutation must leave canonical state unchanged or recoverable.

Task/Run pair mutations use an ignored durable journal under `.scrumrun/.backup/transactions/`. A captured failure rolls back immediately; an interrupted `prepared` transaction is rolled back before the next approved mutation, while an interrupted `committed` transaction is verified and finalized. Audit only reports `TRANSACTION_PENDING`. Recovery writes occur only when the approved operation is retried or `doctor --recover` is explicitly invoked, and recovery refuses to overwrite bytes that match neither side of the journal.

### Backlog and sequencing

Backlog is the queue of Tasks that are intentionally parked. The briefing may name the next one, but an explicit owner request/approval starts work; no CLI state transition is required.

### Agent identity and assignment

Each agent declares an identity via the `SCRUMRUN_AGENT` environment variable or the `Agent Identity:` field in `config.md` (single-agent default). The identity is recorded as the `assignee` on approved/started Tasks and as the `actor` on Run events. In `--shared` teams, every agent sets its own `SCRUMRUN_AGENT` and reads the briefing's `## Now` to see who owns each active Task before picking up work; file locks and the transaction journal prevent corruption on concurrent edits.

## Semantic memory

### Knowledge

Verified descriptive facts about the project. Only `approved` Knowledge may guide execution as truth.

### Decision

Normative constraints such as “pricing calculations must remain on the backend.” Decisions carry status, scope, evidence/source, validity conditions, and review triggers.

### Insight

Explanatory context such as placement rationale, tradeoff, business rule, failure history, performance reason, security reason, usage warning, or testing note. Insights are not automatically Decisions.

AI extraction creates `candidate` Insights. Confirmation requires explicit human approval or trusted evidence. Supported states are `candidate`, `confirmed`, `stale`, `deprecated`, and `invalidated`.

### Dossier

A durable evidence bundle about a topic/module, with last-verified source/commit and staleness information.

Useful graph relations include:

```text
defined_in
depends_on
used_by
constrained_by
introduced_by
modified_by
has_insight
protected_by
```

Context retrieval must explain why a record matched and label stale evidence. Invalidated/rejected memory is preserved for audit but never injected as active truth.

## Migration contract

Migration is explicit:

```text
scrumrun migrate --to 2 --dry-run
scrumrun migrate --to 2 --apply
scrumrun migrate --to 2 --rollback
```

- ordinary install/update never inspects or applies a migration; only explicit `update --migrate` performs and applies its verified migration plan;
- early v2 Run prose is also preflighted read-only and upgraded explicitly to ledger schema 1 with byte-exact backup and safe rollback;
- dry-run writes no project data;
- apply inventories source hashes, creates a byte-exact local backup, transforms in staging, validates, and activates by atomic directory swap;
- incomplete hybrid v1/v2 trees reuse existing evidenced canonical relations instead of creating duplicate Tasks/Runs;
- legacy-only aggregates leave the active v2 tree after apply and remain byte-exact in the ignored backup;
- the mapping report relates every inferred v1 block to its v2 destination while every original file remains covered by the backup inventory;
- replay is idempotent;
- ambiguous mappings are preserved and warned, never guessed;
- vault contents remain unchanged and are never rendered;
- rollback verifies the backup and refuses if it would erase post-migration work.

Legacy sprint plan entries normally become Tasks. History attempts become Runs when a Task link is evidenced. A v2 Sprint is created only with actual timebox/batch evidence. Feature lanes become Features; backlog entries become backlog Tasks; fixes become fix Tasks; Knowledge states are preserved; extracted Insights remain candidates; golden rules become stable-id Guardrails.

## Command reference

### `scrumrun plan`

- `task --add|--list|--show|--run|--audit|--cancel|--retry|--next|--start [TASK-NNN]`
- `sprint --add|--list|--show|--start|--complete|--block`
- `feature --add|--list|--show|--activate|--complete`
- `run --list|--show|--render|--stats|--normalize-legacy|--authorize-mutation|--record-mutation|--satisfy-guardrail|--validate|--learn|--complete [--summary "…"]|--resume|--fail|--block`
- `intake <request> [--type fix|task|feature|docs|discovery] [--preview "…"]`
- `challenge <question>`

### `scrumrun knowledge`

- `fact --add|--list|--show|--approve|--reject|--deprecate|--invalidate`
- `decision --add|--list|--show|--resolve|--deprecate|--invalidate`
- `insight --propose|--list|--show|--confirm|--stale|--reject|--deprecate|--invalidate`
- `dossier --add|--list|--show|--refresh|--stale|--deprecate|--archive`
- `context --build|--update|--show|--clear`
- `map --build|--show`
- `study <focus>`
- `vault --add|--list|--show|--remove|--path`

### `scrumrun rules`

- `guardrail --add|--list|--show|--retire`
- `reviewer --add|--list|--show|--run`

### `scrumrun review`

- `code --run`
- `artifact --run`
- `migration --run`
- `release --run`

Review is read-only unless fixes are separately authorized. Report findings by severity with evidence.

### `scrumrun config`

- `project --show|--language|--interaction|--approval|--quick-tasks`
- `init --local|--shared|--force`
- `update all|codex|opencode|claude [--migrate]`
- `migrate --to 2 --dry-run|--apply|--rollback`
- `doctor all|codex|opencode|claude [--strict]`
- `uninstall --force`
- `help <topic>`

## Stable invariants

- Intake is read-only.
- No execution without explicit valid approval.
- Guardrails cannot be bypassed; they may only be superseded/retired with history.
- Active Guardrails produce explicit passed/blocked/deferred evaluations; blocks cite stable ids and deferred checks remain visible until their execution gate.
- Material mutations require path-scoped permits and append-only hash evidence; completion fails closed on policy/workspace drift or unresolved obligations.
- Task is atomic; Sprint is grouping; Run is an attempt.
- Retries preserve prior Runs.
- History is append-only.
- Only approved/confirmed, non-stale memory guides work as truth.
- AI proposals never self-confirm.
- Generated views/caches never override canonical Markdown.
- Vault values never leave the local vault boundary.
- Migration never guesses or runs implicitly; `update --migrate` is explicit migration approval.
- Review does not imply authorization to fix.
