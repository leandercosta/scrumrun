# Semantic Memory

ScrumRun memory explains why code exists in its current form. It separates operational events, normative Decisions, reviewed facts, and contextual Insights so an agent can retrieve the smallest relevant evidence package.

## Choosing a kind

- Knowledge: descriptive fact verified by evidence.
- Decision: normative constraint—what must or must not happen.
- Insight: explanation, rationale, trade-off, warning, failure history, or testing note.
- Dossier: curated evidence bundle for a topic/module.

“Pricing calculations must run on the backend” is a Decision. “This function stays in pricing because quotations use it before checkout exists” is an Insight.

## Evidence and lifecycle

AI-created facts/insights always start as candidates. Confirmation requires one or more resolvable artifact IDs or project paths. Paths cannot traverse outside the project, follow symlinks, or reference the vault.

Useful metadata:

```yaml
subject_type: symbol
subject_id: function:calculateFinalPrice
source_type: run
source_id: RUN-044
confidence: 0.8
valid_from: 2026-01-01
valid_until: null
last_verified_commit: <git-hash-or-unavailable>
review_trigger: pricing implementation changes
```

Confirmed memory may become stale, deprecated, or invalidated. Those records remain auditable. Queries exclude rejected/deprecated/invalidated truth by default and label stale evidence explicitly.

## Relations and code graph

```text
symbol:calculateFinalPrice
  ├── defined_in → module:pricing
  ├── depends_on → TaxCalculator
  ├── used_by → OrderService
  ├── constrained_by → DEC-018
  ├── has_insight → INS-041
  └── protected_by → price-calculation.spec.ts
```

The JS/TS adapter records qualified symbol identity, path, kind, line, fingerprint, commit, exports, and lexical/module provenance. Moves with identical fingerprints remap. Unprovable rename/removal becomes orphaned history. Evidence or implementation drift marks linked records stale only in the projection; canonical Markdown changes only through explicit review.

## Learning from Runs

A validated Run may contain:

```text
## Learning Candidates

- [placement_rationale] function:calculateFinalPrice | Keep pricing in the domain because quotations use it. | evidence: src/quotation/service.ts | relations: used_by=module:src/quotation/service.ts
```

Entering `learning` extracts `INS-NNN` candidates. Malformed extraction emits a warning and never blocks the Run.

## Query and maintenance

```bash
scrumrun knowledge map --build
scrumrun knowledge study calculateFinalPrice
scrumrun knowledge context --clear
```

SQLite is ignored and disposable. The derived index records its search backend: FTS5/BM25 is selected when the current Node.js SQLite build supports it; otherwise ScrumRun uses deterministic parameterized token matching over the same artifact, code, and relation tables. Queries default to 10 records/40 relations and hard-cap at 100/100. Match type, truth state, warnings, relation counts, and evidence are returned so recommendations remain explainable.
