# ScrumRun Token Policy - {{PROJECT_NAME}}

This policy reduces token waste without weakening ScrumRun safety.

## Rules

1. Safety beats token economy. Never skip `core.md`, `golden-rules.md`, `config.md`, or relevant history to save tokens.
2. `context.md` is a snapshot, not truth. Use it to choose what to read, then verify against canonical files.
3. Prefer targeted reads over broad dumps. Read specific files, symbols, folders, and ranges when possible.
4. Prefer summaries for large logs, generated output, dependency folders, old reviews, and old history.
5. Do not read `.scrumrun/vault.local.md` unless the user explicitly asks for a local development credential workflow.
6. Do not print vault values in summaries, context, history, decisions, reviews, or commits.
7. Use `map.md` before repeated broad searches.
8. Use approved knowledge before planning. Pending knowledge is not planning truth.
9. When a source is skipped for token economy, say what was skipped and why.
10. If uncertainty affects correctness or safety, read the source even if it costs more tokens.

## Recommended Read Order

```text
AGENTS.md
  -> core.md
  -> golden-rules.md
  -> config.md
  -> token-policy.md
  -> context.md
  -> map.md
  -> project.md
  -> knowledge.md
  -> runbook.md
  -> current backlog / sprint / feature files
  -> agents.md
  -> relevant history + decisions
  -> targeted source files
```

## Output Discipline

- Summarize command output.
- Include exact file references when they matter.
- Avoid pasting large diffs unless requested.
- For tests, report command, result, and relevant failures only.
- For reviews, list findings by severity before summaries.
