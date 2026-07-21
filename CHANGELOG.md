# Changelog

All notable changes follow Semantic Versioning.

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
