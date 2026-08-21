# Changelog

All notable changes follow Semantic Versioning.

## Unreleased

## 2.7.1 - 2026-08-21

### Added

- **Assignee gate on retry** — `sc plan task --retry [--reassign]` now rejects a retry of a Task owned by a different agent identity, preventing two agents from silently taking over each other's failed work. `--reassign` explicitly transfers ownership to the retrier.
- **Path-scoped mutation permits** — the Mutation Gateway now allows concurrent edit permits for non-overlapping paths (`src/a.js` and `src/b.js` in parallel) and rejects only overlapping paths, replacing the previous global "one permit at a time" rule at the authorize step.

### Notes

- The permit **record** step still uses the global workspace fingerprint, so two agents editing disjoint paths can hold permits concurrently but the second record may still surface drift until path-scoped baselines land (a future change touching invariant I-21).

## 2.7.0 - 2026-08-21

### Added

- `scrumrun repair` covers 100% of vidnap-scale legacy drift.

## 2.6.8 - 2026-08-21

### Added

- Comprehensive `scrumrun repair` covering legacy drift end-to-end.

## 2.6.0 - 2026-08-21

### Added

- **Project Briefing** — `state.md` is now a structured briefing (`## Now`, `## Recent`, `## Open Decisions`, `## Active Memory`, `## Next Up`, `## Where to look`) instead of a flat active-work list. It is the progressive-disclosure entry point: agents read the briefing first and only go deeper when it lacks what they need. Recent completions surface their technical summaries so the next agent knows what was just done without reading full ledgers. `buildContextPackage` now includes a `briefing` field.
- **Acceptance Criteria** — every approved Task body gains an `## Acceptance Criteria` section so "done" is defined before execution. Conformance emits a non-blocking `ACCEPTANCE_CRITERIA_MISSING` warning for active Tasks that lack it.
- **Technical Summary** — `sc plan run --complete --summary "…"` stores a `## Technical Summary` section on the Run, surfaced later in the briefing and context package so completed work informs future intake. `appendTechnicalSummary`/`extractTechnicalSummary` are exported for library consumers.
- **`--type` override** — `sc plan intake "…" --type fix|task|feature|docs|discovery` lets the agent assert the classification explicitly, overriding keyword inference with validation and a stable reason.
- **`--preview`** — `sc plan intake "…" --preview "technical summary"` renders a cyan Preview field in the pretty terminal layout (mirroring the landing page), binds it into the approval token, and stores it as `## Preview` on the Task.
- **Auto-sequencing** — `sc plan task --next` surfaces the oldest backlog Task; `sc plan task --start [TASK-NNN]` promotes it to `running`, creates a Run, re-evaluates policy, and records the agent identity. The briefing's `## Next Up` lists the queue.
- **Agent identity and assignment** — `SCRUMRUN_AGENT` env var (or `Agent Identity` in `config.md`) sets the agent identity recorded as the `assignee` on approved/started Tasks and as the `actor` on Run transitions. The briefing shows the assignee next to active work for team visibility.

### Changed

- `state.md` projection schema bumped 1 → 2 (regenerated automatically; the previous format is superseded, never migrated by hand).
- `update` now regenerates the disposable briefing after installing integrations, so upgrading from 2.5.x has no friction with the previous `state.md` format. All other changes are additive (new sections and fields) and do not require migration.

### Validation

- Test suite grew from 192 to 213 passing.

## 2.5.1 - 2026-07-23

### Fixed

- `doctor` no longer crashes on Runs with a null `task` reference. `conformance.js` now guards `repository.read("task", …)` and emits a specific `RUN_TASK_MISSING` finding when `record.task` is `null`, differentiating it from the "task exists but is invalid" case. Affects any project normalized with `sc plan run --normalize-legacy` where the original Run had an unparseable task ref.

## 2.5.0 - 2026-07-23

### Added

- `sc plan run --normalize-legacy [--dry-run]` collapses malformed Run ledgers (invalid `type`, unknown evidence `kind`, missing snapshot invariant, unparseable `task` reference, empty ledger) into a single valid `snapshot` event that preserves the fact of the Run without inventing transitions. Byte-exact originals are moved to `.scrumrun/.migration-backup/runs/RUN-NNN.md` (numbered suffix if a backup already exists). Coherent with ADR-021: ambiguous history becomes evidence, never invented state.
- Invariant **I-24**: canonical Runs must pass ledger validation. Hand-written Runs surface as a `high` `RUN_WRITE_BYPASS` finding in `doctor --strict`, with a pointer to the recovery command.
- New module `lib/commands/normalize-legacy` exposes `normalizeLegacyRuns`, `analyze`, `apply`, `renderReport`, `needsNormalization`, and `scanRuns` for library consumers.
- CORE and the shared SKILL now open with a hard instruction: **never write Run events by hand**. Only the CLI mutates `runs/*.md`. Direct writes produce invalid vocabulary and break conformance; if the CLI does not expose the shape you need, propose a spec change instead of inventing.

### Changed

- Manifest declares `--normalize-legacy` and `--dry-run` on `sc plan run`.
- SPEC.md conformance range extended to `I-01 through I-24`.
- Test suite grew from 184 to 192 passing.

## 2.4.1 - 2026-07-23

### Added

- `sc plan intake` now renders a **pretty terminal layout** in interactive TTYs: a boxed intake pipeline with streaming stages, aligned Classification / Why / Risk / Deferred-guardrails fields, and a highlighted approval-command box that mirrors the LP replay. Zero-dep — pure ANSI + Unicode. Falls back automatically to the existing Markdown summary when stdout is piped, `NO_COLOR` is set, or `--plain` is passed. `--json` returns the full structured plan for automation.
- New module `lib/commands/pretty-intake` exposes `canRenderPretty`, `renderIntake`, and `renderIntakePlain` for library consumers.

### Changed

- Manifest declares `--plain` and `--json` on `sc plan intake`.
- Test suite grew from 177 to 184 passing (added contract tests for TTY detection, `NO_COLOR` / `FORCE_COLOR` overrides, backwards-compatible plain output, and blocked-plan rendering).

## 2.4.0 - 2026-07-23

### Added

- `method.json` now carries a canonical `paths` block plus `paths_schema: 1`. The block declares the exact relative location of every artifact family (`guardrails`, `config`, `project`, `core`, `state_view`, `map_view`, `tasks`, `sprints`, `features`, `runs`, `reviews`, `memory.{knowledge,decisions,insights,dossiers}`, `vault_local`, `cache`) so ScrumRun-aware agents navigate by index instead of grep. Powered by a new `lib/v2/paths` module used by init, migration, and conformance so drift is impossible.
- Invariant **I-23** — *method.json declares canonical paths so agents navigate by index, not by search*. `doctor --strict` flags `METHOD_PATHS_MISSING`, `METHOD_PATHS_DRIFT`, and `METHOD_PATHS_SCHEMA` findings; a `high` severity blocks conformance until `update --migrate` regenerates the block.
- CORE and the shared SKILL now open with a hard instruction: read `.scrumrun/method.json` **before** any grep, and never search for legacy paths (`goals/`, `backlog.md`, `sprint.md`, `history.md`). Directory listing is a fallback, never a first step.

### Changed

- Migration output writes `method.json` through the shared `renderMethodJson` helper, so v1→v2 migrations backfill the `paths` block automatically.
- SPEC.md conformance range extended to `I-01 through I-23`.
- Test suite grew from 170 to 177 passing.

## 2.3.0 - 2026-07-23

### Added

- Stable error catalog in [`lib/errors.js`](lib/errors.js) exposing a `ScrumRunError` class plus `describe`/`codes` accessors, and a human view in [`docs/ERROR-CODES.md`](docs/ERROR-CODES.md). Codes follow `SR-E-NNN` with reserved ranges per subsystem and are guaranteed stable once assigned.
- `sc config doctor --recover --dry-run` previews every pending kernel transaction, describes each planned rollback or commit-verification, warns about unsafe paths, journal integrity failures, or owner-touched files, and exits non-zero when at least one transaction cannot be recovered safely — never writes.
- Invariant `I-22`: the semantic index's declared search backend must match the runtime's actual capabilities. Conformance now emits a `high` `SEARCH_BACKEND_MISMATCH` finding when a cache advertises `fts5` on a runtime that cannot execute it, replacing the previous lazy-rebuild-only behaviour that hid the drift.
- `previewPendingRecovery` exported from `lib/v2/transaction` for library consumers.
- Property-based intake tests: 200 adversarial inputs per run (NUL bytes, ANSI escapes, homoglyphs, injection shapes, oversize strings) proving `planRequest` is total, never throws unclassified errors, and does not mutate `.scrumrun/`.

### Changed

- `sc plan run --render RUN-NNN` prints the ledger as a chronological, human-readable timeline with actors, transitions, reasons, evidence, and total span. Complements the existing `--show` (raw Markdown) so auditing no longer requires reading JSON blocks by hand.
- `sc plan run --stats [--task TASK-NNN] [--feature FEAT-NNN] [--sprint SPRINT-NNN] [--json]` aggregates every Run in the project into status mix, p50/p95/max time in `VALIDATING` and `EXECUTING`, retry counts per Task, completions after prior failure, and guardrail/mutation event totals — computed straight over the canonical ledger, no separate index.
- New modules `lib/commands/run-render` and `lib/commands/run-stats` expose `renderRun`, `renderRunFromDisk`, `computeStats`, and `renderStats` for library consumers.

### Documentation

- Added [`docs/QUICKSTART.md`](docs/QUICKSTART.md): first Run in under 10 minutes, no `SPEC.md` reading required. Now includes the new `sc plan run --render` and `sc plan run --stats` commands.
- Added [`docs/DEMO.md`](docs/DEMO.md) with the exact asciinema script for a 40-second intake → approve → render → stats demo the owner can record and embed in the README and LP.
- Added [`docs/INDEX.md`](docs/INDEX.md) with reading-order recommendations by intent (fresh install, integrating a client, upgrading from v1, browsing rationale, troubleshooting).
- Added a **Terminology quick reference** in the README that maps internal names (`Mutation Gateway`, `Policy Engine`, `Guardrail obligation`, `Canonical projection`, `Executable schema`) to friendlier user-facing forms; both are treated as synonyms.
- Bumped README package badge to `2.2.0` and linked the Quickstart from the top.
- Created `.scrumrun/features/FEAT-001.md` to record the ongoing "Method 2.x — Onboarding, Visible Auditability, and Stable Diagnostics" initiative and its four-wave scope.

## 2.2.0 - 2026-07-23

### Security

- Added fail-closed, 15-minute, path-scoped Mutation Gateway permits with policy/workspace binding, before/after hashes, read-only and symlink checks, new-secret detection, and append-only Run evidence.
- Deferred Guardrails now become persisted Run obligations; unresolved obligations, policy drift, workspace bypass, and pending canonical transactions block completion.
- Fresh and explicitly migrated projects require structured `Status`, `Enforcement`, `Scope`, and `Rule` fields and advertise Guardrail, obligation, and Mutation Gateway schemas in `method.json`.
- Added per-project `allow_secrets_in` config.md allowlist so owners can exempt non-canonical descriptive files (e.g. v1 `history.md`, `sprint.md`) from secret-like content detection without weakening canonical artifact policy. Exact paths, directory prefixes, and glob patterns are supported. Real `sk-…` / `AKIA…` / JWT / PEM shapes are never exempted because they always carry a real value.

### Changed

- Project conformance now covers 21 executable invariants and detects active Run mutation bypasses.
- `lib/security/secrets` exports `loadSecretAllowlist`, `isSecretAllowed`, `containsSecretWithAllowlist`, and `parseFrontmatter` for use by intake, migration, and conformance.

## 2.1.1 - 2026-07-22

### Fixed

- Semantic indexing now detects whether the current `node:sqlite` build provides FTS5 instead of assuming the optional module exists.
- Node.js 22.13 uses a deterministic, parameterized lexical fallback for artifact and code search while runtimes with FTS5 retain BM25 retrieval.
- Semantic cache schema 4 records the selected search backend and safely rebuilds an FTS5 cache when it is opened by a runtime without FTS5.

### Validation

- Added explicit automatic-backend and forced-fallback tests, including multi-token matching, code-symbol retrieval, cache metadata, and absence of FTS virtual tables.
- The complete 143-test suite passes in the exact `node:22.13.0` runtime that exposed the release regression.

## 2.1.0 - 2026-07-22

### Added

- Canonical Run ledger schema with stable event ids, RFC3339 timestamps, actors, reasons, and typed evidence.
- Explicit early-v2 Run-ledger preflight/apply/rollback through `migrate --to 2` and `update --migrate`.
- Conformance checks that reconstruct Run state and detect event-order, evidence, timestamp, and frontmatter drift.
- Durable multi-file mutation journal with byte-exact rollback, interruption recovery, hash-only receipts, and explicit `doctor --recover`.
- Executable Policy Engine with stable Guardrail ids, explicit passed/blocked/deferred results, and deterministic conformance checks.
- Shared canonical projection fingerprint plus metadata-watch/content-hash freshness checks for `state.md`, `map.md`, and semantic SQLite.
- Evidence-backed release scorecard separating local readiness from external registry/tag gates.

### Changed

- Run is now the sole operational-history authority; Task status is synchronized without duplicated transition prose.
- Run completion requires evidenced validation, learning, and completion transitions.
- Intake classification and risk detection now recognize multilingual runtime, schema, migration, transaction, release, and cross-cutting signals.
- Semantic cache schema 3 removes commit-only invalidation and performs a one-time disposable rebuild from older cache schemas.
- `map --show` now refuses missing or stale fingerprints instead of presenting an unverified projection.

## 2.0.0 - 2026-07-21

### Breaking

- Replaced the v1 Sprint-as-work-item model with Feature → Task → Sprint → Run → Memory.
- Replaced twenty independent commands with `/sc <noun> <subject> <action>` and exactly five nouns.
- Made `guardrails.md` the sole canonical project-policy file; `golden-rules.md` is migration evidence only.
- Raised the runtime requirement to Node.js `>=22.13.0` for native SQLite.

### Added

- Explicit, hashed, staged, idempotent, reversible v1→v2 migration.
- Read-only update migration preflight and explicit `update --migrate` integration for ongoing projects.
- Hybrid incomplete-v2 recovery that reuses existing Task/Sprint/Run links, archives legacy aggregates, and normalizes deterministic pre-release aliases without duplicating work.
- Content-hash verification for installed prompts/skills and `doctor --strict` project conformance checks.
- One frozen executable schema for artifact ids, directories, initial states, transitions, structural cardinalities, truth ownership, and authority boundaries, with generated drift-checked documentation.
- Atomic Task/Run approval and recoverable Run lifecycle/retries.
- Evidence-backed Knowledge, Decisions, Insights, and Dossiers with validity/review metadata.
- Disposable SQLite FTS/graph index and bounded semantic queries.
- Replaceable JS/TS code adapter with symbol identity, dependencies, consumers, protected tests, move remapping, orphan history, and derived invalidation.
- Non-blocking post-validation learning candidates.
- Twenty-invariant conformance audit, adversarial security suite, performance budgets, and Node 22/24/26 CI.

### Security

- Reject traversal/symlink canonical paths, duplicate/mismatched frontmatter, unsafe overwrites, and malformed method state.
- Block secret-like content at intake, memory, migration, context, and indexing boundaries; vault values remain excluded.
- Serialize concurrent canonical memory mutations with disposable locks.
- Scan secret-like content in all supported text migration inputs, including files larger than 1 MiB.

### Compatibility

- Fresh installs expose only `/sc` plus the shared skill.
- Upgrade installs may provide generated v1 adapters for one release cycle; adapters execute canonical routes and emit a deprecation note.

## 1.5.2

- Last 1.x CLI line before the 2.0 domain and migration release.
