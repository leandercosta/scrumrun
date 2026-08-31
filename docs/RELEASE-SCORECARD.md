# ScrumRun 2.1.1 Local Release Scorecard

- Date: 2026-07-22
- Package: `2.1.1`
- Method contract: `2.0.0`
- Scope: local implementation and package readiness; external registry/tag/release verification remains owner-gated.

## Scoring rule

A score of 9.5 or higher requires a single documented contract, machine enforcement on the critical path, adversarial/failure tests, deterministic recovery where mutation is involved, bounded performance, and an explicit residual-risk statement. Documentation alone cannot earn 9.5.

| Area | Score | Executable evidence |
|---|---:|---|
| Conceptual model | 9.7 | Frozen Feature → Task → Sprint → Run → Memory schema; Task/Sprint and retry invariants; ADR-015 and ADR-018. |
| Documentation architecture | 9.7 | SPEC is normative, CORE is operational, ADRs explain trade-offs, generated SCHEMA is drift-checked, README/skill/templates are conformance-tested. |
| Artifact kernel | 9.7 | One executable schema, safe-path checks, lossless frontmatter transitions, conflict refusal, fsync atomic writes, and durable multi-file transactions with failure injection. |
| Run history and audit | 9.8 | Stable ordered event ids, RFC3339 timestamps, typed evidence, state reconstruction, completion gates, retry preservation, explicit early-v2 migration, and byte-exact rollback. |
| Real conformance | 9.7 | Twenty normative invariants point to executable tests; clean-project audit, malformed artifacts, secrets, symlinks, migration interruption, transaction interruption, and cache corruption are exercised. |
| Local state and retrieval | 9.7 | Intake/state share one canonical fingerprint; state/map/SQLite expose staleness; metadata fast path falls back to full content hashes; cache schema mismatch rebuilds once; FTS5 capability is detected and a deterministic parameterized fallback preserves Node 22.13 retrieval. |
| Overall operation | 9.7 | Read-only intake, explicit approval, atomic Task/Run creation, Policy Engine ids, migration preflight/apply/rollback, package E2E, installed-asset doctor, exact Node 22.13 regression coverage, Node 22/24/26 CI definition, and release budgets. |

Minimum local score: **9.7/10**.

## Release evidence

- Full suite: `npm test`.
- Performance suite: `npm run benchmark`.
- Contract drift: `scripts/generate-contract-docs.js --check` runs before tests.
- Project conformance: `scrumrun review artifact --run`, twenty-one invariants, zero findings at the release checkpoint.
- Installed integration: `doctor codex --strict`, exact prompt/skill hashes and zero project findings.
- Package boundary: `npm pack --dry-run --json`, explicit file inventory, no repository-local `.scrumrun/`, tests, vault, backup, migration state, or cache.
- Tarball E2E: install, v2 memory, ongoing v1 migration, rollback, doctor, and uninstall run from the packed package in the test suite.

The exact final tarball checksum belongs in the owner-gated release Review/Run after all included files are frozen; embedding a tarball's own checksum inside an included document would change that checksum.

## Residual risks and gates

- Registry smoke, npm dist-tags, `v2.1.1` tag, push, and GitHub release are not proven by local tests and require explicit owner authorization.
- The built-in code-intelligence adapter currently covers JavaScript/TypeScript; other languages require replaceable adapters.
- Remote Node 22/24/26 CI must pass on the release commit; the exact Node 22.13 container passes locally but does not replace the external gate.
- Semantic retrieval is intentionally lexical/structural rather than a probabilistic embedding system; confirmed Markdown evidence remains the authority.

These are bounded release or extension risks, not hidden correctness claims. A failed external gate stops promotion and results in a new immutable SemVer; it never rewrites an existing npm version.
