# Quickstart

Get from "never heard of it" to your first delivered Task in under 10 minutes.
No `SPEC.md` reading required.

## The three-minute mental model

ScrumRun gives an AI coding agent a small vocabulary and a project memory.

- **Core** — how the agent works; read first and never edited during product work.
- **Guardrails** — rules that cannot be broken.
- **Knowledge** — facts, decisions, insights, and dossiers about the project.
- **Task** — one concrete delivery, independent or inside a Sprint.
- **Sprint** — a feature, fix, or maintenance batch of Tasks. Optional.
- **Feature** — a bigger initiative that groups delivery context.
- **Run** — optional audit/handoff Markdown for a Task or Sprint.

Everything lives as Markdown under `.scrumrun/`. Any Markdown-capable agent
can follow it.

## Install

You need Node.js 22.13 or newer.

```bash
scrumrun install    # installs the agent integration for your client
scrumrun init       # creates the .scrumrun/ tree in the current repo
```

By default `.scrumrun/` is added to `.git/info/exclude` — the methodology
stays local to your machine. Add `--shared` to `init` if your team wants
to commit it.

## Your first intake

You do not have to remember any commands. Just describe the problem in
natural language to your AI client. ScrumRun classifies it before writing
anything.

```
Owner: The checkout charges twice when the page is refreshed.
```

The agent responds with an intake summary:

```
Classification: Task (fix)
Risk: high — financial path
Why: Payment behavior changed after completed work; corrective Task
     linked to the original Run history.
Next: scrumrun plan intake "double charge on refresh"
Awaiting owner approval.
```

Nothing has been written yet. The classification, risk, and plan are
proposals. Approving is one command:

```bash
scrumrun plan intake --approve <token>
```

In an interactive terminal, the output is rendered as a boxed intake
pipeline with the exact structure shown on the landing page. Pipe the
command (`| less`, `> intake.txt`) or set `NO_COLOR=1` to get the plain
Markdown summary instead; add `--json` for a fully structured payload
you can feed to CI or a downstream tool.

Only then does the Task become approved. The agent executes it directly in code and Markdown; a Run is optional.

## Delivering the Task

The agent executes inside the approved scope until `## Done when` is true.
It does not stop after an inventory, partial fix, or progress report. Any
missing implementation discovered in scope is work to do now, not a follow-up.

```
TASK-001
  → inspect the duplicate-submit path
  → implement the fix
  → run the relevant checks
  → correct failures
  → write ## Completion and status: completed
```

A Run may be added when a strict audit or detailed handoff is useful. It never
needs to exist for normal work to start or finish.

You can render a Run's ledger as a human timeline instead of reading the
raw JSON:

```bash
scrumrun plan run --render RUN-001
```

For aggregate signal across every Run in the project — status mix, p50
and p95 time in `VALIDATING`, retries per Task, guardrail check counts —
use `--stats`:

```bash
scrumrun plan run --stats
scrumrun plan run --stats --task TASK-001
scrumrun plan run --stats --json
```

## Reading the memory

As you work, the project accumulates:

- **Facts** (`K-NNN`) — reviewed truths about the code.
- **Decisions** (`DEC-NNN`) — normative choices that constrain future work.
- **Insights** (`INS-NNN`) — context, rationale, warnings, trade-offs.
- **Dossiers** (`DOS-NNN`) — curated topic or module deep-dives.

Nothing becomes canonical without confirmation. AI extraction creates
candidates; you promote them with evidence.

```bash
scrumrun knowledge insight --propose "..." --evidence src/foo.ts
scrumrun knowledge insight --confirm INS-001
```

Ask the agent things like *"why is calculateFinalPrice in checkout?"* or
*"which decision constrains the pricing module?"* — it answers by reading
the memory index, not by guessing.

## What to read next

- [`docs/INDEX.md`](INDEX.md) — the full documentation map.
- [`CORE.md`](../CORE.md) — the operational guide agents follow at runtime.
- [`docs/SEMANTIC-MEMORY.md`](SEMANTIC-MEMORY.md) — how facts, decisions,
  insights, and dossiers fit together.
- [`docs/TROUBLESHOOTING.md`](TROUBLESHOOTING.md) — for common install and
  migration issues.
- [`SPEC.md`](../SPEC.md) — the formal specification, when you want the
  invariants and state machines.

## Common questions

**Do I have to type commands?** No. Natural language is the primary entry
point. For scripting and reproducibility, use `scrumrun <noun> <subject> <action>`; `/sc` is only an AI-client shortcut.

**What if I already use v1?** Run `scrumrun update` for a
read-only migration preflight, then `update --migrate` when you are
satisfied with the plan.

**Can I hide the `.scrumrun/` tree from Git?** It is hidden by default
(local mode). Use `--shared` if you want to commit it.

**Where do secrets live?** Never in canonical artifacts. Use
`.scrumrun/vault.local.md` for local-only plaintext that is never indexed
and never migrated.

**How do I add my own project rules?** Edit `.scrumrun/guardrails.md`.
Each rule has `Status`, `Enforcement`, `Scope`, and `Rule` fields and gets
a stable `GR-NNN` id.

**What if something goes wrong?** Every user-facing failure carries a
stable `SR-E-NNN` code. Grep it in [`docs/ERROR-CODES.md`](ERROR-CODES.md)
for the exact remediation. If a canonical transaction was interrupted,
preview the repair before running it:

```bash
scrumrun config doctor --recover --dry-run
```
