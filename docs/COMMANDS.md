# ScrumRun 3.0 Command Reference

The canonical grammar is:

```text
/sc <noun> <subject> <action> [args]
```

Use `/sc` inside a supported AI client. The equivalent CLI form is `scrumrun sc ...`. Use `npx scrumrun@latest` only for one-off installation or recovery, never inside an agent's normal execution loop.

## Plan

```text
/sc plan intake <request>
/sc plan intake --approve <token>
/sc plan task --add|--list|--show|--run|--audit|--cancel|--retry
/sc plan sprint --add|--list|--show|--start|--complete|--block
/sc plan feature --add|--list|--show|--activate|--complete
/sc plan run --list|--show|--validate|--learn|--complete|--resume|--fail|--block [--note] [typed evidence flags]
/sc plan run --finalize RUN-NNN [--summary "technical recap"] [--note]
/sc plan run --authorize-mutation RUN-NNN --path <relative-path> [--path ...]
/sc plan run --record-mutation RUN-NNN --permit MUT-id [--note] [--actor]
/sc plan run --satisfy-guardrail RUN-NNN --guardrail GR-NNN [typed evidence flags]
/sc plan challenge <question>
```

Normal execution is Markdown-first: after approval, work in code and the linked Task, then use one `--finalize` checkpoint. It verifies every workspace change and all Guardrail evidence before writing the Run transitions. A retry requires a failed, blocked, or partial Task and creates a new Run. Mutation permits are available only for explicitly requested strict mode.

## Knowledge

```text
/sc knowledge fact --add|--list|--show|--approve|--reject|--deprecate|--invalidate
/sc knowledge decision --add|--list|--show|--resolve|--deprecate|--invalidate
/sc knowledge insight --propose|--list|--show|--confirm|--stale|--reject|--deprecate|--invalidate
/sc knowledge dossier --add|--list|--show|--refresh|--stale|--deprecate|--archive
/sc knowledge context --build|--update|--show|--clear
/sc knowledge map --build|--show
/sc knowledge study <focus>
/sc knowledge vault --add|--list|--show|--remove|--path
```

Creation options include `--title`, `--content`, repeated `--evidence`, repeated `--relation "used_by: Target"`, `--subject type:id`, `--source`, `--source-id`, `--confidence`, `--valid-from`, `--valid-until`, and `--review-trigger`. Promotion options accept repeated `--evidence` and `--note`.

`study` queries the semantic index. `map --build` regenerates both SQLite and bounded `map.md`. `context --clear` deletes only the disposable index.

## Rules and review

```text
/sc rules guardrail --add|--list|--show|--retire
/sc rules reviewer --add|--list|--show|--run
/sc review code --run
/sc review artifact --run
/sc review artifact --record --task TASK-NNN [--run RUN-NNN] [--title "..."] [--evidence "..."]
/sc review migration --run
/sc review release --run
```

`review artifact --run` is read-only and returns a machine-readable 21-invariant project audit. `--record` reruns that audit and persists its exact pass/fail result as a canonical `REV-NNN`; supplied evidence is additive and cannot turn a failed audit into a pass. Other review routes require repository reasoning and remain read-only unless fixes receive separate approval.

## Config and lifecycle

```text
/sc config project --show|--language|--interaction|--approval|--quick-tasks
/sc config init --local|--shared|--lean|--no-agent-hint|--force
/sc config update [all|codex|opencode|claude] [--migrate]
/sc config migrate --to 2 --dry-run|--apply|--rollback
/sc config doctor [all|codex|opencode|claude] [--strict] [--recover]
/sc config uninstall --force
/sc config help <topic>
```

Top-level CLI aliases (`init`, `update`, `migrate`, `doctor`, `uninstall`, `status`) remain available for shell automation. Ordinary update runs only a read-only migration preflight; `--migrate` is explicit application consent.

Run transitions accept typed evidence through `--command`, `--test`, `--file`, `--review`, `--decision`, `--insight`, `--risk`, or generic `--evidence kind:value`. `doctor --recover` is an explicit write that resolves only safe pending kernel transactions; doctor without it remains read-only.

Run `scrumrun commands` for grammar rendered directly from the current manifest.
