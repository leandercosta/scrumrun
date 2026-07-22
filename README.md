# ScrumRun

> A simple, fast, evidence-driven Agile runtime for AI coding agents.

ScrumRun gives an agent a small command surface and a precise project memory: what should be done, how each attempt happened, which decisions constrain the code, and why the architecture exists in its current form.

**Package:** `2.1.0` · **Method target:** `2.0.0` · **Runtime:** Node.js `>=22.13.0` · **License:** MIT

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

```bash
npx scrumrun@latest install
npx scrumrun@latest init
```

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

Explicit approval atomically creates a Task and a Run. Execution then follows:

```text
EXECUTING → VALIDATING → LEARNING → COMPLETED | FAILED | BLOCKED
```

Nothing canonical is persisted before approval. Failed retries remain available as separate Runs.

Each Run contains a machine-validated event ledger. Events have stable ids such as `RUN-044-EVT-003`, RFC3339 timestamps, actors, reasons, and typed evidence for commands, tests, files, reviews, decisions, insights, and risks. Run is the only operational history; Task keeps its approved scope and synchronized current status without duplicating those events. Completion is rejected when validation or learning evidence is missing.

Linked Task/Run writes use a durable ignored transaction journal. Captured failures roll back immediately; interrupted operations are recovered byte-exactly on retry or through explicit `doctor --recover`. Read-only audit reports pending recovery and never repairs state silently.

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

The fast graph/search layer is `.scrumrun/.cache/semantic-index.sqlite`. It is ignored and disposable: deleting it never deletes knowledge. Unchanged queries use a metadata-only freshness check; metadata drift falls back to complete content fingerprints before rebuilding. Cache-schema upgrades force one safe disposable rebuild. The current JavaScript/TypeScript adapter derives qualified symbols plus `defined_in`, `depends_on`, `used_by`, and `protected_by` relations.

`map.md` is shown only when its source fingerprint matches the current semantic index. A fresh placeholder or stale map is rejected with an explicit rebuild instruction instead of being presented as project truth.

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

## Useful commands

```bash
# inspect the grammar
npx scrumrun@latest commands

# plan without writes, then approve the emitted token
npx scrumrun@latest sc plan intake "Fix pricing rounding"
npx scrumrun@latest sc plan intake --approve <token>

# verify canonical policy and all twenty executable invariants
npx scrumrun@latest sc review artifact --run

# memory lifecycle
npx scrumrun@latest sc knowledge insight --propose "Pricing stays in backend" --evidence src/pricing.ts
npx scrumrun@latest sc knowledge insight --confirm INS-001
npx scrumrun@latest sc knowledge study calculateFinalPrice

# rebuild or inspect the derived graph
npx scrumrun@latest sc knowledge map --build
npx scrumrun@latest sc knowledge map --show
```

The command manifest in `lib/commands/manifest.js` generates help and compatibility adapters, preventing client grammar drift.

## Documentation

| File | Purpose |
|---|---|
| [`CORE.md`](./CORE.md) | Operational runtime guide for agents. |
| [`SPEC.md`](./SPEC.md) | Normative 2.0 state machines, invariants, and conformance rules. |
| [`DECISIONS.md`](./DECISIONS.md) | Architectural decisions and trade-offs. |
| `MIGRATION-1-to-2.md` | Upgrade, verification, rollback, and recovery guide. |
| [`docs/RELEASE-SCORECARD.md`](docs/RELEASE-SCORECARD.md) | Evidence-backed local readiness scores and residual release risks. |

ScrumRun remains client-independent: any agent that reads Markdown can follow `CORE.md`; Codex, Claude Code, and OpenCode integrations are accelerators.

## Development

```bash
npm test
npm pack --dry-run
```

The release gates cover artifact/state conformance, read-only intake, migration failure recovery, semantic cache equivalence, code graph behavior, vault exclusion, and CLI compatibility.

## License

MIT © Leander Costa
