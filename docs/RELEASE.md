# ScrumRun Package Release Procedure

Publication is owner-gated. Tests, packaging, local commits, and release metadata preparation do not authorize npm publication, git push, tags, GitHub releases, or dist-tag changes.

The npm package/CLI follows SemVer independently from the ScrumRun method contract. For this release, package `2.1.0` implements method `2.0.0`. Published package `2.0.0` is immutable and must never be overwritten or reused.

## Local release gate

```bash
npm test
npm run benchmark
git diff --check
npm pack --dry-run
npx scrumrun@latest sc review artifact --run   # in a clean v2 fixture/current package equivalent
```

Confirm package contents exclude repository-local `.scrumrun/` state, caches, migration records, backups, vaults, tests, and secrets. The `.scrumrun/` directory inside project templates is expected. Confirm package metadata, README, changelog, tarball filename, checksum, and Git tag agree on `2.1.0`; SPEC, CORE, artifact frontmatter, migration, and installed skill continue to declare method `2.0.0`.

Record the local evidence and residual risks against [`RELEASE-SCORECARD.md`](./RELEASE-SCORECARD.md). Scores describe local readiness only and never replace registry smoke or owner approval.

## Optional registry candidate (separate owner approval required)

1. Set a new unpublished prerelease such as `2.1.0-rc.1` and create a reviewed commit.
2. `npm pack`; record tarball SHA-256/integrity.
3. Publish to `next`, never `latest`:

   ```bash
   npm publish --tag next
   ```

4. Install from the registry into a clean fixture.
5. Run init, intake/approval, memory confirmation/query, v1 update preflight/apply/rollback, doctor, and uninstall.
6. Fix findings in a new RC; never replace an already-published version.

An RC is immutable. Fixes create `rc.2`, `rc.3`, and so on. Skipping an RC does not skip any local, tarball, owner, registry-smoke, or final-promotion gate.

## Final release (new owner approval required)

1. Set `2.1.0`, rerun every local gate, inspect the exact tarball, and create the final local metadata commit.
2. Stop and request explicit owner authorization for each external boundary.
3. Publish npm `2.1.0` to `next` using the reviewed tarball/source commit (`npm publish --tag next`); never publish from a changed worktree and do not move `latest` yet.
4. Install the registry artifact in a clean fixture and run init, intake/approval, Run lifecycle, memory query, v1 migration apply/rollback, doctor, and uninstall.
5. Only after registry smoke passes, create/push tag `v2.1.0`, promote/verify `latest` with an explicit dist-tag command, and create the GitHub release from `CHANGELOG.md` with the migration guide and checksum.
6. Verify npm metadata, dist-tags, Git tag/commit, GitHub release, README, and checksums all agree.

## Recovery

- RC defect: publish another RC; keep `latest` unchanged.
- Final package defect before `latest`: do not promote; publish a new patch after correction because `2.1.0` cannot be replaced.
- Defect after `latest`: assess deprecation vs immediate patch; never overwrite/unpublish without explicit owner decision and current npm-policy review.
- Migration issue: stop promotion, preserve registry artifact/checksum, use the documented rollback fixture, and publish a corrected version.
