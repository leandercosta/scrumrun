# ScrumRun Design Decisions

Architectural Decision Records for the ScrumRun method. Each entry captures a decision that shaped the protocol and the reasoning behind it. ADRs are append-only. Superseded decisions stay in the log with a link to the replacement.

Format:

```
## ADR-NNN — <title>
Status: accepted | superseded by ADR-XXX | deprecated
Date: YYYY-MM-DD

**Context** — the problem
**Decision** — what we chose
**Consequences** — what this buys and costs
**Alternatives considered** — what we rejected and why
```

---

## ADR-001 — Markdown as the sole persistence format
Status: accepted
Date: 2026-07-17

**Context** — ScrumRun needs a persistence layer for state that is (a) portable across AI agents, (b) diffable via git, (c) readable by humans without tooling, (d) editable by hand in an emergency.

**Decision** — All ScrumRun state lives in `.md` files under `.scrumrun/`. No SQLite, no JSON, no YAML-only files.

**Consequences** — Any markdown-capable agent can read the full state without a client library. Git history is human-readable. Diffs are meaningful in code review. Cost: parsing is slightly fuzzier than structured formats; frontmatter is used for machine-readable metadata (see I-12).

**Alternatives considered** — JSON: unreadable diffs, requires viewer. SQLite: opaque to non-tool users, breaks portability. YAML-only: less friendly for prose (plans, decisions).

---

## ADR-002 — Approval is synchronous and explicit
Status: accepted
Date: 2026-07-17

**Context** — Agents can act quickly. The line between "understood and helpful" and "acted without permission" is where trust in AI-assisted development breaks.

**Decision** — Approval gates are synchronous checkpoints requiring explicit owner response. There is intentionally no config option to grant blanket implementation permission (see I-01, I-06).

**Consequences** — Slower than fully autonomous execution. But every code change has a recorded owner decision. Cost: friction on trivial tasks — mitigated by the `Quick Tasks: allow` policy, which still cannot override golden rules.

**Alternatives considered** — Async approval (approve later): breaks the "audit trail matches execution" property. Silent execution with rollback: rollback is not a substitute for consent.

---

## ADR-003 — Long flags are canonical
Status: accepted
Date: 2026-07-17

**Context** — Historical commands used inconsistent short aliases (`--new`, positional `approve`, bare knowledge topics). This created ambiguity in agent-generated instructions.

**Decision** — Canonical grammar uses long flags: `--add`, `--set`, `--update`, `--remove`, `--list`, `--show`, `--run`, `--audit`, `--approve`, `--reject`. Legacy aliases remain for compatibility but agents recommend and generate only canonical forms.

**Consequences** — Predictable, self-documenting commands. Agent output is greppable and stable across sessions. Cost: more typing for humans — mitigated by natural-language intake being the recommended entry point.

**Alternatives considered** — Positional subcommands (`sc sprint add`): fine ergonomically, but harder to compose with other flags and less consistent with existing tooling.

---

## ADR-004 — Intake is strictly read-only
Status: accepted
Date: 2026-07-17

**Context** — Intake needs to load enough context to make a good recommendation. Without a clear rule, "loading context" can drift into "starting to work".

**Decision** — Intake may read any file but cannot create, modify, or delete artifacts, nor modify application code (see I-04).

**Consequences** — The autonomy/permission line is bright. Any side effect implies approval happened. Cost: intake sometimes reads context that ends up unused — acceptable price for clarity.

**Alternatives considered** — Allowing intake to create draft artifacts: rejected because it blurs the boundary and creates cleanup burden.

---

## ADR-005 — Main goal and feature lanes are physically separate
Status: accepted
Date: 2026-07-17

**Context** — Feature ideas frequently arrive mid-sprint. Merging them into main sprint history dilutes the narrative of the main goal and makes historical audit harder.

**Decision** — Feature lanes live under `.scrumrun/features/<slug>/` with their own `sprint.md`, `history.md`, `decisions.md`. They share project rules and knowledge but never auto-merge into main goal history (see I-05).

**Consequences** — Main goal history stays coherent. Features can be planned independently and evaluated on their own merit. Cost: two places to look — mitigated by intake reading both and by the `context.md` snapshot summarizing state across lanes.

**Alternatives considered** — Tags within a single history: fails when a feature is abandoned (history is polluted with dead branches).

---

## ADR-006 — Golden rules cannot be silently bypassed
Status: accepted
Date: 2026-07-17

**Context** — Configuration flags that disable safety features are the most common source of preventable damage in AI-assisted workflows.

**Decision** — Active golden rules have highest precedence. There is no command flag, no config option, and no intake path that disables them. Retirement requires explicit owner action and is logged (see I-03, I-08).

**Consequences** — Guarantees that "add rule X" produces durable behavior. Cost: cannot temporarily suspend a rule — must retire, act, re-add. Intentional friction.

**Alternatives considered** — `--force` flag to override: rejected — the value of a rule is precisely that it does not bend under pressure.

---

## ADR-007 — `context.md` is never authoritative
Status: accepted
Date: 2026-07-17

**Context** — Token economy pressure encourages agents to trust cached summaries. A summary that is 90% accurate is a summary that will mislead 10% of the time on production decisions.

**Decision** — `context.md` is a reading guide only. Every planning, editing, review, or completion step must verify against canonical artifacts and source (see I-09).

**Consequences** — Extra reads for accuracy. Cost is real but bounded. Ensures the audit substrate matches reality.

**Alternatives considered** — Making `context.md` cache with TTL and invalidation: too much machinery for insufficient benefit — direct reads are cheap enough.

---

## ADR-008 — Fixes and sprints coexist as distinct kinds
Status: accepted
Date: 2026-07-17

**Context** — A production bug is not a full sprint. Forcing every corrective action through the sprint protocol (plan, review, complete) adds overhead disproportionate to the risk.

**Decision** — Fix is a first-class artifact with a lighter state machine than sprint. If scope grows during execution, `escalate` promotes to sprint while preserving id lineage (see §3.2).

**Consequences** — Right-sized ceremony per risk class. Cost: two kinds to reason about — mitigated by intake handling classification.

**Alternatives considered** — Single "task" kind with priority flag: loses semantic clarity in history ("what was this — feature work or bug?").

---

## ADR-009 — Local by default, not shared
Status: accepted
Date: 2026-07-17

**Context** — Teams have varying preferences on whether AI planning artifacts belong in the repo. Committing them by default surprises new adopters and can leak internal reasoning.

**Decision** — `sc init` is local by default: adds `.scrumrun/` and `AGENTS.md` to `.git/info/exclude`. `--shared` opts into committed mode.

**Consequences** — Solo users get zero friction. Teams make an explicit choice to share. Cost: single-machine memory unless owner opts in.

**Alternatives considered** — Commit by default: surprising for solo users, especially in existing repos.

---

## ADR-010 — Per-agent portability via a single `CORE.md`
Status: accepted
Date: 2026-07-17

**Context** — AI clients evolve rapidly. Any method locked to a single client becomes obsolete when the client stagnates or is replaced.

**Decision** — `CORE.md` is the portable execution guide. Any agent that can read markdown and follow instructions can implement ScrumRun by reading it. Client-specific integrations (slash commands, skills) are optimizations, not requirements.

**Consequences** — ScrumRun outlives specific AI clients. Diversifies risk. Cost: every method change must be expressible as markdown instructions — a healthy constraint.

**Alternatives considered** — Client-specific SDKs: faster to build features, faster to become abandonware.

---

## ADR-011 — Vault is local-only plaintext
Status: accepted
Date: 2026-07-17

**Context** — Development requires access to secrets (API keys, test credentials). A production secret manager is overkill for local development; ad-hoc `.env` files leak into agents' context.

**Decision** — `.scrumrun/vault.local.md` is a plaintext local file, never committed, never printed in agent output (see I-11). It is explicitly not a production secret manager.

**Consequences** — Fast local ergonomics. Cost: relies on discipline — mitigated by the invariant preventing agents from surfacing values.

**Alternatives considered** — Encryption at rest: added friction for a local file whose threat model is "developer's laptop is compromised" — at which point the encryption key is also compromised.

---

## ADR-012 — Method versioning is separate from tooling
Status: accepted
Date: 2026-07-17

**Context** — Users adopting ScrumRun need to know what changes are safe to auto-update and what changes require reviewing their `.scrumrun/` files.

**Decision** — `method`, `cli`, and `skill` versions are independent (see SPEC §10). Tooling can iterate freely; method changes ship with migration guides.

**Consequences** — Stability signal is explicit. Adopters can pin `method: 1.0` and update tooling confidently. Cost: three version numbers to track — mitigated by `/sc config --version`.

**Alternatives considered** — Single version for everything: forces false major bumps whenever tooling changes shape, eroding trust in the version number.

---

## ADR-013 — Six-command grammar (planned, not yet implemented)
Status: proposed
Date: 2026-07-17

**Context** — Twenty `sc-*` commands accumulated organically. Overlap between commands (study/know/map/context, sprint/fix/feature/backlog/goal) suggests the grammar has grown by addition rather than design.

**Decision** — Consolidate the 20 verbs into 6 nouns: `/sc`, `/sc plan`, `/sc knowledge`, `/sc rules`, `/sc review`, `/sc config`. Legacy commands become invisible aliases for one release cycle, then removed.

**Consequences** — Grammar reflects method structure (§4 composition). Discoverability improves without hiding power. Cost: one-time migration effort for existing users — currently only the author.

**Alternatives considered** — Keep 20 with better docs: does not address root cause (design accretion). Reduce to 2 (only intake + one power command): loses the ability to script determin­istically.

---

## ADR-014 — Portuguese is a first-class response language
Status: accepted
Date: 2026-07-17

**Context** — The author works primarily in Portuguese and the method emerged in that context. Forcing English-only interaction excludes the primary user.

**Decision** — `config.md` carries a `language` field. Agents honor it for all conversational output. Artifact content remains in whatever language the owner writes it.

**Consequences** — Method is usable in the owner's native language without translation overhead. Cost: docs and examples may lag between languages — accepted.

**Alternatives considered** — Auto-detect from user input: unreliable across sessions and mixed-language inputs.
