# AGENTS.md - {{PROJECT_NAME}}

## ScrumRun 3.0

This project uses ScrumRun. The method is mandatory; the direct CLI is `scrumrun <noun> <subject> <action>`. `/sc` is only an optional client shortcut.

For normal work, read:

1. `.scrumrun/guardrails.md` — canonical project policy;
2. `.scrumrun/state.md` — the briefing: active work, recent completions, open decisions, active memory, backlog queue, and pointers;
3. the referenced Task, Sprint, Feature, Run, Memory, and Review artifacts relevant to the request (go deeper only when the briefing lacks what you need);
4. `.scrumrun/core.md` when the method contract or an exceptional transition is needed.

Natural-language product requests automatically enter the read-only ScrumRun intake pipeline. Before explicit approval, do not create canonical records or modify application code.

After approval:

- Task is the atomic work item; define its `## Acceptance Criteria` before execution;
- validation is scoped: only a test/review/environment explicitly required by the owner, the Task's Acceptance Criteria, or an active Guardrail can block completion; a missing optional E2E suite is a documented follow-up/risk, never a reason to fail an otherwise accepted Task;
- before a Task starts, amend its intended scope through `scrumrun plan task --amend TASK-NNN` (including `--section "Heading=content"`); never hand-edit canonical planning Markdown;
- Sprint is only a real timebox/batch of Tasks;
- Run is one execution attempt and follows `executing → validating → learning → completed|failed|blocked`;
- a retry creates a new Run and preserves the old one;
- record a `## Technical Summary` at completion so the next agent inherits what was done;
- work directly in code and the linked Task Markdown after approval; do not call `npx scrumrun@latest` during execution;
- record one `## Guardrail Evidence` line per non-automatic guardrail in the Task, then run `scrumrun plan run --finalize RUN-NNN` once to validate and close the Run;
- when a Run completes and work remains queued, surface it with `scrumrun plan task --next` and start it with `scrumrun plan task --start` — starting is explicit approval;
- learning proposes evidence-backed Knowledge, Decisions, or candidate Insights;
- the final checkpoint verifies all Guardrails, workspace changes, protected paths, and secret boundaries before completion; use the path-scoped Mutation Gateway only when the owner requests strict execution.

Never bypass guardrails or edit around the Mutation Gateway, overwrite owner work, treat generated state/cache as truth, auto-confirm AI knowledge, auto-migrate a v1 project, or print vault values.

Never use `npx scrumrun@latest` in the normal work loop. If the installed CLI is unavailable, stop and report that blocker rather than substituting a network command.
