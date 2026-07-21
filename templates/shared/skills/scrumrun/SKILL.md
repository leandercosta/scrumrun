---
name: scrumrun
description: Use when initializing or migrating ScrumRun, handling product requests, planning or executing Tasks/Sprints/Features/Runs, managing guardrails or semantic memory, checking status, and running reviews.
---

# ScrumRun 2.0

ScrumRun is an evidence-driven Agile runtime for AI agents. Its canonical command is:

```text
/sc <noun> <subject> <action> [args]
```

The five nouns are `plan`, `knowledge`, `rules`, `review`, and `config`. If the command is incomplete, show only the valid next tokens and do not guess.

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

1. read `AGENTS.md`;
2. read `.scrumrun/guardrails.md`;
3. read `.scrumrun/state.md`;
4. follow the ids/pointers to only the relevant canonical artifacts;
5. load `.scrumrun/core.md` when the method contract or an exceptional transition is needed.

Lean mode is a read policy, not an incomplete store. Generated files and `.scrumrun/.cache/` are never authoritative.

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

Do not create canonical artifacts, change status, edit application code, or treat ambiguous acknowledgement as approval. Temporary context may exist only in ignored disposable cache.

## Approved execution

Explicit approval creates/updates the Task and creates a Run. The Run follows:

```text
executing → validating → learning → completed
                     ↘ failed | blocked
```

During execution:

1. keep the change inside the approved Task scope;
2. preserve existing owner work and unrelated dirty files;
3. enforce guardrails before every material mutation;
4. validate in proportion to risk;
5. record exactly one history event per state transition;
6. run configured reviewers;
7. extract candidate learning only after validation;
8. complete the Run, then Task, and only then the Sprint when its whole batch is done.

Never overwrite a prior attempt. Never mark work complete because time/token budget ended.

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

Inside a v1 project, `npx scrumrun@latest update` runs a read-only preflight. `update --migrate` explicitly approves application of that verified plan and keeps rollback available.

Dry-run must not write project data. Apply requires a hashed inventory, byte-exact local backup, staged validation, atomic switch, mapping report, and idempotent replay. Incomplete hybrid trees reuse existing evidenced v2 relations rather than duplicating them; legacy-only aggregates leave the active tree but remain byte-exact in the ignored backup. Ambiguous records are preserved and warned, never guessed. Vault content remains local and is never rendered. Rollback must refuse if it would erase post-migration changes.

## Command grammar

### `/sc plan`

- `task`: add/list/show/run/audit/cancel/retry atomic work; use `type: fix` for fixes and `status: backlog` for parked work.
- `sprint`: add/list/show/start/complete/block a real Task batch/timebox.
- `feature`: add/list/show/activate/complete long-lived initiatives.
- `run`: list/show/validate/learn/complete/resume/fail/block concrete Task attempts.
- `intake <request>`: execute the read-only request pipeline.
- `challenge <question>`: deep read-only analysis with evidence, risks, options, and recommendation.

### `/sc knowledge`

- `fact`: add/list/show/approve/reject/deprecate/invalidate `K-NNN` records.
- `decision`: add/list/show/resolve/deprecate/invalidate `DEC-NNN` records.
- `insight`: propose/list/show/confirm/stale/reject/deprecate/invalidate `INS-NNN` records.
- `dossier`: add/list/show/refresh/stale/deprecate/archive topic dossiers.
- `context`: build/update/show/clear the bounded disposable context view.
- `map`: build/show the generated project/relationship map.
- `study <focus>`: deep read-only discovery with precise evidence.
- `vault`: add/list/show/remove/path for explicitly requested local development values; list redacts values.

### `/sc rules`

- `guardrail`: add/list/show/retire project rules. Adding/retiring requires explicit approval.
- `reviewer`: add/list/show/run configured review roles.

### `/sc review`

- `code --run`: review code changes by severity with file/line evidence.
- `artifact --run`: validate method artifacts and relations.
- `migration --run`: validate source coverage, hashes, rollback, and ambiguity.
- `release --run`: validate package, version, changelog, tags, registry, and recovery path.

Review is read-only unless the user separately authorizes fixes.

### `/sc config`

- `project`: show/set language, interaction, approval, and quick-task preferences.
- `init`: initialize ScrumRun without overwriting existing state silently.
- `update`: refresh integrations and preflight v1 read-only; apply only with explicit `--migrate`.
- `migrate`: invoke the explicit migration workflow.
- `doctor`: verify installed root command and skill content; `--strict` also requires a warning-free project artifact audit.
- `uninstall`: preview by default; delete only recognized ScrumRun files with explicit `--force`.
- `help`: show grammar or one focused topic.

## Compatibility

Upgrade installs may provide thin v1 adapters for one release cycle. An adapter must execute the mapped `/sc` route in the same turn and emit one concise deprecation note; it must not merely ask the user to invoke another command.

Important mappings:

- `/sc-sprint` → `/sc plan sprint`
- `/sc-fix` → `/sc plan task` with `type: fix`
- `/sc-backlog` → `/sc plan task` with `status: backlog`
- `/sc-decisions` → `/sc knowledge decision`
- `/sc-know` → `/sc knowledge fact`
- `/sc-golden` → `/sc rules guardrail`
- `/sc-agent` → `/sc rules reviewer`

Always generate and recommend the canonical `/sc` grammar.
