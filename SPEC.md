# ScrumRun Method Specification

Version: `method 1.0` · Status: draft for review

This document is the formal specification of the ScrumRun method. `CORE.md` is the operational guide agents follow at runtime. `SPEC.md` is the source of truth for state machines, invariants, and composition rules.

If a conflict exists between `CORE.md` and `SPEC.md`, `SPEC.md` wins and `CORE.md` must be updated.

---

## 1. Terminology

| Term | Definition |
|---|---|
| **Method** | The ScrumRun protocol itself, versioned separately from tooling. |
| **Artifact** | A `.md` file under `.scrumrun/` that represents state or intent. |
| **Goal** | The primary long-lived outcome of the project. Exactly one main goal per project. |
| **Sprint** | A bounded unit of work under the main goal. |
| **Feature lane** | An isolated planning surface for work that should not pollute the main goal. |
| **Fix** | A corrective action for a defect or regression. Lighter than a sprint. |
| **Backlog item** | A candidate for future work. Not active, not committed. |
| **Decision** | A pending question that blocks or shapes execution. |
| **Golden rule** | An absolute constraint. Cannot be silently overridden. |
| **Knowledge fact** | A short, approved statement about the project used during planning. |
| **Dossier** | A deep, topic-focused study persisted as a durable document. |
| **Review agent** | A reusable review persona with defined scope and prompt. |
| **Intake** | The natural-language classifier that routes requests to workflows. |
| **Approval gate** | A synchronous checkpoint requiring explicit owner consent. |

---

## 2. Artifact Catalog

Every artifact lives at a canonical path and carries mandatory frontmatter. Files without valid frontmatter are treated as untrusted context.

### 2.1 Frontmatter schema (universal)

```yaml
---
id: <artifact-id>          # e.g. SPR-042, FIX-007, KNOW-K-013
kind: sprint|fix|feature|goal|backlog|decision|golden|knowledge|dossier|agent|review
status: <see state machine per kind>
created: YYYY-MM-DD
updated: YYYY-MM-DD
method: 1.0                # method version at time of creation
---
```

### 2.2 Path map

| Kind | Path |
|---|---|
| goal (main) | `.scrumrun/goals/main/sprint.md` |
| goal history | `.scrumrun/goals/main/history.md` |
| goal decisions | `.scrumrun/goals/main/decisions.md` |
| feature | `.scrumrun/features/<slug>/feature.md` |
| feature sprint | `.scrumrun/features/<slug>/sprint.md` |
| feature history | `.scrumrun/features/<slug>/history.md` |
| feature decisions | `.scrumrun/features/<slug>/decisions.md` |
| fix | `.scrumrun/fixes.md` (append-only) |
| backlog | `.scrumrun/backlog.md` |
| golden rules | `.scrumrun/golden-rules.md` |
| knowledge facts | `.scrumrun/knowledge.md` |
| dossier | `.scrumrun/knowledge/dossiers/<slug>.md` |
| map | `.scrumrun/map.md` |
| context | `.scrumrun/context.md` |
| config | `.scrumrun/config.md` |
| agents | `.scrumrun/agents.md` |
| reviews | `.scrumrun/reviews/<id>.md` |
| vault (local) | `.scrumrun/vault.local.md` |

---

## 3. State Machines

### 3.1 Sprint

```
proposed ──approve──▶ approved ──run──▶ running ──complete──▶ done
   │                     │                 │
   │                     └──backlog──▶ shelved
   │                                       │
   └──reject──▶ rejected                   └──abort──▶ aborted
                                     
   running ──block──▶ blocked ──unblock──▶ running
```

**Transitions:**
- `proposed → approved`: owner approval required.
- `approved → running`: explicit `--run` or intake execution consent.
- `running → done`: all acceptance criteria met AND review agents passed.
- `running → blocked`: unresolved decision, missing dependency, or golden rule fire.
- `running → aborted`: owner-initiated cancellation. Requires reason in history.
- `approved → shelved`: sent to backlog before execution.

**Invariant references:** I-01, I-02, I-05, I-07.

### 3.2 Fix

```
proposed ──approve──▶ approved ──run──▶ running ──complete──▶ done
                                           │
                                           └──escalate──▶ (becomes sprint)
```

Fix is lighter than sprint: no formal review agents required unless the affected area has agents configured. If scope grows during execution, `escalate` promotes to sprint with the same id lineage recorded in history.

### 3.3 Feature lane

```
proposed ──approve──▶ active ──archive──▶ archived
                        │
                        └──merge-to-main──▶ merged
```

A feature lane is a container for sprints. Its sprints follow the sprint state machine independently. `merge-to-main` folds accepted sprints into main goal history.

### 3.4 Backlog item

```
added ──promote──▶ (becomes sprint|fix|feature)
   │
   └──drop──▶ dropped
```

Backlog items have no execution state. Promotion creates a new artifact.

### 3.5 Decision

```
open ──resolve──▶ resolved
  │
  └──defer──▶ deferred
```

An open decision that blocks a running sprint moves the sprint to `blocked` (see 3.1).

### 3.6 Knowledge fact

```
proposed ──approve──▶ approved ──deprecate──▶ deprecated
    │
    └──reject──▶ rejected (kept for anti-repetition)
```

Only `approved` facts are planning truth. `rejected` facts are preserved to prevent re-proposing the same bad assumption.

### 3.7 Dossier

```
drafted ──approve──▶ current ──update──▶ current ──deprecate──▶ deprecated
```

Every `update` records the previous `commit` hash. A dossier older than the current HEAD by more than N commits (configurable) is marked stale in `context.md`.

### 3.8 Golden rule

```
proposed ──approve──▶ active ──retire──▶ retired
```

Active golden rules cannot be silently bypassed (see I-08). Retirement requires explicit owner action and is logged.

---

## 4. Composition Rules

Which artifact can generate which:

| From ↓ / Generates → | Sprint | Fix | Feature | Backlog | Decision | Knowledge | Dossier |
|---|---|---|---|---|---|---|---|
| Intake | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| Goal (`--set`) | ✓ | — | — | ✓ | ✓ | — | — |
| Sprint (running) | — | ✓ | — | ✓ | ✓ | ✓ | — |
| Fix (running) | ✓ (escalate) | — | — | — | ✓ | ✓ | — |
| Feature (active) | ✓ | ✓ | — | ✓ | ✓ | ✓ | — |
| Study | — | — | — | ✓ | — | ✓ | ✓ |
| Review | — | ✓ | — | ✓ | ✓ | ✓ | — |

Blocking relationships:

- An `open` decision **linked** to a sprint blocks that sprint.
- A `proposed` golden rule does not block anything.
- An `active` golden rule blocks any transition that would violate it.
- A `stale` dossier does not block, but must be surfaced in intake responses.

---

## 5. Precedence

When guidance conflicts, apply in this strict order:

```
1. Golden rules (active)
2. Open decisions linked to current work
3. Approved knowledge facts
4. Current sprint / feature plan
5. Backlog priority
6. Dossiers and map
7. context.md (never authoritative)
```

Higher precedence always wins. Lower precedence never silently overrides.

---

## 6. Invariants

Numbered for stable reference. Every implementation must uphold all of these.

- **I-01** — No sprint may transition from `proposed` to `running` without explicit owner approval.
- **I-02** — No code changes may occur outside a `running` sprint, a `running` fix, or an explicitly authorized quick task.
- **I-03** — An active golden rule cannot be bypassed by any command, flag, or config. Retirement is the only path.
- **I-04** — Intake is read-only. Intake cannot create, modify, or delete artifacts. Intake cannot modify code.
- **I-05** — Main goal history and feature lane history are physically separate files and never merge automatically.
- **I-06** — Approval is synchronous and explicit. Ambiguous acknowledgements (e.g., "ok", "sure") do not constitute approval unless the owner has enabled `Quick Tasks: allow` for that class of action.
- **I-07** — Every state transition writes exactly one entry to the relevant history file. History is append-only.
- **I-08** — Golden rules are checked before every planning or execution workflow. A rule fire during a running sprint moves that sprint to `blocked`.
- **I-09** — `context.md` is never authoritative. All planning must verify against canonical artifacts and source.
- **I-10** — Only `approved` knowledge facts inform planning. `pending` and `rejected` facts are context, not truth.
- **I-11** — Secrets from `vault.local.md` must never appear in history, knowledge, backlog, reviews, commits, or logs.
- **I-12** — Every artifact carries `id`, `kind`, `status`, `created`, `updated`, and `method` frontmatter fields.
- **I-13** — A dossier update must record the source commit hash for drift detection.
- **I-14** — Quick tasks may be executed with `Quick Tasks: allow`, but never bypass golden rules, security checks, or explicit user constraints.
- **I-15** — Rejecting a knowledge fact preserves it in `rejected` state to prevent re-proposing the same assumption.

---

## 7. Intake Protocol (Formal)

Intake is the single natural-language entry point. Formal steps:

1. **Load minimum context:** `core.md`, `golden-rules.md`, `config.md`, `context.md`, and the header of `map.md`.
2. **Interpret intent** using the desired outcome, not keyword matching.
3. **Determine risk class:** trivial / bounded / cross-cutting / sensitive.
4. **Load conditional context** based on risk class:
   - trivial: current sprint header only.
   - bounded: current sprint + relevant dossier + relevant knowledge facts.
   - cross-cutting: full sprint plan + all decisions + map.
   - sensitive: everything in cross-cutting + full history relevant to affected modules.
5. **Classify** into one of: `quick-task`, `discovery`, `sprint`, `fix`, `feature`, `backlog`, `reject`, `clarify`.
6. **Compose response:**
   - Recommendation with rationale.
   - Up to two alternatives with tradeoffs.
   - Risks and unknowns.
   - Explicit approval request.
7. **Wait for approval.** No side effects until owner responds.

Response format is machine-parseable enough to be logged verbatim in `history.md` if the request is approved.

---

## 8. Approval Semantics

Approval is a first-class concept and comes in three kinds:

| Kind | What it permits |
|---|---|
| **Planning approval** | Create planning records (sprint plan, fix plan, backlog item, dossier draft). |
| **Execution approval** | Change application code, run tests, execute review agents. |
| **Structural approval** | Modify golden rules, retire rules, change config, delete artifacts. |

Config policy `Execution Approval: always` requires both planning AND execution approvals separately. `implementation-only` collapses them for the recommended path but still requires an explicit yes before code changes.

There is intentionally no mode that grants blanket implementation permission.

---

## 9. History Semantics

`history.md` files are append-only. Every entry has:

```
## <YYYY-MM-DD HH:MM> · <id> · <transition>
- Owner: <name or "agent-approved">
- Reason: <one line>
- Files touched: <optional list>
- Commit: <optional hash>
```

History is the audit substrate. It answers "what happened, when, and why" without requiring `git log`.

---

## 10. Method Versioning

`method` version is separate from `cli` and `skill` versions.

- **Patch** (`1.0.x`): clarifications, non-normative additions.
- **Minor** (`1.x.0`): additive changes (new artifact kind, new state, new invariant).
- **Major** (`x.0.0`): breaking changes (removed states, changed invariants, changed frontmatter schema, changed path map).

Every method-version change ships with `MIGRATION-<from>-to-<to>.md`.

Tooling versions may change freely. `skill 1.4.2` and `cli 1.4.2` can implement `method 1.0`. A future `skill 2.0.0` can still implement `method 1.0`.

---

## 11. Conformance

An implementation is ScrumRun-compatible if it:

1. Honors every invariant in §6.
2. Implements the state machines in §3 for every artifact it exposes.
3. Enforces precedence in §5.
4. Provides intake per §7 or refuses to accept natural-language requests entirely.
5. Writes history per §9.
6. Declares the `method` version it targets.

A conformance test suite lives at `tests/conformance/` and MUST pass for any release claiming compatibility.

---

## 12. Open Questions

Items to resolve before `method 1.0` freezes. Tracked as `⚠️ revisitar` per plan discipline.

- ⚠️ Should `blocked` be a real state or a decoration on `running`?
- ⚠️ How is a dossier "stale threshold" measured — commits since capture, or file-level touch?
- ⚠️ Should quick tasks generate a lightweight artifact (e.g., `tasks.md` line) or only a history entry?
- ⚠️ Precedence between two active golden rules that conflict — defined explicit order, or rejection at rule creation?
- ⚠️ Do feature lane sprints inherit main goal golden rules automatically, or opt-in?

Resolution goes to `DECISIONS.md` as an ADR when closed.
