# Documentation index

Read in the order that matches how deep you want to go.

## Start here

| Doc | For | Time |
|---|---|---|
| [`QUICKSTART.md`](QUICKSTART.md) | Your first Run in under 10 minutes. Zero jargon. | 5 min |
| [`../README.md`](../README.md) | Pitch, install, useful commands. | 8 min |

## Understand the method

| Doc | For | Time |
|---|---|---|
| [`../CORE.md`](../CORE.md) | The operational guide agents follow at runtime. Portable across clients. | 15 min |
| [`SEMANTIC-MEMORY.md`](SEMANTIC-MEMORY.md) | How facts, decisions, insights, and dossiers fit together. | 10 min |
| [`SCHEMA.md`](SCHEMA.md) | The generated executable schema: ids, cardinalities, initial states, transitions. | 10 min |

## Verify and troubleshoot

| Doc | For | Time |
|---|---|---|
| [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md) | Install, migration, and daily-use issues with fixes. | as needed |
| [`ERROR-CODES.md`](ERROR-CODES.md) | Catalog of stable `SR-E-NNN` codes with summary + remediation for every user-facing failure. | as needed |
| [`RELEASE-SCORECARD.md`](RELEASE-SCORECARD.md) | Evidence-backed local readiness signals per release. | 5 min |

## Go deep

| Doc | For | Time |
|---|---|---|
| [`../SPEC.md`](../SPEC.md) | The normative specification: state machines, invariants, composition, precedence, conformance. | 30 min |
| [`../DECISIONS.md`](../DECISIONS.md) | Architecture Decision Records: why the method is the way it is. Every ADR carries context, decision, alternatives considered, consequences. | browse |
| [`../CHANGELOG.md`](../CHANGELOG.md) | What shipped, what broke, what got safer. | as needed |
| [`../MIGRATION-1-to-2.md`](../MIGRATION-1-to-2.md) | Upgrade, verify, rollback, and recover for existing v1 projects. | as needed |

## Reading order recommendations

**You just installed ScrumRun.**
`QUICKSTART.md` → `README.md` → `CORE.md` when you want more.

**You are integrating ScrumRun with a new AI client.**
`CORE.md` → `SCHEMA.md` → `SPEC.md`.

**You are upgrading from v1.**
`../MIGRATION-1-to-2.md` → `../CHANGELOG.md` → `TROUBLESHOOTING.md`.

**You want to know why a design choice exists.**
`../DECISIONS.md`. Search for the topic; every ADR is self-contained.

**Something broke.**
`TROUBLESHOOTING.md` first. If the code shown starts with `SR-E-`, the
message points to the exact remediation step.
