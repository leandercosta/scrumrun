---
description: Deep-study the project — stack, architecture, permissions, risks, and backlog candidates
argument-hint: optional focus area
---

Run a deep ScrumRun study of the project and produce a complete operational understanding. Do not modify files: $ARGUMENTS

Read ScrumRun control files first, then inspect the repository deeply enough to understand:

1. product purpose and active goals;
2. stack, frameworks, package managers, runtime versions, and local commands;
3. architecture, entry points, routing, controllers, services, jobs, and important modules;
4. auth, authorization, roles, permissions, policies, guards, and access boundaries;
5. data model, migrations, seeds, storage, queues, caches, and external state;
6. env/config requirements, secret handling, third-party integrations, and webhooks;
7. deployment/infrastructure clues, CI, test strategy, and observability;
8. legacy risks, security concerns, performance hotspots, brittle areas, and unknowns;
9. current sprint plan, history, decisions, feature lanes, review agents, and backlog.
10. approved knowledge, pending knowledge proposals, and rejected assumptions from `.scrumrun/knowledge.md`.

Prefer precise file references over generic statements. If an area cannot be verified from the repo, say it is unknown and explain what evidence is missing.

When recommending sprints, present them as backlog candidates. Do not create, run, or mark sprints unless the user explicitly asks for `/run-sprint --new`, `/run-backlog --add`, or `/run-sprint --run`.
