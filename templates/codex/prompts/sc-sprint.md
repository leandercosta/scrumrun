---
description: Manage main-goal sprints — new, list, status, show, rename, run, audit, fix, discuss, bypass, commit-message
argument-hint: --new|-n [* name], --list|-l, --status|-st [id], --show|-s <id>, --rename|-rn <id> "name", --run|-r [--backlog|-k] <id>, --audit|-a <id>, --fix|-f <id>, --discuss|-d <id>, --bypass|-b, --commit-message|-cm <id>
---

Manage main-goal sprints in `.scrumrun/goals/main/`: $ARGUMENTS

If no action flag is present in `$ARGUMENTS`, list the actions below and stop without guessing an action.

Before any planning or execution action, read `.scrumrun/knowledge.md` and use only `Approved Knowledge` as planning truth.

Actions:

- `--new` (`-n`) `[*] <name>`: create a new sprint in `.scrumrun/goals/main/sprint.md`; prefix the name with `*` to mark priority. Read `.scrumrun/golden-rules.md`, `.scrumrun/config.md`, `.scrumrun/knowledge.md`, `.scrumrun/goals/main/sprint.md`, and `.scrumrun/goals/main/history.md` first. Assign the next available sprint number and add goal, scope, acceptance criteria, dependencies, and suggested verification.
- `--list` (`-l`): read `.scrumrun/goals/main/sprint.md` and `.scrumrun/goals/main/history.md` now and show current sprint status — completed, pending, blocked, next steps. Do not use cached context. Do not modify files.
- `--status` (`-st`) `[id]`: read `.scrumrun/goals/main/sprint.md` and `.scrumrun/goals/main/history.md` now and output only a compact Markdown table with exactly three columns: `Sprint | Breve descricao | Status`. If `[id]` is present, show only that sprint; otherwise show one row per sprint. Keep descriptions brief, derived from the sprint title or goal. Use status labels with emojis: `✅ feito` for completed, `🚧 parcial` for partial, `⛔ bloqueado` for blocked, and `⏳ pendente` when no history entry exists. Do not add narrative before or after the table. Do not modify files.
- `--show` (`-s`) `<id>`: read the same two files now and show the requested sprint with a clear non-technical Goal first, plus scope, acceptance, and history entry.
- `--rename` (`-rn`) `<id> "new name"`: change only the sprint's descriptive label in `.scrumrun/goals/main/sprint.md`; keep its number/id unchanged, since history and backlog reference the number. Note the change in `.scrumrun/goals/main/history.md` as "renamed from X to Y". Do not modify application code.
- `--run` (`-r`) `<id>`: execute the requested sprint with history check, the ScrumRun protocol, and handoff. If `$ARGUMENTS` also includes `--backlog` (`-k`) or `--to-backlog`, do not execute: add the sprint candidate to `.scrumrun/backlog.md`, report the entry, and stop.
- `--audit` (`-a`) `<id>`: read `.scrumrun/goals/main/sprint.md`, `.scrumrun/goals/main/history.md`, and the sprint's changed files now, then audit from current file state. Do not use cached context.
- `--fix` (`-f`) `<id>`: corrective pass on a sprint that went wrong. First ask the user what went wrong and wait for the answer — do not guess. Then propose an executable corrective child sprint and, once the user confirms, create it as `Sprint <id>.M` (a dotted child such as `02.1`, then `02.2`) in `.scrumrun/goals/main/sprint.md`: derive its goal, scope, and acceptance from the problem and link it to parent `<id>`. Leave the parent sprint's recorded plan intact and mark it as patched by the child. Record what happened in `.scrumrun/goals/main/history.md`, capture the lesson in `.scrumrun/knowledge.md` (a pending proposal, or an insight on the relevant `K-NNN` entry — never auto-approved; ask the user to approve it), and log any decision or risk in `.scrumrun/goals/main/decisions.md`. The fix is run later with `/sc-sprint --run <id>.M`. A fix that itself needs fixing becomes a sibling (`<id>.M+1`), not a deeper nest. Also register the fix in `.scrumrun/fixes.md` as `F-NNN` linked to both `<id>` and `<id>.M`. Do not change application code.
- `--commit-message` (`-cm`) `<id>`: return a single, succinct commit message summarizing what that sprint delivered. Read `.scrumrun/goals/main/sprint.md` and `.scrumrun/goals/main/history.md`, plus the sprint's changed files when helpful. Output only the message: one line, imperative mood, lowercase, no trailing period, and as few characters as possible while staying clear. Do not stage, commit, or modify any files.
- `--discuss` (`-d`) `<id>`: read the sprint and history, discuss the user's concern about the approach, and explore better paths.
- `--bypass` (`-b`) `[context]`: set `.scrumrun/config.md` to `Sprint Automation: backlog` for legacy or hand-managed projects, so suggested sprints are treated as backlog candidates until the user chooses what to run. Keep other preferences intact, note the change in `.scrumrun/project.md` or `.scrumrun/goals/main/decisions.md`, and prefer `/sc-backlog --add` and `/sc-backlog --list` for candidate management.

Do not modify application code.
