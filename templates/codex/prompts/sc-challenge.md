---
description: Analyze a user challenge and recommend sprint, backlog, feature, discovery, or rejection
argument-hint: challenge description
---

Analyze this challenge against the current project and recommend the safest ScrumRun path. Do not modify files: $ARGUMENTS

Read, when present:

1. `AGENTS.md`;
2. `.scrumrun/golden-rules.md`;
3. `.scrumrun/config.md`;
4. `.scrumrun/map.md`;
5. `.scrumrun/project.md`;
6. `.scrumrun/knowledge.md`;
7. `.scrumrun/backlog.md`;
8. `.scrumrun/goals/main/sprint.md`;
9. `.scrumrun/goals/main/history.md`;
10. `.scrumrun/goals/main/decisions.md`;
11. `.scrumrun/features/*/feature.md`;
12. `.scrumrun/features/*/sprint.md`;
13. `.scrumrun/features/*/history.md`;
14. `.scrumrun/features/*/decisions.md`;
15. relevant source files needed to verify the challenge.

Only use the `Approved Knowledge` section of `.scrumrun/knowledge.md` as planning truth. Pending proposals are unapproved context and must be labeled as such.

The history read is mandatory when any history file exists. Use it to detect repeated work, failed attempts, blockers, partial implementations, regressions, and completed related sprints.

Inspect the repository deeply enough to understand affected areas:

1. product behavior;
2. stack and local commands;
3. architecture and entry points;
4. auth, permissions, roles, policies, and access boundaries;
5. data model, migrations, queues, caches, and external state;
6. env/config, secrets handling, third-party integrations, and webhooks;
7. tests, deployment clues, observability, and operational risk.

Return:

1. Challenge understanding;
2. Approved knowledge used;
3. Relevant evidence with file references;
4. History findings;
5. Impact analysis;
6. Risks and unknowns;
7. Options:
   - create small sprint;
   - add to backlog;
   - create isolated feature lane;
   - run discovery first;
   - reject or defer because it conflicts with architecture, safety, product direction, or missing information;
8. Recommendation with rationale;
9. Suggested next command, such as `/sc-backlog --add ...`, `/sc-sprint --add ...`, `/sc-feature --add ...`, or a clarifying question.

Do not create backlog items, sprint plans, feature lanes, code changes, commits, tests, or history entries unless the user explicitly asks in a follow-up command.
