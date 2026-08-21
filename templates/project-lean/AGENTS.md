# AGENTS.md - {{PROJECT_NAME}}

## ScrumRun 2.0 lean read policy

This project stores the complete ScrumRun v2 truth but uses a bounded default read path:

1. `.scrumrun/guardrails.md`;
2. `.scrumrun/state.md` — the briefing: active work, recent completions, open decisions, active memory, backlog queue, and pointers;
3. only canonical artifacts referenced by the briefing's pointers (go deeper only when the briefing lacks what you need);
4. `.scrumrun/core.md` only when method details are needed.

Do not scan every Task, Run, Sprint, Feature, or Memory file by default. Generated `state.md`, `map.md`, and `.cache/` guide retrieval but never override canonical Markdown.

Natural-language product work begins as read-only intake. Explicit approval creates/updates a Task and creates one Run. A Sprint exists only for a real batch/timebox. Run state is `executing → validating → learning → completed|failed|blocked`; retries preserve prior Runs. Define the Task's `## Acceptance Criteria` before execution and record a `## Technical Summary` at completion. When work remains queued, surface it with `sc plan task --next` and start it with `sc plan task --start`.

Every application/source edit requires a short-lived path-scoped Mutation Gateway permit and immediate hash recording in the active Run. Resolve all persisted Guardrail obligations before completion; policy/workspace drift fails closed.

`.scrumrun/guardrails.md` is canonical policy. Never bypass it or the Mutation Gateway, overwrite owner work, auto-confirm AI knowledge, auto-migrate v1 state, or print vault values.

Use `/sc <noun> <subject> <action> [args]`; if `/sc` is unavailable, follow `.scrumrun/core.md` manually.
