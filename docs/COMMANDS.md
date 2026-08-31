# ScrumRun 3.0 Command Reference

The canonical grammar is:

```text
scrumrun <noun> <subject> <action> [args]
```

Use the installed `scrumrun` command for all normal project work. `/sc` is an optional AI-client shortcut and `scrumrun sc ...` remains a compatibility alias. Do not use `npx scrumrun@latest` inside an agent's execution loop.

## Plan

```text
scrumrun plan intake <request>
scrumrun plan intake --approve <token>
scrumrun plan task --add|--list|--show|--run|--audit|--cancel|--retry
scrumrun plan sprint --add|--list|--show|--start|--complete|--block
scrumrun plan feature --add|--list|--show|--activate|--complete
scrumrun plan run --list|--show|--validate|--learn|--complete|--resume|--fail|--block [--note] [typed evidence flags]
scrumrun plan run --finalize RUN-NNN [--summary "technical recap"] [--note]
scrumrun plan run --authorize-mutation RUN-NNN --path <relative-path> [--path ...]
scrumrun plan run --record-mutation RUN-NNN --permit MUT-id [--note] [--actor]
scrumrun plan run --satisfy-guardrail RUN-NNN --guardrail GR-NNN [typed evidence flags]
scrumrun plan challenge <question>
```

Normal execution is Markdown-first: after approval, work in code and the linked Task, then use one `--finalize` checkpoint. It verifies every workspace change and all Guardrail evidence before writing the Run transitions. A retry requires a failed, blocked, or partial Task and creates a new Run. Mutation permits are available only for explicitly requested strict mode.

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
scrumrun config update [all|codex|opencode|claude] [--migrate]
scrumrun config migrate --to 2 --dry-run|--apply|--rollback
scrumrun config doctor [all|codex|opencode|claude] [--strict] [--recover]
scrumrun config uninstall --force
scrumrun config help <topic>
```

Top-level CLI aliases (`init`, `update`, `migrate`, `doctor`, `uninstall`, `status`) remain available for shell automation. Ordinary update runs only a read-only migration preflight; `--migrate` is explicit application consent.

Run transitions accept typed evidence through `--command`, `--test`, `--file`, `--review`, `--decision`, `--insight`, `--risk`, or generic `--evidence kind:value`. `doctor --recover` is an explicit write that resolves only safe pending kernel transactions; doctor without it remains read-only.

Run `scrumrun commands` for grammar rendered directly from the current manifest.
