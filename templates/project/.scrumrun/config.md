# ScrumRun Project Config - {{PROJECT_NAME}}

Method Version: 2.0.0
CLI Target: 2.0.0
Language: English
Interaction Mode: guided
Execution Approval: always
Quick Tasks: ask
Agent Identity: agent

These are operating preferences. They can never weaken `.scrumrun/guardrails.md`.

`Agent Identity` is the default agent name recorded as the Task `assignee` and Run event `actor`. In shared teams, prefer the per-agent `SCRUMRUN_AGENT` environment variable over this project-wide default.
