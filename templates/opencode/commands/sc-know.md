---
description: Add, approve, reject, update, rename, annotate, remove, show, or list project knowledge
argument-hint: --add <topic>, --approve <id>, --reject <id>, --update <id>, --rename <id> "title", --insight <id> <text>, --remove <id>, --show [id], --list
---

Manage ScrumRun project knowledge in `.scrumrun/knowledge.md`: $ARGUMENTS

Read `.scrumrun/golden-rules.md`, `.scrumrun/config.md`, `.scrumrun/map.md`, `.scrumrun/project.md`, `.scrumrun/knowledge.md`, `.scrumrun/goals/main/history.md`, feature histories when relevant, and source files needed to verify the topic.

Identifiers:

- Each knowledge entry uses a stable id in the form `K-NNN` (for example `K-001`), assigned sequentially.

Flags (may be combined):

- `--add`: investigate a topic and create a pending proposal. A bare topic is a legacy alias.
- `--approve`: approve one pending proposal with explicit owner consent. Positional `approve` is a legacy alias.
- `--reject`: reject one pending proposal. Positional `reject` is a legacy alias.
- `--deep` (`-d`): study the topic deeply and add a code map (see below).
- `--update` (`--edit`, `-e` legacy aliases): rewrite an existing `K-NNN` entry; see edit mode.
- `--rename` (`-rn`): change only the title of an existing `K-NNN` entry; the id never changes.
- `--insight` (`-i`): append a dated reasoning to an existing `K-NNN` entry without rewriting it.
- `--remove` (`-r`, or `--delete`): delete an existing `K-NNN` entry.
- `--show` (`--resume`, `-s` legacy aliases): render knowledge as a clean, readable summary; read-only.

Modes:

1. `list`: show approved knowledge, pending proposals, and rejected proposals. Do not modify files.
2. `approve <id>`: move a pending proposal into `Approved Knowledge` only if the user's approval is explicit. Preserve source references, caveats, date, and approver.
3. `reject <id>`: move a pending proposal into `Rejected Proposals` with the reason when provided.
4. `remove <id>` or `<id> --remove`: delete that `K-NNN` entry from whichever section it is in, and report what was removed.
5. `<id> --edit [text]`: recreate the existing `K-NNN` entry under the same id. If text is supplied, use it as the new basis. If no text is supplied, reuse the entry's current title and insight and re-investigate from source. Combine with `--deep` to rewrite it deeply. The rewritten entry becomes a pending proposal under the same id and must be re-approved.
6. `<id> --rename "new title"`: change only the title of that `K-NNN` entry. The id never changes, and verified facts, code map, status, insights, date, and approver are all preserved. Mention the previous title in the change.
7. `<id> --insight <text>`: append a new dated insight — a reasoning, observation, or hypothesis — to that `K-NNN` entry under an `Insights` log, without changing its verified facts, code map, or status. Insights accumulate: never overwrite earlier ones, and mark them as insights, not verified facts. Create the `Insights` section if it does not exist yet.
8. `<id> --resume` or `--resume` (`-s`): render knowledge as a clean, readable summary instead of raw markdown. With a `K-NNN` id, present that single entry; with no id, present an organized overview of the whole base. Read-only — do not modify files. See the resume output format below.
9. any other text: investigate the topic and create a new pending knowledge proposal with the next `K-NNN` id. Do not put it directly into `Approved Knowledge`. With `--deep`, also build a code map.

For a new or rewritten pending proposal, include:

1. stable id in `K-NNN` form;
2. title;
3. user insight, if supplied;
4. verified facts with file references;
5. assumptions and uncertainty;
6. risks if this knowledge is wrong;
7. affected modules;
8. suggested use in future challenges or sprints;
9. approval prompt;
10. code map, only when `--deep` is used: key functions or symbols with `file:line` or `file:start-end` references, the main entry points and call sites, and the relevant types, config, or storage touchpoints. Short signatures or excerpts are allowed when they clarify behavior. Treat function and symbol names as the stable anchor and line numbers as point-in-time for the proposal date.

Resume output (`--resume`):

Render a scannable digest, not the raw file. For a single `K-NNN` entry, use clear sections:

- a heading line with the id, title, and a status label (Approved, Pending, or Rejected);
- **What it is**: one or two plain-language sentences;
- **Key facts**: bullets, each with its `file:line` reference;
- **Affected modules**: a short list;
- **Code map**: only if the entry has one — functions or symbols with `file:line`, entry points, and call sites;
- **Assumptions & risks**: brief bullets;
- **Suggested use**: where this should inform challenges or sprints;
- a compact footer with status, date, and approver when present.

For the whole base (no id), group entries under Approved, Pending, and Rejected, and show each as a compact card — `K-NNN — Title`, a one-line summary, and its status — sorted by id. Read-only.

Rules:

1. Approved knowledge can influence `/sc-challenge`, `/sc-sprint --add`, `/sc-sprint --run`, and feature planning.
2. Pending proposals are not planning truth. Mention them only as unapproved context.
3. Rejected proposals must not be used for planning except to avoid repeating a known bad assumption.
4. Editing an approved entry returns it to pending for re-approval; never silently keep edited content as approved.
5. Insights are additive, dated annotations: advisory context, not verified planning truth. Adding an insight never rewrites the entry or changes its status. If an insight should become verified knowledge, use `--edit`.
6. Renaming changes only an entry's title; the `K-NNN` id is permanent and must never change.
7. Do not change application code.
8. Do not create sprints, backlog items, feature lanes, or history entries unless the user explicitly asks with another command.
