# Troubleshooting

## “Project must be explicitly migrated to v2”

Run `npx scrumrun@latest update` for a read-only preflight, then review and apply with `update --migrate`. See [`MIGRATION-1-to-2.md`](../MIGRATION-1-to-2.md).

## Migration is blocked

- Symlink: replace it with a regular local file/directory or preserve it outside `.scrumrun/`.
- Malformed `method.json`: do not guess; restore the correct v1 state/marker and rerun dry-run.
- Secret outside vault: move the value to `.scrumrun/vault.local.md`, redact the canonical source, and retry.
- Ambiguous history: warnings are expected and preserved; blockers must be resolved before apply.

Dry-run is safe to repeat and writes nothing.

## Rollback refuses

Rollback detected post-migration work that it would erase. Copy/export wanted changes, reconcile the paths named in the error, and retry. Never delete the migration backup to force rollback.

## `state.md` or `map.md` is stale

`state.md` refreshes after runtime transitions. Rebuild the semantic map with:

```bash
npx scrumrun@latest sc knowledge map --build
```

Stale generated views are warnings, not canonical corruption.

## SQLite is missing/corrupt

Delete or clear only the disposable cache:

```bash
npx scrumrun@latest sc knowledge context --clear
npx scrumrun@latest sc knowledge map --build
```

Canonical Markdown is unchanged. Query automatically rebuilds a missing/stale index.

## Memory cannot be confirmed

Every confirmed fact/insight/Decision needs resolvable evidence. Use an existing artifact ID such as `RUN-044`/`DEC-018` or a regular project path. Absolute paths, traversal, symlinks, missing files, and vault references are rejected.

## A query returns stale/orphaned memory

Inspect its invalidation warning and code/evidence relations. For a real code move, rebuild may show `remappedFrom`. For a rename/removal without proof, the old symbol remains orphaned. Review the canonical memory; mark stale and reconfirm with current evidence, or invalidate it.

## Doctor reports missing clients

```bash
npx scrumrun@latest install codex
npx scrumrun@latest install claude
npx scrumrun@latest install opencode
npx scrumrun@latest doctor all
```

Use `doctor --compat` only while validating one-cycle v1 adapters.

## Node.js is unsupported

ScrumRun 2.0 requires Node.js `>=22.13.0` because semantic indexing uses native `node:sqlite`. Upgrade Node, then rerun doctor.

## Safe uninstall

`uninstall` previews. `uninstall --force` removes `.scrumrun/` and only removes `AGENTS.md` when it is recognized as ScrumRun-generated. Export any memory you want to keep first.
