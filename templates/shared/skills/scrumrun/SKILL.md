---
name: scrumrun
description: Use when initializing or migrating ScrumRun, handling product requests, planning or executing Tasks/Sprints/Features/Runs, managing guardrails or semantic memory, checking status, and running reviews.
---

# ScrumRun 2.0

ScrumRun is an evidence-driven Agile runtime for AI agents. Its canonical shell command is:

```text
scrumrun <noun> <subject> <action> [args]
```

The five nouns are `plan`, `knowledge`, `rules`, `review`, and `config`. `/sc` is an optional AI-client shortcut; `scrumrun sc ...` is a compatibility alias. If the command is incomplete, show only the valid next tokens and do not guess.

When a project contains `.scrumrun/`, use ScrumRun for product work even if the user did not type `/sc`. Natural-language work begins as `plan intake`.

## Authority and minimum reads

Apply instructions in this order:

1. system and owner instructions;
2. universal method invariants in `core.md`/`SPEC.md`;
3. `.scrumrun/guardrails.md`;
4. relevant confirmed Decisions and approved Knowledge;
5. active Task, Sprint, Feature, and Run;
6. relevant history and evidence;
7. generated `state.md`, `map.md`, and cache views.

Normal hot path:

1. read `.scrumrun/method.json` — its `paths` block is the authoritative index of every canonical location; navigate by that index and never grep for legacy paths (`goals/`, `backlog.md`, `sprint.md`, `history.md`);
2. read `AGENTS.md`;
3. read `.scrumrun/guardrails.md`;
4. read `.scrumrun/state.md` — the **briefing**: active work, recent completions with their technical summaries, open decisions, active memory, backlog queue, and pointers;
5. follow the briefing's pointers to only the relevant canonical artifacts; go deeper only when the briefing lacks what you need (`## Where to look`, `scrumrun knowledge study "<topic>"`);
6. load `.scrumrun/core.md` when the method contract or an exceptional transition is needed.

**Never write Run events by hand.** Work directly in code and the linked Task Markdown after approval, then let the one final CLI checkpoint mutate `runs/RUN-NNN.md`: `scrumrun plan run --finalize RUN-NNN`. It creates the validated transition ledger, audits the full workspace delta, and records the Guardrail results together. Do not invoke `npx scrumrun@latest` during normal execution. The older `--validate | --learn | --complete | --satisfy-guardrail | --authorize-mutation | --record-mutation` commands remain only for owner-requested strict mode. Recover hand-written Runs via `scrumrun plan run --normalize-legacy` — originals are preserved byte-exact under `.scrumrun/.migration-backup/runs/`.

**Never hand-edit canonical planning Markdown.** Before a Task starts, refine it with `scrumrun plan task --amend TASK-NNN`; use title/request/acceptance/relation options or generic repeated `--section "Heading=content"`. Feature and Sprint support the same `--amend` pattern. Runs, Reviews, confirmed memory, and Guardrails are append-only evidence/policy, so record a new event or supersede them instead of rewriting them.

Lean mode is a read policy, not an incomplete store. Generated files and `.scrumrun/.cache/` are never authoritative.

Generated state and semantic indexes use a metadata-watch fast path with a full content-hash fallback. Treat cache-schema mismatch as a request to rebuild the disposable projection, never as permission to rewrite canonical Markdown.

For a v1 project without canonical v2 artifacts, use the dual-layout reader conceptually and recommend `scrumrun migrate --to 2 --dry-run`. `update` may run that read-only preflight automatically, but only explicit `update --migrate` may apply it.

## Domain model

- Feature (`FEAT-NNN`) — why: long-lived initiative/product context.
- Task (`TASK-NNN`) — what: atomic intended work; may be independent of a Sprint.
- Sprint (`SPRINT-NNN`) — when: real timebox or delivery batch grouping Tasks.
- Run (`RUN-NNN`) — how: one concrete execution attempt for a Task.
- Memory — what was learned and why: `K-NNN`, `DEC-NNN`, `INS-NNN`, and dossiers.
- Review (`REV-NNN`) — evidence from a scoped quality gate.

Never create a Sprint merely because work exists. A standalone Task is valid. A retry creates a new Run and preserves the failed/blocked prior Run.

## Request pipeline

Before approval, remain read-only:

```text
RECEIVED
  → CONTEXTUALIZING (Project Scan + History + Decisions)
  → CONTEXT PACKAGE
  → POLICY
  → RISK
  → CLASSIFICATION
  → PLANNING
  → AWAITING_APPROVAL
```

At intake:

1. identify outcome, urgency, scope, risk, uncertainty, and relationship to active work;
2. retrieve only evidence relevant to the request;
3. apply guardrails before recommending action;
4. classify as Task, Sprint batch, Feature, discovery, fix Task, backlog Task, quick Task, or reject/defer;
5. recommend one route and at most two useful alternatives in guided mode;
6. ask one explicit approval question before execution; config may change presentation, never remove the gate.

Evaluate every active Guardrail into a structured `passed`, `blocked`, or `deferred` result. Report blocked results with the exact `GR-NNN` id and reason code. Keep deferred results visible and enforce them at the mutation, migration, review, or owner gate they identify; never describe a deferred check as passed.

Assert the classification explicitly when the keyword inference is wrong: `scrumrun plan intake "…" --type fix|task|feature|docs|discovery`. Attach a short technical explanation before approval with `--preview "…"` (rendered in the terminal, bound into the token, stored as `## Preview` on the Task).

Do not create canonical artifacts, change status, edit application code, or treat ambiguous acknowledgement as approval. Temporary context may exist only in ignored disposable cache.

The approval token binds both canonical context and a complete workspace fingerprint. Any canonical or source change after planning invalidates it and requires a new intake.

## Approved execution

Explicit approval creates/updates the Task and creates a Run. The Run follows:

```text
executing → validating → learning → completed
                     ↘ failed | blocked
```

During execution:

1. keep the change inside the approved Task scope;
2. preserve existing owner work and unrelated dirty files;
3. define or confirm the Task's `## Acceptance Criteria` before execution and check them off as evidence;
4. work normally: edit code and update the Task's `## Technical Summary` and, for non-automatic rules, `## Guardrail Evidence` as evidence becomes available;
5. validate in proportion to risk and against the acceptance criteria;
6. run configured reviewers when a Guardrail requires one;
7. finish once with `scrumrun plan run --finalize RUN-NNN`; it verifies every changed path, policy, secret boundary, and guardrail evidence before creating the structured Run events and completing the Task;
8. use path-scoped Mutation Gateway commands only when the owner explicitly requests strict execution.

Never overwrite a prior attempt. Never mark work complete because time/token budget ended.

When a Run completes and work remains queued, the briefing's `## Next Up` names the next backlog Task. Surface it with `scrumrun plan task --next` and start it with `scrumrun plan task --start [TASK-NNN]` — starting is the explicit approval; the owner can always decline. Each agent declares its identity via `SCRUMRUN_AGENT` (or `Agent Identity` in `config.md`); it is recorded as the Task `assignee` and the Run event `actor`.

Every deferred policy result is an append-only Run obligation. The final checkpoint fails closed on policy drift, protected-path changes, unsafe symlinks, unscannable content, newly introduced secret-like content, or missing Guardrail Evidence. In strict mode it additionally requires the permit chain. The ignored permit cache is disposable; deleting it invalidates outstanding strict-mode permits and never creates authority.

Run is the sole operational-history authority. Task synchronizes current status without copying Run events. Validation, learning, completion, failure, block, and resume require a reason or structured evidence; completion also requires evidenced validation and learning. Early v2 prose Runs are migrated explicitly, with deterministic chains recovered and uncertain history represented as an evidenced snapshot.

Linked canonical writes use the ignored durable transaction journal. An interrupted prepared mutation rolls back before the next approved mutation; a committed journal is verified and finalized. Audit remains read-only and reports pending recovery. Use `doctor --recover` only when explicitly requested, and never overwrite bytes changed after interruption.

## Semantic memory

Canonical memory is Markdown:

- Knowledge is verified project fact.
- Decision is normative: what must/must not be done and under which validity conditions.
- Insight is explanatory context, tradeoff, warning, failure history, placement rationale, or business reason.
- Dossier is a topic-focused evidence bundle.

SQLite under `.scrumrun/.cache/` is derived only. Deleting it must not delete authored memory.

AI-proposed knowledge and insights start as `candidate`. Confirmation requires human approval or explicit trusted evidence. Each active memory record should carry source/evidence, confidence where useful, validity conditions, review triggers, and invalidation state. Never inject stale, deprecated, rejected, or invalidated memory as active truth.

Useful relations include `defined_in`, `depends_on`, `used_by`, `constrained_by`, `introduced_by`, `modified_by`, `has_insight`, and `protected_by`. Explain recommendations with those relations and cite evidence.

## Guardrails

`.scrumrun/guardrails.md` is the sole canonical project-policy artifact in v2. `golden-rules.md` is a v1 compatibility source only.

- Guardrails are mandatory, stable-id, append-preserving policies.
- Fresh v2 rules declare `Status`, `Enforcement`, `Scope`, and `Rule`; migrated prose may use deterministic enforcement inference until normalized.
- Duplicate ids, unknown enforcement, inactive-only policy, and configuration that weakens approval are conformance failures.
- Retire/supersede a rule; do not silently delete policy history.
- `config.md` stores preferences, never higher-priority safety policy.
- Never commit or print vault values.
- Canonical Markdown writes must be lossless, validated, and atomic.
- Preserve unknown fields/prose and create recovery evidence for risky mutations.

## Migration

Use only explicit commands:

```text
scrumrun migrate --to 2 --dry-run
scrumrun migrate --to 2 --apply
scrumrun migrate --to 2 --rollback
```

Inside a v1 project, `scrumrun update` runs a read-only preflight. `update --migrate` explicitly approves application of that verified plan and keeps rollback available.

Dry-run must not write project data. Apply requires a hashed inventory, byte-exact local backup, staged validation, atomic switch, mapping report, and idempotent replay. Incomplete hybrid trees reuse existing evidenced v2 relations rather than duplicating them; early v2 prose Runs upgrade to ledger schema 1 only through the same explicit apply gate. Legacy-only aggregates leave the active tree but remain byte-exact in the ignored backup. Ambiguous records are preserved as warnings or evidenced snapshots, never guessed. Vault content remains local and is never rendered. Rollback must refuse if it would erase post-migration changes.

## Command grammar

### `scrumrun plan`

- `task`: add/amend/list/show/run/audit/cancel/retry atomic work; use `--amend TASK-NNN` before it starts to refine planning truth without hand-editing Markdown. Use `type: fix` for fixes and `status: backlog` for parked work. `--next` surfaces the oldest backlog Task; `--start [TASK-NNN]` promotes it and creates its first Run.
- `sprint`: add/amend/list/show/start/complete/block a real Task batch/timebox.
- `feature`: add/amend/list/show/activate/complete long-lived initiatives.
- `run`: list/show/render/stats/normalize-legacy/authorize-mutation/record-mutation/satisfy-guardrail/validate/learn/complete/resume/fail/block concrete Task attempts. `--complete` accepts `--summary "…"` to store a technical summary.
- `intake <request>`: execute the read-only request pipeline; accepts `--type fix|task|feature|docs|discovery` and `--preview "…"`.
- `challenge <question>`: deep read-only analysis with evidence, risks, options, and recommendation.

### `scrumrun knowledge`

- `fact`: add/list/show/approve/reject/deprecate/invalidate `K-NNN` records.
- `decision`: add/list/show/resolve/deprecate/invalidate `DEC-NNN` records.
- `insight`: propose/list/show/confirm/stale/reject/deprecate/invalidate `INS-NNN` records.
- `dossier`: add/list/show/refresh/stale/deprecate/archive topic dossiers.
- `context`: build/update/show/clear the bounded disposable context view.
- `map`: build/show the generated project/relationship map.
- `study <focus>`: deep read-only discovery with precise evidence.
- `vault`: add/list/show/remove/path for explicitly requested local development values; list redacts values.

### `scrumrun rules`

- `guardrail`: add/list/show/retire project rules. Adding/retiring requires explicit approval.
- `reviewer`: add/list/show/run configured review roles.

### `scrumrun review`

- `code --run`: review code changes by severity with file/line evidence.
- `artifact --run`: validate method artifacts and relations.
- `migration --run`: validate source coverage, hashes, rollback, and ambiguity.
- `release --run`: validate package, version, changelog, tags, registry, and recovery path.

Review is read-only unless the user separately authorizes fixes.

### `scrumrun config`

- `project`: show/set language, interaction, approval, and quick-task preferences.
- `init`: initialize ScrumRun without overwriting existing state silently.
- `update`: refresh integrations and preflight v1 read-only; apply only with explicit `--migrate`.
- `migrate`: invoke the explicit migration workflow.
- `doctor`: verify installed root command and skill content; `--strict` also requires a warning-free project artifact audit, while explicit `--recover` resolves safe pending kernel transactions.
- `uninstall`: preview by default; delete only recognized ScrumRun files with explicit `--force`.
- `help`: show grammar or one focused topic.

## Compatibility

Upgrade installs may provide thin v1 adapters for one release cycle. An adapter must execute the mapped direct route in the same turn and emit one concise deprecation note; it must not merely ask the user to invoke another command.

Important mappings:

- `/sc-sprint` → `scrumrun plan sprint`
- `/sc-fix` → `scrumrun plan task` with `type: fix`
- `/sc-backlog` → `scrumrun plan task` with `status: backlog`
- `/sc-decisions` → `scrumrun knowledge decision`
- `/sc-know` → `scrumrun knowledge fact`
- `/sc-golden` → `scrumrun rules guardrail`
- `/sc-agent` → `scrumrun rules reviewer`

Always generate and recommend the canonical direct CLI grammar.
