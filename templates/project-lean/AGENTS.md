# AGENTS.md - {{PROJECT_NAME}}

## ScrumRun 3.1 lean read policy — Markdown-first

This project stores the complete ScrumRun v2 truth but uses a bounded default read path:

1. `.scrumrun/guardrails.md`;
2. `.scrumrun/state.md` — the briefing: active work, recent completions, open decisions, active memory, backlog queue, and pointers;
3. only canonical artifacts referenced by the briefing's pointers (go deeper only when the briefing lacks what you need);
4. `.scrumrun/core.md` only when method details are needed.

Do not scan every Task, Run, Sprint, Feature, or Memory file by default. Generated `state.md`, `map.md`, and `.cache/` guide retrieval but never override canonical Markdown.

Natural-language product work begins as a read-only understanding pass. Explicit approval authorizes direct work in source files and `.scrumrun/` Markdown. Define the Task's `## Acceptance Criteria` before execution and record a `## Technical Summary` at completion. A Run is optional handoff/audit context, not a state machine that may prevent starting, amending, or completing work. A Sprint exists only for a real batch/timebox.

Guardrails are mandatory, but administrative state is not: block only for an explicit Guardrail, security/secret risk, destructive action without approval, or an unmet required Acceptance Criterion. Missing Runs, invalid legacy status vocabulary, stale generated views, and optional unrun tests are warnings to reconcile in Markdown. Record meaningful optional coverage gaps under `## Follow-ups`; they do not fail a delivered Task.

`.scrumrun/guardrails.md` is canonical policy. Never bypass it, overwrite owner work, auto-confirm AI knowledge, auto-migrate v1 state, or print vault values.

Use the installed CLI only for `init`, `update --project`, `migrate`, `repair`, `doctor`, reports, and release checks. For daily product work, follow `.scrumrun/core.md` and edit the relevant Markdown directly.
