# AGENTS.md - {{PROJECT_NAME}}

## ScrumRun 2.0

This project uses ScrumRun. The method is mandatory; `/sc` is its single optional shortcut.

For normal work, read:

1. `.scrumrun/guardrails.md` — canonical project policy;
2. `.scrumrun/state.md` — the briefing: active work, recent completions, open decisions, active memory, backlog queue, and pointers;
3. the referenced Task, Sprint, Feature, Run, Memory, and Review artifacts relevant to the request (go deeper only when the briefing lacks what you need);
4. `.scrumrun/core.md` when the method contract or an exceptional transition is needed.

Natural-language product requests automatically enter the read-only ScrumRun intake pipeline. Before explicit approval, do not create canonical records or modify application code.

After approval:

- Task is the atomic work item; define its `## Acceptance Criteria` before execution;
- Sprint is only a real timebox/batch of Tasks;
- Run is one execution attempt and follows `executing → validating → learning → completed|failed|blocked`;
- a retry creates a new Run and preserves the old one;
- record a `## Technical Summary` at completion so the next agent inherits what was done;
- when a Run completes and work remains queued, surface it with `sc plan task --next` and start it with `sc plan task --start` — starting is explicit approval;
- learning proposes evidence-backed Knowledge, Decisions, or candidate Insights;
- every application/source edit requires a path-scoped Mutation Gateway permit, immediate hash recording, and resolution of the Run's Guardrail obligations before completion.

Never bypass guardrails or edit around the Mutation Gateway, overwrite owner work, treat generated state/cache as truth, auto-confirm AI knowledge, auto-migrate a v1 project, or print vault values.

If `/sc` is unavailable, follow the equivalent workflow in `.scrumrun/core.md` manually.
