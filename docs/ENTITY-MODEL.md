# ScrumRun 2.0 Entity Model

## Core distinction

| Entity | Question | Lifetime |
|---|---|---|
| Feature | Why does this initiative matter? | Long-lived |
| Task | What atomic outcome is approved? | Until outcome/closure |
| Sprint | When are related Tasks grouped? | Timebox/batch |
| Run | How did one execution attempt happen? | Immutable attempt history |
| Memory | What do we know, and why? | Reviewed until stale/deprecated/invalidated |

```text
FEAT-003
   └── TASK-018
          ├── executed_by → RUN-044
          ├── included_in → SPRINT-012
          ├── constrained_by → DEC-018
          └── generated → INS-041
```

Task is always the executable unit. A Task may be independent of a Sprint. Sprint never substitutes for Task. A retry creates another Run for the same Task.

## Canonical artifacts

| Kind | ID | Directory | Initial status |
|---|---|---|---|
| Feature | `FEAT-NNN` | `features/` | backlog/proposed |
| Task | `TASK-NNN` | `tasks/` | backlog/proposed/running after approval |
| Sprint | `SPRINT-NNN` | `sprints/` | proposed |
| Run | `RUN-NNN` | `runs/` | executing |
| Review | `REV-NNN` | `reviews/` | proposed |
| Knowledge | `K-NNN` | `memory/knowledge/` | candidate |
| Decision | `DEC-NNN` | `memory/decisions/` | open |
| Insight | `INS-NNN` | `memory/insights/` | candidate |
| Dossier | `DOS-NNN` | `memory/dossiers/` | active with evidence |

All carry `id`, `kind`, `status`, `created`, `updated`, and `method: 2.0.0`. Relations live in frontmatter for structural ownership and in `## Relations` for extensible graph edges.

## Operational flow

Approval creates one Task and one Run. The Run progresses `executing → validating → learning → completed|failed|blocked`, while the Task mirrors `running → validating → learning → completed|failed|blocked`. Pair mutations are recoverable.

Feature and Sprint provide context/grouping and do not own execution history. Review attaches evidence. Memory explains decisions and constraints across all of them.

## Generated projections

`state.md` summarizes active work/memory. `map.md` summarizes bounded nodes/edges. SQLite stores the complete derived graph/search index. All are fingerprinted or explicitly stale and can be rebuilt from Markdown plus source code.
