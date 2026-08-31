# AGENTS.md - {{PROJECT_NAME}}

## ScrumRun 4.0 lean read policy — execution-first Markdown

This project stores the complete ScrumRun v2 truth but uses a bounded default read path:

1. `.scrumrun/guardrails.md`;
2. `.scrumrun/state.md` — the briefing: active work, recent completions, open decisions, active memory, backlog queue, and pointers;
3. only canonical artifacts referenced by the briefing's pointers (go deeper only when the briefing lacks what you need);
4. `.scrumrun/core.md` only when method details are needed.

Do not scan every Task, Run, Sprint, Feature, or Memory file by default. Generated `state.md`, `map.md`, and `.cache/` guide retrieval but never override canonical Markdown.

Natural-language product work begins as a read-only understanding pass. Explicit approval authorizes direct work in source files and `.scrumrun/` Markdown. Execute continuously until the approved Task is delivered: keep working through discover → implement → verify → fix → verify. A progress report is allowed only when the owner asks for status and must be followed immediately by more execution; it never closes the workflow. Do not stop to provide an inventory, a partial progress report, or a list of remaining work. A missing implementation found during the work remains work to do now, not a follow-up or “next step”. Define a short `## Done when` delivery contract, record `## Completion` only at the end, and never move unfinished contract work to `## Follow-ups` without explicit owner approval. A Run is optional handoff/audit context, not a state machine that may prevent starting, amending, or completing work. A Sprint exists only for a real batch/timebox.

Guardrails are mandatory, but administrative state is not: block only for an explicit Guardrail, security/secret risk, destructive action without approval, or an unmet required Acceptance Criterion. Missing Runs, invalid legacy status vocabulary, stale generated views, and optional unrun tests are warnings to reconcile in Markdown. Record meaningful optional coverage gaps under `## Follow-ups`; they do not fail a delivered Task.

`.scrumrun/guardrails.md` is canonical policy. Never bypass it, overwrite owner work, auto-confirm AI knowledge, auto-migrate v1 state, or print vault values.

`core.md` and `guardrails.md` are sealed policy. Never edit them during a product Task. A policy change requires an explicit owner request and `scrumrun update --project --seal-policy` after review.

Artifacts are local Markdown connected by stable IDs and relative links. Preserve owner-defined frontmatter and sections in each Task; Guardrails may require a section only on affected Tasks.

Use the installed CLI only for `init`, `update --project`, `migrate`, `repair`, `doctor`, reports, and release checks. For daily product work, follow `.scrumrun/core.md` and edit the relevant Markdown directly.

Never invoke `plan run --fail`, `--block`, `--retry`, `--finalize`, `--complete`, `--validate`, or `plan task --start` during normal work. If an old Run says failed for an administrative reason, leave it as history and record the actual delivered outcome in the Task's Technical Summary and Follow-ups.
