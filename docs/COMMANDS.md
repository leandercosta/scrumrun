# ScrumRun 2.0 Command Reference

The canonical grammar is:

```text
/sc <noun> <subject> <action> [args]
```

Use `/sc` inside a supported AI client. The equivalent CLI form is `npx scrumrun@latest sc ...`. CLI-native workflows execute immediately; reasoning-heavy routes tell the installed agent to execute the validated workflow.

## Plan

```text
/sc plan intake <request>
/sc plan intake --approve <token>
/sc plan task --add|--list|--show|--run|--audit|--cancel|--retry
/sc plan sprint --add|--list|--show|--start|--complete|--block
/sc plan feature --add|--list|--show|--activate|--complete
/sc plan run --list|--show|--validate|--learn|--complete|--resume|--fail|--block
/sc plan challenge <question>
```

CLI-native: intake/approval, Task/Run list/show, Task retry, and Run transitions. A retry requires a failed, blocked, or partial Task and creates a new Run.

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
/sc review migration --run
/sc review release --run
```

`review artifact --run` is CLI-native and returns a machine-readable 20-invariant project audit. Other review routes require repository reasoning and remain read-only unless fixes receive separate approval.

## Config and lifecycle

```text
/sc config project --show|--language|--interaction|--approval|--quick-tasks
/sc config init --local|--shared|--lean|--no-agent-hint|--force
/sc config update [all|codex|opencode|claude] [--migrate]
/sc config migrate --to 2 --dry-run|--apply|--rollback
/sc config doctor [all|codex|opencode|claude] [--strict]
/sc config uninstall --force
/sc config help <topic>
```

Top-level CLI aliases (`init`, `update`, `migrate`, `doctor`, `uninstall`, `status`) remain available for shell automation. Ordinary update runs only a read-only migration preflight; `--migrate` is explicit application consent.

Run `npx scrumrun@latest commands` for grammar rendered directly from the current manifest.
