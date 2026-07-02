---
description: Manage local development secrets in .scrumrun/vault.local.md
argument-hint: --add|-a <name:value>, --list|-l, --show|-s <name>, --remove|-r <name>
---

Manage the local development vault in `.scrumrun/vault.local.md`: $ARGUMENTS

This vault is for development-only credentials and local test values. It is plaintext Markdown, not encrypted storage, and must never be committed or used for production secrets.

Rules:

1. Store values only in `.scrumrun/vault.local.md`.
2. Ensure `.scrumrun/vault.local.md` is listed in `.git/info/exclude` when the project is a Git repository.
3. Never copy vault values into sprint history, backlog, knowledge, reviews, decisions, commits, logs, or normal answers.
4. For `--list`, show ids/names only and redact values.
5. For `--show`, reveal only the explicitly requested local value.
6. For `--add`, accept either `<name:value>`, `<name=value>`, or `<name> <value>`.
7. For `--remove`, delete the requested entry.
8. Do not modify application code.

Actions:

- `--add` (`-a`) `<name:value>`: add or append a local development secret.
- `--list` (`-l`): list local vault entries with values redacted.
- `--show` (`-s`) `<id|name>`: show one local value.
- `--remove` (`-r`) `<id|name>`: remove one local value.
- `--path`: show the vault file path.
