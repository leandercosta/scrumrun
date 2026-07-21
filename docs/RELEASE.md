# ScrumRun 2.0 Release Procedure

Publication is owner-gated. Tests, packaging, local commits, and release metadata preparation do not authorize npm publication, git push, tags, GitHub releases, or dist-tag changes.

## Local release gate

```bash
npm test
npm run benchmark
git diff --check
npm pack --dry-run
npx scrumrun@latest sc review artifact --run   # in a clean v2 fixture/current package equivalent
```

Confirm package contents exclude repository-local `.scrumrun/` state, caches, migration records, backups, vaults, tests, and secrets. The `.scrumrun/` directory inside project templates is expected. Confirm `package.json`, README, changelog, SPEC, CORE, skill, migration guide, and tag all name 2.0.0.

## Release candidate (owner approval required)

1. Set `2.0.0-rc.1` metadata and create a reviewed commit.
2. `npm pack`; record tarball SHA-256/integrity.
3. Publish to `next`, never `latest`:

   ```bash
   npm publish --tag next
   ```

4. Install from the registry into a clean fixture.
5. Run init, intake/approval, memory confirmation/query, v1 update preflight/apply/rollback, doctor, and uninstall.
6. Fix findings in a new RC; never replace an already-published version.

## Final promotion (new owner approval required)

1. Set `2.0.0`, rerun every local/registry gate, and create the final metadata commit.
2. Create/push tag `v2.0.0` and publish npm `2.0.0`.
3. Promote `latest` only after registry smoke tests pass.
4. Create the GitHub release from `CHANGELOG.md` and link the migration guide.
5. Verify npm metadata, Git tag/commit, GitHub release, README, and checksums agree.

## Recovery

- RC defect: publish another RC; keep `latest` unchanged.
- Final package defect before `latest`: do not promote; publish `2.0.1` after correction if 2.0.0 already exists.
- Defect after `latest`: assess deprecation vs immediate 2.0.1; never overwrite/unpublish without explicit owner decision and npm-policy review.
- Migration issue: stop promotion, preserve registry artifact/checksum, use the documented rollback fixture, and publish a corrected version.
