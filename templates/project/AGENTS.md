# AGENTS.md - {{PROJECT_NAME}}

## ScrumRun 4.0 — execution-first Markdown

This project uses ScrumRun. The method is mandatory; the direct CLI is `scrumrun <noun> <subject> <action>`. `/sc` is only an optional client shortcut.

For normal work, read:

1. `.scrumrun/guardrails.md` — canonical project policy;
2. `.scrumrun/state.md` — the briefing: active work, recent completions, open decisions, active memory, backlog queue, and pointers;
3. the referenced Task, Sprint, Feature, Run, Memory, and Review artifacts relevant to the request (go deeper only when the briefing lacks what you need);
4. `.scrumrun/core.md` when the method contract or an exceptional transition is needed.

Natural-language product requests begin with a read-only understanding pass. Before explicit approval, do not modify application code. After approval, operate directly in `.scrumrun/` Markdown and source files; normal work must not depend on a CLI state transition.

After approval:

- execute continuously until the approved Task is delivered: keep working through discover → implement → verify → fix → verify. A progress report is allowed only when the owner asks for status and must be followed immediately by more execution; it never closes the workflow. Do not stop to send an inventory, a progress report, a decomposition, or a list of work still to do. A missing implementation found during the work remains work to do now, not a follow-up, a “next step”, or a reason to reply. Stop only for an owner decision, external access, an explicit Guardrail, a security/secret risk, destructive work without approval, or an unmet required Acceptance Criterion;
- Task is the atomic work item; create or refine its Markdown directly, define a short `## Done when` delivery contract, and retain a short `## Completion` / `## Follow-ups` handoff;
- you may decompose implementation privately or add linked child Tasks when needed, but do not make the owner manage that decomposition and do not stop after planning it;
- validation is scoped: only a test/review/environment explicitly required by the owner, the Task's Acceptance Criteria, or an active Guardrail can block completion; a missing optional E2E suite is a documented follow-up/risk, never a reason to fail an otherwise accepted Task;
- Feature and Sprint remain useful organization, but are optional; create them only when they clarify real initiative or timebox context;
- Sprint is only a real timebox/batch of Tasks;
- Run is an optional audit/handoff record, never an administrative prerequisite to start, amend, or complete a Task; preserve useful prior attempts but do not let missing/invalid Run metadata stop work;
- only claim a condition validated when the check actually covers that condition; a narrow checker never proves a broad delivery claim. Record a `## Completion` at completion so the next agent inherits what was done; `## Follow-ups` may contain only work outside the approved `## Done when`, never unfinished acceptance work;
- work directly in code and Task Markdown after approval; do not call `npx scrumrun@latest` or normal `scrumrun plan/run` commands during execution;
- use the CLI only for `init`, `update --project`, `migrate`, `repair`, `doctor`, reports, or release checks. It audits/repairs the folder; it does not own the daily workflow;
- never invoke `plan run --fail`, `--block`, `--retry`, `--finalize`, `--complete`, `--validate`, or `plan task --start` in normal work. A failed legacy Run due to administrative state remains historical; write the corrected delivery outcome directly in the Task instead;
- learning proposes evidence-backed Knowledge, Decisions, or candidate Insights after delivery, or only when it materially helps the current implementation; it never interrupts execution;
- guardrails remain mandatory: stop only for an explicit Guardrail, security/secret risk, destructive action without approval, or an unmet required Acceptance Criterion. Status vocabulary, missing Runs, unavailable optional tests, and stale generated state are warnings to reconcile, not blockers.

`core.md` and `guardrails.md` are sealed policy. Never edit either during a product Task. A policy change requires an explicit owner request; after review, seal it at the maintenance edge with `scrumrun update --project --seal-policy`.

Artifacts are local Markdown connected by stable IDs and relative links. Preserve any owner-defined frontmatter and sections in a Task. A Guardrail may require sections such as `## Migration Plan`, `## Rollback`, or `## Guardrail Evidence`; add them only to the affected Task.

Never bypass guardrails, overwrite owner work, treat generated state/cache as truth, auto-confirm AI knowledge, auto-migrate a v1 project, or print vault values.

Never use `npx scrumrun@latest` in the normal work loop. If the installed CLI is unavailable, stop and report that blocker rather than substituting a network command.
