# ScrumRun 4.0 Markdown Model

This document explains the model. Exact ids, directories, initial states, transitions, structural cardinalities, truth ownership, and authority boundaries are generated from `lib/v2/schema.js` into [`SCHEMA.md`](SCHEMA.md). Do not maintain another hand-written schema table here.

## Core distinction

| Entity | Question | Lifetime |
|---|---|---|
| Core | How must the agent work? | Stable, sealed policy |
| Guardrails | What may never be broken here? | Stable, sealed project policy |
| Knowledge | What do we know, and why? | Reviewed until stale/deprecated/invalidated |
| Backlog | What is provisioned but not started? | Tasks with `status: backlog` |
| Feature | Why does this initiative matter? | Long-lived |
| Sprint | Which Tasks ship together? | Feature, fix, or maintenance batch |
| Task | What concrete outcome must be delivered? | Until outcome/closure |
| Run | What happened while executing a Task or Sprint? | Optional audit/handoff record |

```text
SPRINT-012 (type: fix)
   └── TASK-018
          ├── feature → FEAT-003
          ├── depends_on → TASK-014, DEC-018
          ├── guardrails → GR-004
          └── run → RUN-044 (optional)
```

Task is the executable unit. A Task may be independent of a Sprint. A Sprint groups Tasks and may be `feature`, `fix`, or `maintenance`. Runs are optional and never substitute for a Task's direct Markdown handoff.

## Canonical artifacts

All artifacts carry `id`, `kind`, `status`, `created`, `updated`, and `method`. Relations use simple frontmatter and relative links: `sprint: SPRINT-012`, `feature: FEAT-003`, `depends_on: [TASK-014, DEC-018]`, and `## Related`. Unknown fields and sections are preserved. The generated [`SCHEMA.md`](SCHEMA.md) is the authoritative inventory.

## Operational flow

Approval creates or refines a Task. An optional Run can record strict audit or handoff history, but no Run, ledger, permit, or status synchronization blocks normal Markdown work. An approved Task continues through discover → implement → verify → fix → verify until its `## Done when` contract is delivered.

Feature and Sprint provide context/grouping and do not own execution history. Review attaches evidence. Knowledge, Decisions, and Insights explain constraints across all of them. Core and Guardrails are sealed Markdown policy: only explicit owner-reviewed maintenance may change them.

## Generated projections

`state.md` summarizes active work/memory. `map.md` summarizes bounded nodes/edges. SQLite stores the complete derived graph/search index. All are fingerprinted or explicitly stale and can be rebuilt from Markdown plus source code. Freshness uses a metadata watch fast path and content-hash fallback; the watch is disposable evidence, never truth.
