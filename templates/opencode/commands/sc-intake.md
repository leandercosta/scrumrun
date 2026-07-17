---
description: Route a natural-language request through ScrumRun and ask before acting
argument-hint: problem, desired change, or idea
---

Run ScrumRun natural-language intake for: $ARGUMENTS

Read `AGENTS.md`, `.scrumrun/core.md`, `.scrumrun/golden-rules.md`, `.scrumrun/config.md`, `.scrumrun/token-policy.md`, `.scrumrun/context.md`, `.scrumrun/map.md`, `.scrumrun/project.md`, `.scrumrun/knowledge.md`, and only the backlog, plans, history, decisions, feature files, and source areas relevant to classifying this request. Relevant history is mandatory. Use only approved knowledge as planning truth.

Determine the desired outcome, urgency, scope, risk, uncertainty, and relationship to the main goal. Route the request to exactly one recommended workflow:

- quick task;
- knowledge or discovery;
- main-goal sprint;
- corrective fix linked to prior work;
- backlog candidate;
- isolated feature lane;
- reject or defer.

Follow `Interaction Mode`, `Execution Approval`, and `Quick Tasks` from `.scrumrun/config.md`. In guided mode, return the classification, recommendation with rationale, important evidence, material risks or unknowns, and at most two useful alternatives. Ask one clear approval question when required; otherwise state which configured policy authorizes the next transition.

Intake is read-only. Do not create or update planning records, modify application code, run tests as implementation verification, execute a sprint, or interpret an ambiguous acknowledgement as approval. After explicit approval, invoke the matching canonical workflow using `--add`, `--set`, `--update`, `--remove`, `--run`, `--audit`, `--approve`, or `--reject` as appropriate.
