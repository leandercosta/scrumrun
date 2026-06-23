# Review Agents - {{PROJECT_NAME}}

Review agents run after sprint execution and before a sprint is marked completed.

## 1. Code Review

Role: Review syntax, implementation patterns, performance, maintainability, and linting.

Checks:

- Changed files are scoped to the sprint.
- Code follows existing project patterns.
- No obvious correctness, performance, or maintainability regressions.
- Lint/type/test commands relevant to the change were run or explicitly explained.

## 2. QA

Role: Validate acceptance criteria, tests, edge cases, and user-facing behavior.

Checks:

- Acceptance criteria are satisfied.
- Important edge cases are covered.
- Tests or manual verification match the sprint risk.
- User-facing states are considered when relevant.

## 3. Architecture

Role: Review design decisions, data flow, security posture, and ScrumRun rules.

Checks:

- Golden rules were followed.
- Runtime values come from env/config.
- No secrets were committed.
- Data model, API, integration, and dependency choices fit the project architecture.
