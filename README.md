# ScrumRun

> A protocol for AI-assisted software development.
> Sprints, decisions, invariants, history — auditable and portable across agents.

**Method:** `1.0` (draft) · **CLI/Skill:** `1.5.0` · **License:** MIT

ScrumRun gives AI coding agents a stable memory, an explicit approval model, and a state machine for the work they do. The method is documented so any markdown-capable agent can follow it. Client-specific integrations (Claude Code, Codex, OpenCode) are optimizations, not requirements.

---

## Install

```bash
npx scrumrun@latest init
```

Local by default: creates `AGENTS.md` and `.scrumrun/`, adds them to `.git/info/exclude`. Use `--shared` to commit them.

---

## Usage

Once initialized, talk to your agent in natural language:

```
add a save button to the profile form
checkout charges twice after refresh
study the payments module
run the next sprint
```

The agent runs intake (read-only), classifies the request, proposes a route, and asks for approval before touching artifacts or code. No configuration silently grants blanket implementation permission.

If you prefer explicit commands, they exist. The canonical grammar uses long flags (`--add`, `--run`, `--audit`, `--approve`). See `CORE.md` for the full reference.

---

## How it works

Three surfaces, physically separated:

- **Project rules** — golden rules and configuration that every agent honors.
- **Main goal** — the primary plan, its sprints, decisions, and history.
- **Feature lanes** — isolated planning that does not pollute the main goal.

Every artifact is a `.md` file under `.scrumrun/` with mandatory frontmatter. State transitions are explicit and recorded in `history.md` (append-only). `context.md` is a token-safe snapshot used as a reading guide — never as authoritative truth.

Fifteen numbered invariants (`I-01`…`I-15`) define behavior that cannot be silently overridden. Golden rules have highest precedence. Intake is strictly read-only. Approval is synchronous and explicit.

---

## Documentation

| File | Purpose |
|---|---|
| [`CORE.md`](./CORE.md) | Operational guide agents follow at runtime. |
| [`SPEC.md`](./SPEC.md) | Formal method specification — state machines, invariants, composition rules. |
| [`DECISIONS.md`](./DECISIONS.md) | ADRs explaining why the method is the way it is. |
| `.scrumrun/config.md` | Owner preferences (language, approval policy, quick-task policy). |
| `.scrumrun/golden-rules.md` | Absolute constraints for the project. |

For AI clients that do not auto-read project instructions, paste this at the start of a session:

```
Read AGENTS.md and .scrumrun/core.md before doing anything else.
Follow ScrumRun exactly.
```

---

## Portability

ScrumRun is designed to outlive specific AI clients. Any agent that reads markdown and follows instructions can implement it by reading `CORE.md`. Slash commands and skills are conveniences, not dependencies.

Compatibility matrix (planned, `method 1.0`):

| Agent | Slash commands | Skill | Manual (CORE.md) |
|---|---|---|---|
| Claude Code | ✓ | ✓ | ✓ |
| Codex | ✓ | — | ✓ |
| OpenCode | ✓ | — | ✓ |
| Any markdown-capable agent | — | — | ✓ |

A conformance test suite is planned under `tests/conformance/` for verifying implementations against the invariants in `SPEC.md`.

---

## Versioning

Three independent version numbers:

- **`method`** — the protocol itself. Major bumps only on breaking spec changes.
- **`cli`** — the installer and command surface.
- **`skill`** — the agent-facing instructions.

Tooling can iterate freely. Adopters pin the method version and update tooling with confidence. Every method change ships with a migration guide.

---

## Status

- ✅ Portable `CORE.md` for cross-agent execution
- ✅ Natural-language intake with approval gates
- ✅ Sprint, feature lane, fix, backlog, decision, knowledge artifacts
- ✅ Golden rules with unbypassable precedence
- ✅ Formal `SPEC.md` and `DECISIONS.md` (method 1.0 draft)
- 🚧 Command grammar consolidation (20 commands → 6, see ADR-013)
- 🚧 Method versioning separated from CLI
- 🚧 Portability matrix + conformance test suite
- 🚧 Landing page at [`scrumrun.dev`](https://scrumrun.dev)

---

## Contributing

The method is public and versioned. Proposals that change spec, invariants, or state machines require an ADR entry in `DECISIONS.md`. Tooling changes follow standard PR flow.

---

## License

MIT © Leander Costa
