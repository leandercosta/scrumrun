# AGENTS.md - {{PROJECT_NAME}}

## ScrumRun 3.1 — Markdown-first

This project uses ScrumRun. The method is mandatory; the direct CLI is `scrumrun <noun> <subject> <action>`. `/sc` is only an optional client shortcut.

For normal work, read:

1. `.scrumrun/guardrails.md` — canonical project policy;
2. `.scrumrun/state.md` — the briefing: active work, recent completions, open decisions, active memory, backlog queue, and pointers;
3. the referenced Task, Sprint, Feature, Run, Memory, and Review artifacts relevant to the request (go deeper only when the briefing lacks what you need);
4. `.scrumrun/core.md` when the method contract or an exceptional transition is needed.

Natural-language product requests begin with a read-only understanding pass. Before explicit approval, do not modify application code. After approval, operate directly in `.scrumrun/` Markdown and source files; normal work must not depend on a CLI state transition.

After approval:

- Task is the atomic work item; create or refine its Markdown directly, define its `## Acceptance Criteria`, and retain a short `## Technical Summary` / `## Follow-ups` handoff;
- validation is scoped: only a test/review/environment explicitly required by the owner, the Task's Acceptance Criteria, or an active Guardrail can block completion; a missing optional E2E suite is a documented follow-up/risk, never a reason to fail an otherwise accepted Task;
- Feature and Sprint remain useful organization, but are optional; create them only when they clarify real initiative or timebox context;
- Sprint is only a real timebox/batch of Tasks;
- Run is an optional audit/handoff record, never an administrative prerequisite to start, amend, or complete a Task; preserve useful prior attempts but do not let missing/invalid Run metadata stop work;
- record a `## Technical Summary` at completion so the next agent inherits what was done; record optional missing coverage in `## Follow-ups`;
- work directly in code and Task Markdown after approval; do not call `npx scrumrun@latest` or normal `scrumrun plan/run` commands during execution;
- use the CLI only for `init`, `update --project`, `migrate`, `repair`, `doctor`, reports, or release checks. It audits/repairs the folder; it does not own the daily workflow;
- learning proposes evidence-backed Knowledge, Decisions, or candidate Insights when the work reveals reusable context;
- guardrails remain mandatory: stop only for an explicit Guardrail, security/secret risk, destructive action without approval, or an unmet required Acceptance Criterion. Status vocabulary, missing Runs, unavailable optional tests, and stale generated state are warnings to reconcile, not blockers.

Never bypass guardrails, overwrite owner work, treat generated state/cache as truth, auto-confirm AI knowledge, auto-migrate a v1 project, or print vault values.

Never use `npx scrumrun@latest` in the normal work loop. If the installed CLI is unavailable, stop and report that blocker rather than substituting a network command.
