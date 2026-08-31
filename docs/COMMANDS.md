# ScrumRun 3.1 Command Reference

The canonical grammar is:

```text
scrumrun <noun> <subject> <action> [args]
```

Use `.scrumrun/` Markdown for normal project work. `/sc` and the installed CLI are optional maintenance/release tools; do not use `npx scrumrun@latest` inside an agent's execution loop.

## Plan

```text
scrumrun plan intake <request>
scrumrun plan intake --approve <token>
scrumrun plan task --add|--list|--show|--run|--audit|--cancel|--retry --strict
scrumrun plan task --amend TASK-NNN [--title "..."] [--request "..."] [--acceptance "..."] [--section "Heading=content"] [--type fix|task|feature|docs|discovery] [--feature FEAT-NNN|null] [--sprint SPRINT-NNN|null]
scrumrun plan sprint --add|--list|--show|--start|--complete|--block
scrumrun plan sprint --amend SPRINT-NNN [--title "..."] [--timebox "..."] [--exit-gate "..."] [--section "Heading=content"]
scrumrun plan feature --add|--list|--show|--activate|--complete
scrumrun plan feature --amend FEAT-NNN [--title "..."] [--purpose "..."] [--exit-criteria "..."] [--section "Heading=content"]
scrumrun plan run --list|--show|--validate|--learn|--complete|--resume|--fail|--block --strict [--note] [typed evidence flags]
scrumrun plan run --finalize RUN-NNN --strict [--summary "technical recap"] [--note]
scrumrun plan run --authorize-mutation RUN-NNN --path <relative-path> [--path ...]
scrumrun plan run --record-mutation RUN-NNN --permit MUT-id [--note] [--actor]
scrumrun plan run --satisfy-guardrail RUN-NNN --guardrail GR-NNN [typed evidence flags]
scrumrun plan challenge <question>
```

Normal execution is Markdown-first: after approval, work in code and the relevant Task Markdown, then record the Technical Summary and any Follow-ups directly. A Run/`--finalize` checkpoint is optional strict audit, never a prerequisite. Mutation permits are available only for explicitly requested strict mode.

The CLI refuses Task start/retry and all Run state changes unless `--strict` is present. This prevents an agent from accidentally manufacturing a failed/blocked retry during normal work; `--strict` is for an owner-requested audit only.

`--amend` is an optional structured helper. The Markdown-first workflow may adjust Task/Feature/Sprint content directly, preserving a useful handoff. Use the CLI when atomic relation synchronization or machine audit is valuable; do not let status vocabulary or missing relations stop approved work.

Every new Task starts with a `## Validation Scope`: only checks explicitly required by the owner, Acceptance Criteria, or an active Guardrail block completion. Missing optional E2E, integration, or review coverage belongs in a follow-up/risk note; it must not be used to mark the Run failed.

## What can be changed

| Artifact | Canonical operation | Why |
| --- | --- | --- |
| Task, Feature, Sprint | Markdown directly; optional `--add`, `--amend`, lifecycle helpers | Planning truth can be refined at the speed of work. |
| Run | optional Markdown handoff; CLI transitions/`--finalize` for strict audit | Useful operational history, never an administrative work gate. |
| Review | `--run` / `--record` | A verdict is evidence, not editable prose. Record another review if it changes. |
| Knowledge, Decision, Insight, Dossier | create + lifecycle commands | Preserve evidence lineage; supersede/deprecate rather than rewrite confirmed truth. |
| Guardrail | `--add` / `--retire` | Policy history must remain auditable. |
| `state.md`, `map.md`, cache | rebuild commands | Derived projections, never manually edited. |

## Knowledge

```text
scrumrun knowledge fact --add|--list|--show|--approve|--reject|--deprecate|--invalidate
scrumrun knowledge decision --add|--list|--show|--resolve|--deprecate|--invalidate
scrumrun knowledge insight --propose|--list|--show|--confirm|--stale|--reject|--deprecate|--invalidate
scrumrun knowledge dossier --add|--list|--show|--refresh|--stale|--deprecate|--archive
scrumrun knowledge context --build|--update|--show|--clear
scrumrun knowledge map --build|--show
scrumrun knowledge study <focus>
scrumrun knowledge vault --add|--list|--show|--remove|--path
```

Creation options include `--title`, `--content`, repeated `--evidence`, repeated `--relation "used_by: Target"`, `--subject type:id`, `--source`, `--source-id`, `--confidence`, `--valid-from`, `--valid-until`, and `--review-trigger`. Promotion options accept repeated `--evidence` and `--note`.

`study` queries the semantic index. `map --build` regenerates both SQLite and bounded `map.md`. `context --clear` deletes only the disposable index.

## Rules and review

```text
scrumrun rules guardrail --add|--list|--show|--retire
scrumrun rules reviewer --add|--list|--show|--run
scrumrun review code --run
scrumrun review artifact --run
scrumrun review artifact --record --task TASK-NNN [--run RUN-NNN] [--title "..."] [--evidence "..."]
scrumrun review migration --run
scrumrun review release --run
```

`review artifact --run` is read-only and returns a machine-readable 21-invariant project audit. `--record` reruns that audit and persists its exact pass/fail result as a canonical `REV-NNN`; supplied evidence is additive and cannot turn a failed audit into a pass. Other review routes require repository reasoning and remain read-only unless fixes receive separate approval.

## Config and lifecycle

```text
scrumrun config project --show|--language|--interaction|--approval|--quick-tasks
scrumrun config init --local|--shared|--lean|--no-agent-hint|--force
scrumrun config update [all|codex|opencode|claude] [--project] [--migrate]
scrumrun config migrate --to 2 --dry-run|--apply|--rollback
scrumrun config doctor [all|codex|opencode|claude] [--strict] [--recover]
scrumrun config uninstall --force
scrumrun config help <topic>
```

Top-level CLI aliases (`init`, `update`, `migrate`, `doctor`, `uninstall`, `status`) remain available for shell automation. `update --project` refreshes the packaged Markdown-first Core and recognized generated agent instructions with local backup; ordinary update does not inspect migrations, while `--migrate` explicitly does so and applies the verified plan.

Run transitions accept typed evidence through `--command`, `--test`, `--file`, `--review`, `--decision`, `--insight`, `--risk`, or generic `--evidence kind:value`. `doctor --recover` is an explicit write that resolves only safe pending kernel transactions; doctor without it remains read-only.

Run `scrumrun commands` for grammar rendered directly from the current manifest.
