# ScrumRun Method Specification

Version: `2.0.0` · Status: stable

`SPEC.md` defines normative meanings and invariants. `lib/v2/schema.js` defines the machine-enforced ids, paths, statuses, transitions, structural relations, and truth ownership metadata; `lib/commands/manifest.js` defines command grammar. `CORE.md` is the operational runtime guide. Generated `docs/SCHEMA.md` must match the executable schema byte-for-byte. A conflict is a conformance failure: semantics defer to SPEC, mechanically enforced values defer to the schema, grammar defers to the command manifest, and the conflicting representation must be corrected.

## 1. Purpose and principles

ScrumRun is an evidence-driven Agile runtime for AI-assisted software work. It keeps intent, execution, decisions, and learning distinct while preserving a small daily interface.

The method is built on five principles:

1. no canonical write before explicit approval;
2. Task is the atomic work unit; Sprint is only a timebox or delivery batch;
3. every execution attempt is a separate Run;
4. Markdown is canonical and generated indexes are disposable;
5. knowledge becomes active truth only through evidence and review.

## 2. Terminology

| Term | Meaning |
|---|---|
| Feature | Long-lived initiative explaining why related work matters. |
| Task | Atomic intended work: what must be changed or learned. |
| Sprint | Explicit timebox or delivery batch grouping Tasks: when work is grouped. |
| Run | One concrete attempt to execute a Task: how it happened. |
| Review | Scoped validation evidence for a Run, artifact, migration, or release. |
| Knowledge | Reviewed project fact. |
| Decision | Explicit normative choice and its evidence. |
| Insight | Contextual explanation, trade-off, warning, or rationale. |
| Dossier | Curated topic/module memory with evidence and review metadata. |
| Guardrail | Mandatory project policy that configuration cannot weaken. |
| Context package | Bounded, temporary evidence assembled for one request. |
| Semantic index | Ignored SQLite projection of canonical artifacts, code symbols, and relations. |

A fix is a Task with `type: fix`. A backlog is a view of Tasks with `status: backlog`; neither is a separate canonical entity.

Exact status sets, transitions, directories, cardinalities, and truth-ownership boundaries are generated in [`docs/SCHEMA.md`](docs/SCHEMA.md); they are not duplicated manually here.

## 3. Canonical project model

```text
.scrumrun/
  core.md
  guardrails.md
  config.md
  project.md
  method.json
  state.md                         # generated view
  map.md                           # generated view
  features/FEAT-NNN.md
  tasks/TASK-NNN.md
  sprints/SPRINT-NNN.md
  runs/RUN-NNN.md
  reviews/REV-NNN.md
  memory/
    knowledge/K-NNN.md
    decisions/DEC-NNN.md
    insights/INS-NNN.md
    dossiers/DOS-NNN.md
  .cache/                          # ignored and disposable
    semantic-index.sqlite
    contexts/
  vault.local.md                   # optional, ignored, never indexed/rendered
```

`guardrails.md` is the only canonical project-policy file. A v1 `golden-rules.md` may remain as migrated source evidence, but it is never a competing v2 authority.

### 3.1 Universal frontmatter

Every canonical entity file must contain:

```yaml
---
id: TASK-018
kind: task
status: running
created: 2026-07-21
updated: 2026-07-21
method: 2.0.0
---
```

IDs, filenames, kind, status, real ISO dates, and method version must agree. Unknown fields and authored prose are preserved. Duplicate fields, malformed frontmatter, unsafe paths, and symlinked canonical paths are invalid.

Relationship lists are valid local frontmatter, for example `depends_on: [TASK-014, DEC-018]` and `guardrails: [GR-004]`. Human-readable `## Related` links use relative Markdown paths. These local IDs and links are the canonical graph; generated indexes only accelerate retrieval.

A Task may carry an optional `assignee` scalar recording the agent identity (`SCRUMRUN_AGENT` or `config.md` `Agent Identity`) that owns the work. It is descriptive metadata, never a competing authority: it does not change status transitions or block conformance.

### 3.2 Stable identifiers

| Kind | Identifier |
|---|---|
| Feature | `FEAT-NNN` |
| Task | `TASK-NNN` |
| Sprint | `SPRINT-NNN` |
| Run | `RUN-NNN` |
| Review | `REV-NNN` |
| Knowledge | `K-NNN` |
| Decision | `DEC-NNN` |
| Insight | `INS-NNN` |
| Dossier | `DOS-NNN` |

Relations use stable IDs or qualified code subjects. Example:

```text
FEAT-003
   └── TASK-018
          ├── executed_by → RUN-044
          ├── included_in → SPRINT-012
          ├── constrained_by → DEC-018
          └── generated → INS-041
```

### 3.3 Run event ledger

A newly authored Run declares `ledger: 1` and owns exactly one append-only operational event stream under `## Events`. Event ids are stable and scoped to the Run (`RUN-044-EVT-001`, `RUN-044-EVT-002`, ...). Each JSON event records a contiguous sequence, RFC3339 timestamp, timestamp precision, actor, source and destination states, reason, and typed evidence.

Native Runs begin with `created → executing`. A migration may instead create one evidenced `snapshot` as the historical baseline when the source proves a recorded status but not its full transition path. A snapshot exposes that uncertainty and never fabricates intermediate states.

The ledger is the execution authority. Task retains approved scope and synchronized current status, but does not copy Run events. Conformance reconstructs the Run state from its ledger and rejects missing or duplicate ids, invalid ordering, time reversal, illegal transitions, frontmatter drift, missing evidence, and unevidenced completion.

## 4. State machines

Only the following transitions are valid.

### Feature

```text
backlog → proposed|active|cancelled
proposed → active|cancelled
active → paused|completed|cancelled
paused → active|cancelled
```

### Task

```text
backlog → proposed|running|cancelled
proposed → running|cancelled
running → validating|failed|blocked|cancelled
validating → learning|failed|blocked
learning → completed|failed|blocked
partial|failed|blocked → running|cancelled
```

### Sprint

```text
proposed → running|cancelled
running → partial|completed|blocked|cancelled
partial → running|completed|cancelled
blocked → running|cancelled
```

### Run

```text
executing → validating|failed|blocked
validating → learning|failed|blocked
learning → completed|failed|blocked
partial → executing|failed|blocked
blocked → executing|failed
```

A failed or blocked Run is never reused as a new attempt. Retrying its Task creates a new `RUN-NNN` with an incremented attempt and preserves the previous Run byte-for-byte.

### Review and memory

```text
Review:    proposed → running; running → passed|failed
           failed → running|archived; passed → archived
Knowledge: candidate → approved|rejected; approved → deprecated|invalidated
           rejected → candidate; deprecated → approved
Decision:  open → resolved|deprecated|invalidated; resolved → deprecated|invalidated
           deprecated → open
Insight:   candidate → confirmed|invalidated
           confirmed → stale|deprecated|invalidated
           stale → confirmed|deprecated|invalidated; deprecated → confirmed
Dossier:   active → stale|deprecated|archived; stale → active|deprecated|archived
           deprecated → archived
```

Confirmation/resolution requires at least one resolvable evidence reference. An active Dossier requires evidence at creation; refreshing an already active Dossier records verification without changing its state. AI extraction may create candidates only.

## 5. Request and execution protocol

```text
RECEIVED
  → CONTEXTUALIZING (Project Scan + History Engine + Decision Engine)
  → CONTEXT_PACKAGE
  → POLICY
  → RISK
  → CLASSIFICATION
  → PLANNING
  → AWAITING_APPROVAL
  → EXECUTING
  → VALIDATING
  → LEARNING
  → COMPLETED | FAILED | BLOCKED
```

Everything through `AWAITING_APPROVAL` is read-only. It may exist in process memory or ignored cache only. A valid approval token binds the normalized request, policy result, classification, risk, issuance time, canonical context fingerprint, and complete workspace fingerprint. Canonical or source drift after planning invalidates approval.

Approval authorizes work after the read-only planning pass. In Markdown-first mode, a Task and optional Run may be created or updated directly; their absence or imperfect administrative metadata never prevents approved work. The CLI's atomic Task/Run creation remains an optional strict/audit path. Tests, reviews, and environments are completion gates only when explicitly required by the owner, the Task's `## Done when` contract, or an active Guardrail; missing optional coverage is a documented follow-up/risk, not a failure by itself.

An approved Task executes continuously to its delivery contract. An agent must not end a work turn merely to provide inventory, decomposition, progress, or a list of remaining implementation work. Those are internal execution steps. It may stop only for an owner decision, external access, an active Guardrail, secret/security risk, destructive work without approval, or an unmet required contract item. `## Follow-ups` may contain only work outside `## Done when`; moving required work there requires explicit owner approval.

When a structured Run is explicitly chosen, it binds the exact Guardrail-policy fingerprint and workspace baseline. Strict audit then verifies the complete delta: policy freshness, read-only boundaries, symlink safety, scannability, newly introduced secret-like content, and evidence for every Guardrail. Strict teams may opt into short-lived, path-scoped permits and per-edit recording. This audit path is never a prerequisite for ordinary Markdown-first execution.

The agent may assert the classification explicitly (`--type fix|task|feature|docs|discovery`), overriding keyword inference with validation and a stable reason. It may attach a short technical preview (`--preview`), rendered in the terminal, bound into the approval token, and stored as `## Preview` on the approved Task. A Task normally declares a concise `## Done when` contract before execution, but owner-defined Markdown sections remain valid; completion is measured against the agreed delivery contract, never against elapsed time or token budget.

When a structured Run is used, CLI transitions synchronously update the linked Task and append one event to its ledger. This is an optional audit path, not daily operational authority. Markdown-first completion records the Done when contract, Completion, validation evidence, and Follow-ups directly on the Task. Multi-file CLI mutations use a durable local transaction journal; `doctor --recover` and `repair` remain explicit maintenance operations. Entering learning may extract candidates, but no administrative artifact failure blocks approved work.

Backlog is a queue view of intentionally parked Tasks, ordered oldest-first by id. CLI `--next`/`--start` helpers may create a structured Run when wanted, but an explicit owner approval is the only daily-work start gate.

## 6. Policy and precedence

When guidance conflicts, apply this order:

1. current explicit owner constraints;
2. universal method invariants in `core.md`/this specification;
3. active project Guardrails;
4. resolved Decisions and confirmed, non-stale Memory relevant to the subject;
5. the approved Task and active Run;
6. Sprint/Feature grouping context;
7. generated `state.md`, `map.md`, context packages, and indexes as navigation only.

Configuration controls preferences but cannot weaken higher levels. Missing or stale context must be surfaced, never rendered as certainty.

Every project Guardrail has a stable `GR-NNN` identity, lifecycle status, rule text, enforcement mode, and optional scope/source. Intake evaluates active Guardrails into structured `passed`, `blocked`, or `deferred` results. A block names the responsible Guardrail and machine-readable reason code; a deferred result is shown explicitly and must be enforced at the mutation, migration, review, or owner gate it names. Deferred checks do not become evidence of a pass.

Secret-like content detection is canonical-policy-level and applies to every artifact, evidence, intake payload, and source file outside the local vault. Owners may exempt specific **non-canonical descriptive paths** from the keyword heuristic through `config.md` frontmatter `allow_secrets_in: [paths...]` (exact paths, directory prefixes ending in `/`, or glob patterns). Canonical artifacts (Task, Sprint, Run, Feature, Review, Memory) are never eligible for the allowlist: a secret in a canonical file always fails conformance. Exemption never applies to high-confidence shapes (`sk-…`, `AKIA…`, JWT, PEM private keys, long bearer tokens) regardless of path. The allowlist is recorded as evidence of an explicit owner decision and is reviewed by `doctor`.

The executable Policy Engine may infer enforcement for migrated prose, but fresh v2 policy declares it explicitly. Unknown enforcement, duplicate ids, inactive-only policy, configuration that disables approval, and unsafe read-only paths fail conformance. Configuration can tune presentation and workflow preferences; it cannot retire, bypass, or weaken active Guardrails.

## 7. Semantic memory and code intelligence

Memory records include subject, source, evidence, validity window, confidence where useful, review trigger, and last-verified commit. Insight types may include placement rationale, design constraint, known trade-off, failure history, usage warning, compatibility reason, business rule, performance reason, security reason, and testing note.

The derived graph may contain:

```text
defined_in
depends_on
used_by
protected_by
constrained_by
introduced_by
modified_by
has_insight
evidenced_by
```

JavaScript/TypeScript symbols carry a qualified id, path, kind, line, content fingerprint, commit, and adapter identity. A move with the same fingerprint may be remapped. A rename/removal that cannot be proved is retained as orphaned context. Code or evidence drift marks linked memory stale in the projection; it never silently rewrites canonical Markdown.

Queries must explain content/relation matches, return evidence/provenance, distinguish candidate/confirmed/stale/inactive/orphaned truth, cap result and relation counts, and exclude rejected/deprecated/invalidated records by default.

The agreed v1 control-context baseline is 48,000 characters. A fresh lean v2 intake control package, excluding the user's request, must remain at or below 12,000 characters (25%). Default semantic retrieval returns at most 10 records and 40 relations per record; hard caps are 100/100.

## 8. Generated views and cache

`state.md`, `map.md`, context packages, and `.cache/semantic-index.sqlite` are non-authoritative projections. They carry source fingerprints or are treated as stale. `state.md` uses the exact canonical fingerprint bound into intake, plus a projection schema, RFC3339 generation time, and a disposable watch fingerprint. SQLite stores its source and watch fingerprints with an explicit cache schema.

`state.md` is the **briefing**: a bounded, progressive-disclosure index of active work (with each Task's `assignee`), recent completions (with their technical summaries), open decisions, active memory, and the backlog queue, plus pointers to deeper artifacts. Agents read the briefing first and follow its pointers, going deeper only when the briefing lacks what they need. The briefing is a convenience view, never authority; a canonical artifact the briefing summarizes remains the source of truth.

Freshness checks use a two-tier strategy: unchanged path/stat identity proves that no source read or reparse is needed; changed metadata triggers a complete canonical/source content fingerprint before staleness is asserted. Cache metadata may optimize verification but never supplies project truth. A cache-schema mismatch forces one disposable rebuild. Deleting `.cache/` must not remove authored knowledge, and rebuilding it from unchanged sources must yield equivalent query results.

The index must never scan or store `vault.local.md`. Source scanning is bounded, skips dependencies/build output and symlinks, and uses replaceable language adapters.

## 9. Migration from v1

Migration is explicit and reversible:

```text
scrumrun migrate --to 2 --dry-run
scrumrun migrate --to 2 --apply
scrumrun migrate --to 2 --rollback
```

`scrumrun update` refreshes integrations only. `update --migrate` is the explicit request to inspect and apply the verified migration plan; migration is never implicit.

Inside an early v2 project, the same commands preflight and explicitly upgrade legacy Run prose to ledger schema 1. Deterministic transition chains are recovered; incomplete history becomes an evidenced snapshot. Apply keeps byte-exact ignored backups, verifies hashes, is idempotent, and supports rollback that refuses to erase later Run changes.

The migrator must:

- hash every source file and block;
- keep a byte-exact ignored backup;
- transform in staging and validate before an atomic switch;
- map each source block to a destination or explicit warning;
- preserve original v1 files byte-exactly in the ignored backup while removing legacy-only aggregates from the active v2 tree;
- detect incomplete hybrid v1/v2 layouts and reuse proven canonical Task/Sprint/Run relations instead of duplicating them;
- normalize only deterministic schema aliases and require resolvable evidence for active migrated memory;
- be idempotent;
- reject symlinks, malformed markers, ambiguous destructive guesses, and concurrent source changes;
- rollback only when doing so cannot erase post-migration work.

Legacy sprint entries become Tasks. History entries become Runs only with an evidenced Task relation. A Sprint is created only from real grouping/timebox evidence. Feature lanes become Features, fixes become `type: fix` Tasks, backlog items become backlog Tasks, extracted insights remain candidates, and golden rules become stable-id Guardrails.

## 10. Normative invariants

- **I-01** No canonical artifact or code write occurs before explicit approval.
- **I-02** The optional strict CLI approval path creates a linked Task/Run pair atomically or creates nothing; Markdown-first approval remains human-authorized and non-blocking.
- **I-03** Task is atomic work; Sprint only groups Tasks with real batch/timebox evidence.
- **I-04** Every retry creates a new Run and preserves earlier attempts.
- **I-05** Only declared, ordered, evidenced state transitions are accepted; Run event ids are unique and paired transitions are recoverable.
- **I-06** `guardrails.md` is canonical project policy and configuration cannot weaken it.
- **I-07** Markdown is canonical; SQLite and generated views are disposable projections.
- **I-08** AI-created facts/insights remain candidates until explicit human confirmation.
- **I-09** Confirmed claims have resolvable evidence and review metadata.
- **I-10** Rejected, deprecated, and invalidated memory is auditable but not active truth; stale memory is labeled.
- **I-11** Vault values never enter context, artifacts, indexes, reports, logs, commits, or approval tokens.
- **I-12** Canonical artifacts have valid, matching id/kind/status/date/method frontmatter.
- **I-13** Missing/stale projections are surfaced and never treated as authoritative.
- **I-14** Context and semantic retrieval are bounded and explain why evidence matched.
- **I-15** Migration is explicit; dry-run and ordinary update perform no project writes.
- **I-16** Migration preserves hashed source coverage, backup, mapping, idempotency, and safe rollback.
- **I-17** Migration warnings preserve ambiguity; they never invent Sprints, Runs, approval, or truth.
- **I-18** Partial/interrupted writes, conflicting overwrites, unsafe paths, and symlink traversal fail or recover without corrupting canonical state or overwriting later owner work.
- **I-19** Code intelligence is derived, adapter-based, fingerprinted, and cannot silently confirm memory.
- **I-20** Post-validation learning proposes candidates and never blocks Task/Run completion.
- **I-21** Material mutations are policy-bound, path-scoped, hash-verified, append-only, and fail closed on bypass; unresolved Guardrail obligations block completion.
- **I-22** The semantic index's declared search backend must match the runtime capabilities of the current Node.js SQLite build; conformance flags a mismatch instead of relying on lazy runtime fallback.
- **I-23** `method.json` declares the canonical path index for every artifact family so agents navigate by declaration, not by search. Missing or drifted paths fail conformance; grep and directory scans are fallbacks, never the first step.
- **I-24** Runs are only mutated through the CLI. A canonical Run whose ledger fails validation is a bypass — conformance reports `RUN_WRITE_BYPASS` with a pointer to the recovery command `scrumrun plan run --normalize-legacy`, which collapses the bad ledger into a single `snapshot` event and preserves the byte-exact original under `.scrumrun/.migration-backup/runs/`.

## 11. Command grammar

The only canonical root is:

```text
scrumrun <noun> <subject> <action> [args]
```

Exactly five nouns exist: `plan`, `knowledge`, `rules`, `review`, and `config`. The implementation manifest is the command source of truth for help and client adapters. The installed direct CLI is canonical; `/sc` and generated v1 aliases may remain as compatibility shortcuts for one release cycle and must execute the canonical route.

Unknown syntax fails deterministically and never guesses a mutation.

## 12. Conformance and compatibility

An implementation may claim ScrumRun method 2.0.0 only when it:

1. passes positive and negative tests for I-01 through I-24;
2. enforces every exposed state machine and schema;
3. proves read-only intake and dry-run migration through full-tree fingerprints;
4. proves migration failure recovery, rollback safety, and vault exclusion;
5. reconstructs every native Run status from a valid, evidenced ledger and detects tampering;
6. proves cache deletion/rebuild equivalence and inactive-memory filtering;
7. bounds context/retrieval and records benchmark budgets;
8. declares method `2.0.0` and requires Node.js `>=22.13.0` for the native SQLite index.

Method changes follow semantic versioning. Breaking entity, path, invariant, or state changes require a major version and a migration guide.
