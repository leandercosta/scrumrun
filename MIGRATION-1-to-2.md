# Migrating ScrumRun 1.x to 2.0

ScrumRun 2.0 changes the domain model: legacy “sprint entries” usually become Tasks, execution history becomes Runs, and Sprints exist only when the source proves a real timebox or delivery batch. Migration is therefore explicit, hashed, staged, and reversible.

## Requirements

- Node.js `>=22.13.0`.
- A readable `.scrumrun/` v1 directory with no symlinks inside it.
- Enough local disk space for a byte-exact backup plus the migrated tree.
- A clean understanding of any post-migration changes before rollback.

The local vault stays at `.scrumrun/vault.local.md`; its content is preserved and never printed. Secret-like content outside the vault blocks migration so it is not duplicated into new artifacts.

## Recommended ongoing-project flow

```bash
npx scrumrun@latest update
```

Inside a v1 project, update installs the current client integrations and runs a zero-write migration preflight. Review:

- source fingerprint and file count;
- generated artifact counts;
- source-to-destination mappings;
- warnings and blockers.

Apply exactly that workflow only after review:

```bash
npx scrumrun@latest update --migrate
```

`--migrate` is explicit consent. Ordinary update never changes canonical project data.

### Early v2 Run upgrade

Projects created by earlier 2.x builds may contain prose-based Run transitions or inferred Guardrail fields. The same ongoing-project commands detect this layout without writes and, after explicit `--migrate`, upgrade the Run ledger and security schemas:

```text
.scrumrun/.migration/run-ledger-v1/manifest.json
.scrumrun/.migration/run-ledger-v1/backup/runs/RUN-NNN.md
```

Every changed Run, `guardrails.md`, and `method.json` is hashed and backed up byte-exactly. Inferred legacy Guardrail fields become explicit without deleting the original prose. Proven transition chains become ordered `RUN-NNN-EVT-NNN` events. When only the recorded status is provable, migration emits one evidenced `snapshot`; it does not invent the missing path. Existing terminal Runs remain historical; new/retried Runs bind policy obligations and the Mutation Gateway. Replay is idempotent, an interrupted apply restores prepared sources, and rollback refuses when a changed artifact moved after migration.

## Standalone flow

```bash
npx scrumrun@latest migrate --to 2 --dry-run
npx scrumrun@latest migrate --to 2 --apply
```

After apply, inspect:

```text
.scrumrun/.migration/v1-to-v2/manifest.json
.scrumrun/.migration/v1-to-v2/report.md
.scrumrun/tasks/
.scrumrun/runs/
.scrumrun/sprints/
.scrumrun/features/
.scrumrun/memory/
```

The `.migration/` directory is ignored. The manifest records the original tree fingerprint, every generated file hash, mappings, archived paths, and warnings. The backup contains the byte-exact original tree. After apply, legacy-only aggregate files exist only in that backup, so the active tree has one unambiguous v2 layout.

Incomplete hybrid trees are supported. If canonical `TASK-NNN`, `SPRINT-NNN`, or `RUN-NNN` artifacts already represent a legacy entry, the report marks it `represented-by-existing-v2` and does not create a duplicate. Deterministic pre-release aliases such as a Decision with `status: confirmed` may be normalized to the declared v2 status while the original bytes remain in the backup. Anything ambiguous is blocked or warned instead of guessed.

## Mapping rules

| v1 source | v2 result |
|---|---|
| Main/feature sprint entry | Task with legacy provenance |
| History attempt linked by evidence | Run for the migrated Task |
| Explicit timebox/delivery batch | Sprint grouping Tasks |
| Feature lane | Feature plus linked Tasks/Runs |
| Backlog item | Task with `status: backlog` |
| Fix | Task with `type: fix`; Run when execution is evidenced |
| Approved/pending/rejected knowledge | Same semantic state in `K-NNN` |
| Reusable AI-like insight | Candidate `INS-NNN`, never confirmed |
| Decision | `DEC-NNN` with original source hash/content |
| Golden rule | Stable-id entry in canonical `guardrails.md` |
| Dossier/review | Canonical dossier/review artifact with provenance |

Ambiguous records remain preserved and produce warnings. The migrator never invents a Sprint, Run, approval, or confirmed insight.

## Verification

```bash
npx scrumrun@latest status
npx scrumrun@latest sc review artifact --run
npx scrumrun@latest doctor codex --strict
npx scrumrun@latest sc knowledge map --build
npx scrumrun@latest sc knowledge study <topic-or-symbol>
```

Apply is idempotent. Re-running it reports that the project is already migrated and changes nothing.

## Rollback

```bash
npx scrumrun@latest migrate --to 2 --rollback
```

Rollback verifies the backup fingerprint and first checks whether it would erase post-migration canonical, vault, source, or new-file changes. Disposable cache and newly generated `state.md`/`map.md` views do not block restoration. If any unsafe difference exists, rollback refuses.

When rollback refuses:

1. read the listed changed paths;
2. copy/export work you want to keep outside `.scrumrun/`;
3. restore or deliberately reconcile those paths;
4. run rollback again.

Do not delete `.scrumrun/.migration/` until the migration has been accepted and rollback is no longer required.

## Failure recovery

Apply transforms a staging copy and validates it before an atomic directory switch. Injected and real failures before/during the switch restore the v1 tree. If a process is interrupted, do not manually merge staging directories: rerun the dry-run, inspect `.scrumrun` and sibling `.scrumrun-v2-*`/`.scrumrun-v1-*` temporary paths, and recover using the verified backup/manifest.

If the preflight reports a malformed `method.json`, a symlink, an unresolved collision, an active memory record without deterministic evidence, or secret-like content outside the vault, fix that blocker and repeat the dry-run. No canonical migration writes occur while blocked.
