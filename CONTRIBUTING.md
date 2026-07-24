# Contributing to ScrumRun

Thanks for considering a contribution. ScrumRun is a method-first project: the
same rigor that runs inside the CLI applies to how the CLI itself evolves.

## Ground rules

- Read [`CORE.md`](CORE.md) before proposing behavior changes.
- Read [`SPEC.md`](SPEC.md) before proposing invariants, state transitions, or
  schema shifts.
- Read [`DECISIONS.md`](DECISIONS.md) before rewriting a design — every
  significant choice is captured as an ADR.
- All interaction happens under the [Code of Conduct](CODE_OF_CONDUCT.md).

## Kinds of contribution

### Bug reports

Open a GitHub Issue with:

- Node.js version (`node --version`)
- ScrumRun version (`npx scrumrun --version`)
- Minimal reproduction: exact commands, project layout, expected vs actual
  output
- If applicable: the `SR-E-NNN` code the CLI printed

### Method change proposals

Anything that touches the SPEC — new invariant, new artifact, new lifecycle
step, changed transition — must land as an ADR before the code.

Open a Method Change Proposal Issue with:

- **Motivation** — what problem drove this
- **Proposal** — one paragraph of the change
- **Alternatives considered** — at least one alternative you rejected and why
- **Impact** — what breaks, what needs migration, what invariants shift

The ADR is authored on merge, not before, so discussion stays lightweight until
the shape is stable.

### CLI ergonomics / bug fixes

- Fork, branch, PR against `main`.
- Keep changes small and focused.
- Every user-facing failure should carry a stable
  [`SR-E-NNN`](docs/ERROR-CODES.md) code with summary and remediation.
- The test suite is the contract. `npm test` must stay green.

### Documentation

- Prefer editing existing docs over creating new ones.
- `README.md` is the pitch. `docs/QUICKSTART.md` is the friendly onboarding.
- Deep material goes into `docs/` or into the normative files (`SPEC.md`,
  `CORE.md`).
- Never write new documentation files without a clear audience.

## Development

```bash
git clone https://github.com/leandercosta/scrumrun.git
cd scrumrun
npm test              # runs the full method + code test suite
npm pack --dry-run    # inspects what the published tarball contains
```

The test suite covers artifact conformance, method invariants, migration
safety, semantic memory, run ledger validation, code intelligence, and CLI
grammar. A change is release-ready only when the suite is green in the same
Node.js runtime the release targets.

### Commit messages

- One-line subject in imperative mood ("feat: add …", "fix: …", "docs: …")
- Body explains **why**, not what — the diff shows what
- Reference the SPEC invariant or ADR the change relates to when relevant

### Publishing (maintainers only)

Follow the release checklist in [`docs/RELEASE-SCORECARD.md`](docs/RELEASE-SCORECARD.md).

## Reporting security issues

Do not open a public issue for a security concern. Email
**leander.dev@proton.me** with:

- Description of the vulnerability
- Reproduction steps
- Expected fix

We respond within 72 hours and coordinate disclosure with you.

## Licensing

By contributing, you agree that your contributions will be licensed under
the [MIT License](LICENSE) that covers the project.
