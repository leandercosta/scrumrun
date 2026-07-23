# Changelog

All notable changes follow Semantic Versioning.

## Unreleased

### Added

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
