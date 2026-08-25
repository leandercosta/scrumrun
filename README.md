# ScrumRun

> A simple, fast, evidence-driven Agile runtime for AI coding agents.

ScrumRun gives an agent a small command surface and a precise project memory: what should be done, how each attempt happened, which decisions constrain the code, and why the architecture exists in its current form.

**Package:** `2.7.7` · **Method target:** `2.0.0` · **Runtime:** Node.js `>=22.13.0` · **License:** MIT

**New here?** Read the [Quickstart](docs/QUICKSTART.md) — first Run in under 10 minutes, no `SPEC.md` reading required. Full docs map in [`docs/INDEX.md`](docs/INDEX.md).

## The model

```text
Feature = why the initiative matters
Task    = what atomic work must be done
Sprint  = when Tasks are grouped as a timebox/batch
Run     = how one concrete attempt happened
Memory  = what the project learned and why
```

```text
FEAT-003
   └── TASK-018
          ├── executed_by → RUN-044
          ├── included_in → SPRINT-012
          ├── constrained_by → DEC-018
          └── generated → INS-041
```

A Task does not need a Sprint. A retry creates a new Run. A fix is a Task with `type: fix`; backlog is a view of backlog Tasks.

See [`docs/SCHEMA.md`](docs/SCHEMA.md) for the generated executable contract and [`docs/ENTITY-MODEL.md`](docs/ENTITY-MODEL.md) for the conceptual guide.

## Install

Install the CLI globally (recommended — avoids `npx` cache quirks):

```bash
npm i -g scrumrun@latest
scrumrun install
scrumrun init
```

To upgrade later:

```bash
npm i -g scrumrun@latest
scrumrun update
```

`npx scrumrun@latest <command>` also works if you prefer not to install globally, but pin the version explicitly (`@latest` or `@2.6.1`) — `npx scrumrun` alone will happily reuse a stale cached version.

`install` adds the client integration; `init` creates the project tree. Initialization is local by default: `.scrumrun/` and the generated agent hint are added to `.git/info/exclude`. Use `--shared` when the team wants to commit the project memory.

ScrumRun installs one canonical agent command:

```text
/sc <noun> <subject> <action> [args]
```

The five nouns are `plan`, `knowledge`, `rules`, `review`, and `config`.

## Daily flow

Natural language is the normal entry point:

```text
Move calculateFinalPrice to checkout.
Fix duplicate charges after refresh.
Study why pricing depends on TaxCalculator.
```

ScrumRun runs a read-only pipeline before asking for approval:

```text
RECEIVED → CONTEXTUALIZING → POLICY → RISK → CLASSIFICATION
         → PLANNING → AWAITING_APPROVAL
```

The agent may assert the classification (`--type fix|task|feature|docs|discovery`) and attach a short technical preview (`--preview "…"`), rendered with color in the terminal before any Task exists. Nothing canonical is persisted before approval.

Explicit approval atomically creates a Task and a Run. Execution then follows:

```text
EXECUTING → VALIDATING → LEARNING → COMPLETED | FAILED | BLOCKED
```

Every approved Task carries an `## Acceptance Criteria` section so "done" is defined before work begins; `--complete --summary "…"` stores a `## Technical Summary` on the Run so the next agent inherits what was actually done. Failed retries remain available as separate Runs.

Each Run contains a machine-validated event ledger. Events have stable ids such as `RUN-044-EVT-003`, RFC3339 timestamps, actors, reasons, and typed evidence for commands, tests, files, reviews, decisions, insights, and risks. Run is the only operational history; Task keeps its approved scope and synchronized current status without duplicating those events. Completion is rejected when validation or learning evidence is missing.

Linked Task/Run writes use a durable ignored transaction journal. Captured failures roll back immediately; interrupted operations are recovered byte-exactly on retry or through explicit `doctor --recover`. Read-only audit reports pending recovery and never repairs state silently.

## Terminology quick reference

Internal names in the code and spec are precise but occasionally heavy. When they surface in CLI output or docs, the shorter form works too.

| Internal (SPEC/CORE) | User-facing (docs, output) | What it means |
|---|---|---|
| Mutation Gateway | edit permit | The 15-minute, path-scoped permission an approved Run needs to edit source files. |
| Policy Engine | guardrail check | The executable evaluation of every active `GR-NNN` rule before planning and before execution. |
| Guardrail obligation | pending guardrail | A deferred guardrail check persisted on a Run; must resolve before completion. |
| Canonical projection | derived view | Generated navigation files such as `state.md` and `map.md` — always regenerable, never authority. |
| Executable schema | frozen contract | The single machine-checked shape for ids, transitions, and cardinalities. |

The short forms are synonyms — safe to use in issues, PRs, and everyday conversation.

## Semantic project memory

Canonical memory is human-readable Markdown:

- `K-NNN` — reviewed facts;
- `DEC-NNN` — normative decisions;
- `INS-NNN` — contextual rationale, constraints, warnings, and trade-offs;
- `DOS-NNN` — curated topic/module dossiers.

The agent can answer questions such as:

- Why is this function in this module?
- Which Decision constrains it?
- Who depends on it?
- Which test protects it?
- What is likely to break if it changes?

AI extraction creates candidates only. Confirmation requires resolvable evidence. Stale and invalidated memory is labeled; rejected/deprecated/invalidated records are excluded from active truth by default.

The fast graph/search layer is `.scrumrun/.cache/semantic-index.sqlite`. It is ignored and disposable: deleting it never deletes knowledge. The index selects FTS5/BM25 when the current Node.js SQLite build provides it and otherwise uses a deterministic, parameterized lexical fallback; both backends preserve bounded graph retrieval without changing canonical Markdown. Unchanged queries use a metadata-only freshness check; metadata drift falls back to complete content fingerprints before rebuilding. Cache-schema upgrades force one safe disposable rebuild. The current JavaScript/TypeScript adapter derives qualified symbols plus `defined_in`, `depends_on`, `used_by`, and `protected_by` relations.

`map.md` is shown only when its source fingerprint matches the current semantic index. A fresh placeholder or stale map is rejected with an explicit rebuild instruction instead of being presented as project truth.

## Project briefing

`state.md` is the **briefing**: a bounded summary an agent reads first, before touching anything else.

```text
## Now            active work, with each Task's assignee
## Recent         last completions + their technical summaries
## Open Decisions titles only, with pointers
## Active Memory  confirmed facts / insights / decisions
## Next Up        the backlog queue, oldest first
## Where to look  pointers to guardrails, tasks, runs, semantic search
```

It is progressive disclosure: the briefing is enough for most work; the agent follows its pointers and goes deeper only when the briefing lacks what it needs. The intake context package embeds the same briefing. Each agent declares an identity (`SCRUMRUN_AGENT` or `Agent Identity` in `config.md`), recorded as the Task `assignee` and Run `actor`, so `--shared` teams can see who owns each active Task from the briefing alone.

## Migrating an ongoing v1 project

Update the client integrations and automatically run a read-only migration preflight:

```bash
npx scrumrun@latest update
```

This shows the source inventory, proposed mappings, and blockers without changing project data. Apply only the verified plan with:

```bash
npx scrumrun@latest update --migrate
```

The standalone workflow remains available:

```bash
npx scrumrun@latest migrate --to 2 --dry-run
npx scrumrun@latest migrate --to 2 --apply
npx scrumrun@latest migrate --to 2 --rollback
```

Migration uses content hashes, a byte-exact ignored backup, staging validation, an atomic directory switch, a source-to-destination report, idempotent replay, and rollback protection. It also recognizes incomplete hybrid v1/v2 trees, reuses already-linked canonical work, and normalizes only deterministic schema aliases. Early v2 Run prose is preflighted and upgraded to the structured ledger by the same explicit `update --migrate` gate; ambiguous paths become evidenced snapshots instead of invented transitions. Legacy-only files leave the active tree but remain byte-exact in the ignored backup; vault contents remain local. Ambiguous history remains an explicit warning, and the migrator never invents a Sprint or Run.

After migration or an integration update, verify both installed assets and project state:

```bash
npx scrumrun@latest doctor codex --strict
```

`doctor` compares managed prompt/skill contents with the package, so an obsolete installation is reported as `stale` rather than `ok` merely because the file exists.

## Canonical tree

```text
.scrumrun/
  core.md
  guardrails.md
  config.md
  project.md
  method.json
  state.md                         # generated
  map.md                           # generated
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
  .cache/semantic-index.sqlite     # generated, ignored
  vault.local.md                   # optional, ignored, never indexed
```

`guardrails.md` is canonical project policy. Active `GR-NNN` rules are evaluated into explicit `passed`, `blocked`, or `deferred` results; blocks identify the exact Guardrail and deferred checks stay visible for their execution-time gate. `config.md` contains preferences and cannot weaken policy. Duplicate/unknown Guardrails, disabled approval, and unsafe read-only paths fail conformance. `state.md`, `map.md`, context packages, and SQLite are generated navigation aids, never authority. `state.md` carries the same source fingerprint used by intake, an RFC3339 generation time, and a watch fingerprint for fast verified staleness checks.

Approved Runs persist every deferred result as an append-only obligation and bind the exact policy plus workspace baseline. Material source edits use a 15-minute, path-scoped Mutation Gateway permit. Recording verifies before/after hashes, owner/read-only scope, symlinks, new secret-like content, and workspace drift. Validation and completion fail closed when edits bypass that chain or obligations remain unresolved.

### Owner-controlled allowlist for descriptive files

Secret-like content detection is canonical-policy-level and applies to every file outside `vault.local.md`. Owners can exempt specific **non-canonical descriptive paths** from the keyword heuristic by adding frontmatter to `.scrumrun/config.md`:

```yaml
---
allow_secrets_in:
  - goals/main/history.md
  - goals/main/sprint.md
  - docs/migration-notes/
  - "*.legacy.md"
---
```

Supported matchers per entry:

- exact path (`goals/main/history.md`)
- directory prefix ending in `/` (`docs/legacy/`)
- glob pattern (`*.legacy.md`)

Rules:

- Canonical artifacts (Task, Sprint, Run, Feature, Review, Memory) are **never** eligible — a secret in a canonical file always fails conformance.
- High-confidence shapes (`sk-…`, `AKIA…`, JWT three-part tokens, PEM private keys, long bearer tokens) are never exempted regardless of path.
- The allowlist is recorded as evidence of an explicit owner decision and is reviewed by `doctor`.

## Useful commands

```bash
# inspect the grammar
npx scrumrun@latest commands

# plan without writes, then approve the emitted token
npx scrumrun@latest sc plan intake "Fix pricing rounding" --type fix --preview "Rounding moved after tax calc"
npx scrumrun@latest sc plan intake --approve <token>

# record what was done at completion, so the next agent inherits it
npx scrumrun@latest sc plan run --complete RUN-001 --note "Done" --evidence "npm test: passed" --summary "Moved rounding after tax calc in checkout/pricing.ts"

# auto-sequencing: surface and start the next backlog Task
npx scrumrun@latest sc plan task --next
npx scrumrun@latest sc plan task --start TASK-009

# authorize and record a material source mutation
npx scrumrun@latest sc plan run --authorize-mutation RUN-001 --path src/pricing.ts
npx scrumrun@latest sc plan run --record-mutation RUN-001 --permit MUT-... --note "Pricing change recorded"

# record an audit-derived Review, then resolve a persisted completion gate
npx scrumrun@latest sc review artifact --run
npx scrumrun@latest sc review artifact --record --task TASK-001 --run RUN-001 --evidence "npm test: passed"
npx scrumrun@latest sc plan run --satisfy-guardrail RUN-001 --guardrail GR-003 --review REV-001

# memory lifecycle
npx scrumrun@latest sc knowledge insight --propose "Pricing stays in backend" --evidence src/pricing.ts
npx scrumrun@latest sc knowledge insight --confirm INS-001
npx scrumrun@latest sc knowledge study calculateFinalPrice

# rebuild or inspect the derived graph
npx scrumrun@latest sc knowledge map --build
npx scrumrun@latest sc knowledge map --show

# read a Run as a human timeline instead of raw ledger JSON
npx scrumrun@latest sc plan run --render RUN-001

# aggregate every Run in the project (p50/p95 durations, retries, guardrail counts)
npx scrumrun@latest sc plan run --stats
npx scrumrun@latest sc plan run --stats --task TASK-001 --json

# preview a canonical-transaction recovery before touching disk
npx scrumrun@latest sc config doctor --recover --dry-run
```

The command manifest in `lib/commands/manifest.js` generates help and compatibility adapters, preventing client grammar drift. A recorded artifact Review cannot self-declare success: ScrumRun reruns the audit and derives the `REV-NNN` verdict from the result.

Every user-facing failure carries a stable [`SR-E-NNN` code](docs/ERROR-CODES.md) with a permanent meaning, a short summary, and an exact remediation.

## Documentation

| File | Purpose |
|---|---|
| [`docs/QUICKSTART.md`](docs/QUICKSTART.md) | First Run in under 10 minutes, no `SPEC.md` reading required. |
| [`docs/INDEX.md`](docs/INDEX.md) | Reading-order recommendations across every doc, by intent. |
| [`CORE.md`](./CORE.md) | Operational runtime guide for agents. |
| [`SPEC.md`](./SPEC.md) | Normative 2.0 state machines, invariants, and conformance rules. |
| [`DECISIONS.md`](./DECISIONS.md) | Architectural decisions and trade-offs. |
| [`docs/ERROR-CODES.md`](docs/ERROR-CODES.md) | Stable `SR-E-NNN` catalog with remediation for every failure. |
| `MIGRATION-1-to-2.md` | Upgrade, verification, rollback, and recovery guide. |
| [`docs/RELEASE-SCORECARD.md`](docs/RELEASE-SCORECARD.md) | Evidence-backed local readiness scores and residual release risks. |
| [`docs/DEMO.md`](docs/DEMO.md) | Script for a 40-second asciinema demo of the full intake → approve → render → stats loop. |

ScrumRun remains client-independent: any agent that reads Markdown can follow `CORE.md`; Codex, Claude Code, and OpenCode integrations are accelerators.

## Development

```bash
npm test
npm pack --dry-run
```

The release gates cover artifact/state conformance, read-only intake, migration failure recovery, semantic cache equivalence, code graph behavior, vault exclusion, and CLI compatibility.

## License

MIT © Leander Costa · [hi@scrumrun.dev](mailto:hi@scrumrun.dev)
