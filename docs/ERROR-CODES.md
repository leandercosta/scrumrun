# Error codes

Every failure that ScrumRun surfaces to the user carries a stable
`SR-E-NNN` code. Codes never change meaning once assigned; retired
entries stay in the catalog with `retired: true` so historical logs
remain resolvable.

The canonical source is [`lib/errors.js`](../lib/errors.js). This document
is a human view of the same catalog, grouped by area.

Roll-out is incremental: high-visibility error sites (intake, approval,
run transitions, doctor, edit permits, transactions) adopt the codes
first. Uncoded errors are still valid — they simply do not carry an
`SR-E-NNN` prefix yet.

## How to use them

When a CLI output looks like:

```
SR-E-102 Run transition rejected: missing validation or learning evidence.
```

- The **code** is a stable anchor for logs, dashboards, and support
  conversations. Grep it. Link to it.
- The **summary** describes what went wrong.
- The **remediation** describes what to try next; the CLI copy is
  identical to the entry in this document.

## Ranges

| Range | Area |
|---|---|
| `SR-E-001..049` | Request and intake |
| `SR-E-050..099` | Approvals, tokens |
| `SR-E-100..149` | Runs and ledger |
| `SR-E-150..199` | Guardrails, policy, obligations |
| `SR-E-200..249` | Edit permits (Mutation Gateway) |
| `SR-E-250..299` | Transactions and recovery |
| `SR-E-300..349` | Memory (facts, decisions, insights, dossiers, vault) |
| `SR-E-350..399` | Semantic index and code intelligence |
| `SR-E-400..449` | Migration and update |
| `SR-E-450..499` | Conformance and doctor |
| `SR-E-500..549` | Configuration and installation |

## Catalog

### Request and intake

| Code | Summary | Remediation |
|---|---|---|
| `SR-E-001` | Intake request is missing. | Provide a natural-language request or use `--request "..."`. |
| `SR-E-002` | Intake payload contains secret-like content. | Remove the secret from the request or reference a vault entry by path. |
| `SR-E-003` | Intake classification could not be produced. | Rephrase the request in one sentence describing the observable problem. |

### Approvals

| Code | Summary | Remediation |
|---|---|---|
| `SR-E-050` | Approval token is malformed. | Re-run the intake and copy the token exactly as printed after `Approval:`. |
| `SR-E-051` | Approval token signature does not match this repository. | Tokens are bound to the project fingerprint. Re-run intake from the repo the change targets. |
| `SR-E-052` | Approval token expired. | Re-run intake to obtain a fresh token before approving. |

### Runs and ledger

| Code | Summary | Remediation |
|---|---|---|
| `SR-E-100` | Run not found. | Check the RUN-NNN id with `sc plan run --list`. |
| `SR-E-101` | Run ledger contains an invalid event. | Inspect the reported event id; use `sc plan run --render` for a human view or restore from git history. |
| `SR-E-102` | Run transition rejected: missing validation or learning evidence. | Complete `--validate` and `--learn` with typed evidence before `--complete`. |
| `SR-E-103` | Retry rejected because the previous Run is still active. | Complete, fail, or block the current Run before creating a retry. |

### Guardrails

| Code | Summary | Remediation |
|---|---|---|
| `SR-E-150` | Guardrail check blocked the operation. | Read the reported GR-NNN, satisfy or retire it explicitly; guardrails never bypass silently. |
| `SR-E-151` | Guardrail obligation is still pending. | Resolve each pending guardrail via `sc plan run --satisfy-guardrail` before completing the Run. |
| `SR-E-152` | Guardrail declaration is malformed. | Every active guardrail requires Status, Enforcement, Scope, and Rule fields; check `.scrumrun/guardrails.md`. |

### Edit permits (Mutation Gateway)

| Code | Summary | Remediation |
|---|---|---|
| `SR-E-200` | No edit permit for this path. | Request one with `sc plan run --authorize-mutation RUN-NNN --path <path>` before editing canonical or source files. |
| `SR-E-201` | Edit permit expired. | Permits last 15 minutes. Authorize a new one and record the change immediately. |
| `SR-E-202` | Edit permit path scope mismatch. | The permit does not cover the modified path. Request a new permit that lists it. |
| `SR-E-203` | File hash changed unexpectedly since the permit was issued. | Someone else modified the file. Re-plan the change and request a fresh permit. |

### Transactions and recovery

| Code | Summary | Remediation |
|---|---|---|
| `SR-E-250` | Pending kernel transaction cannot be recovered automatically. | Run `sc config doctor --recover --dry-run` to preview; if it shows "would overwrite owner changes", reconcile the file manually before applying. |
| `SR-E-251` | Journal fails integrity check. | Inspect `.scrumrun/.transactions/pending`. Do not delete; contact support or restore from backup. |

### Memory

| Code | Summary | Remediation |
|---|---|---|
| `SR-E-300` | Memory candidate rejected: missing resolvable evidence. | Attach at least one `--evidence` path or `sc knowledge <subject> --propose` before `--confirm`. |
| `SR-E-301` | Attempt to write into vault via canonical channel. | `vault.local.md` is local-only and never indexed. Edit the file directly. |

### Semantic index and code intelligence

| Code | Summary | Remediation |
|---|---|---|
| `SR-E-350` | Semantic index is stale. | Rebuild with `sc knowledge map --build`. Cache is disposable; canonical memory is unaffected. |
| `SR-E-351` | Search backend advertised in the cache does not match this runtime. | Delete `.scrumrun/.cache/semantic-index.sqlite` and re-run any `sc knowledge` query to rebuild against the current runtime. |

### Migration

| Code | Summary | Remediation |
|---|---|---|
| `SR-E-400` | Migration preflight failed. | Run `npx scrumrun@latest update` (dry) to see blockers, resolve them, then apply with `--migrate`. |
| `SR-E-401` | Migration rollback requested but no backup was found. | Rollback needs the ignored byte-exact backup created during `--migrate`. Restore from version control if the backup is gone. |

### Conformance and doctor

| Code | Summary | Remediation |
|---|---|---|
| `SR-E-450` | Conformance check failed. | The reported invariant identifies the exact violation; the message includes the file and expected shape. |
| `SR-E-451` | Installed client asset is stale. | Re-run `npx scrumrun@latest update` for the specific client. `doctor --strict` shows which files diverge. |

### Configuration and installation

| Code | Summary | Remediation |
|---|---|---|
| `SR-E-500` | ScrumRun project not initialized. | Run `npx scrumrun@latest init` in the repository root. |
| `SR-E-501` | Unsupported Node.js runtime. | ScrumRun requires Node.js >=22.13.0 for native SQLite. Upgrade Node and retry. |

## Adding a new code

1. Reserve the next number in the appropriate range.
2. Add an entry to `CATALOG` in `lib/errors.js` with `summary` and
   `remediation`.
3. Throw `new ScrumRunError("SR-E-XYZ", "...")` from the site that
   raises it.
4. Add or update the row in this document.
5. Never rename or reassign an existing code. If a code is no longer
   thrown, mark it `retired: true` and keep the entry.
