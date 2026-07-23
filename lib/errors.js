"use strict";

// Stable ScrumRun error catalog.
//
// Codes are permanent once assigned. Never reuse a retired code. When
// removing an error site, keep its entry with { retired: true } instead
// of deleting it so external logs stay resolvable.
//
// Ranges (soft, for readability):
//   SR-E-001..049  request/intake and approval
//   SR-E-050..099  approvals, tokens, and secrets
//   SR-E-100..149  runs, task/run transitions, ledger
//   SR-E-150..199  guardrails, policy, obligations
//   SR-E-200..249  edit permits (Mutation Gateway)
//   SR-E-250..299  transactions and recovery
//   SR-E-300..349  memory (facts, decisions, insights, dossiers, vault)
//   SR-E-350..399  semantic index, code intelligence
//   SR-E-400..449  migration and update
//   SR-E-450..499  conformance and doctor
//   SR-E-500..549  configuration and installation

const CATALOG = Object.freeze({
  // Request / intake
  "SR-E-001": { summary: "Intake request is missing.", remediation: "Provide a natural-language request or use --request \"...\"." },
  "SR-E-002": { summary: "Intake payload contains secret-like content.", remediation: "Remove the secret from the request or reference a vault entry by path." },
  "SR-E-003": { summary: "Intake classification could not be produced.", remediation: "Rephrase the request in one sentence describing the observable problem." },

  // Approvals
  "SR-E-050": { summary: "Approval token is malformed.", remediation: "Re-run the intake and copy the token exactly as printed after 'Approval:'." },
  "SR-E-051": { summary: "Approval token signature does not match this repository.", remediation: "Tokens are bound to the project fingerprint. Re-run intake from the repo the change targets." },
  "SR-E-052": { summary: "Approval token expired.", remediation: "Re-run intake to obtain a fresh token before approving." },

  // Runs and ledger
  "SR-E-100": { summary: "Run not found.", remediation: "Check the RUN-NNN id with `sc plan run --list`." },
  "SR-E-101": { summary: "Run ledger contains an invalid event.", remediation: "Inspect the reported event id; use `sc plan run --render` for a human view or restore from git history." },
  "SR-E-102": { summary: "Run transition rejected: missing validation or learning evidence.", remediation: "Complete `--validate` and `--learn` with typed evidence before `--complete`." },
  "SR-E-103": { summary: "Retry rejected because the previous Run is still active.", remediation: "Complete, fail, or block the current Run before creating a retry." },

  // Guardrails
  "SR-E-150": { summary: "Guardrail check blocked the operation.", remediation: "Read the reported GR-NNN, satisfy or retire it explicitly; guardrails never bypass silently." },
  "SR-E-151": { summary: "Guardrail obligation is still pending.", remediation: "Resolve each `pending guardrail` via `sc plan run --satisfy-guardrail` before completing the Run." },
  "SR-E-152": { summary: "Guardrail declaration is malformed.", remediation: "Every active guardrail requires Status, Enforcement, Scope, and Rule fields; check .scrumrun/guardrails.md." },

  // Edit permits (Mutation Gateway)
  "SR-E-200": { summary: "No edit permit for this path.", remediation: "Request one with `sc plan run --authorize-mutation RUN-NNN --path <path>` before editing canonical or source files." },
  "SR-E-201": { summary: "Edit permit expired.", remediation: "Permits last 15 minutes. Authorize a new one and record the change immediately." },
  "SR-E-202": { summary: "Edit permit path scope mismatch.", remediation: "The permit does not cover the modified path. Request a new permit that lists it." },
  "SR-E-203": { summary: "File hash changed unexpectedly since the permit was issued.", remediation: "Someone else modified the file. Re-plan the change and request a fresh permit." },

  // Transactions and recovery
  "SR-E-250": { summary: "Pending kernel transaction cannot be recovered automatically.", remediation: "Run `sc config doctor --recover --dry-run` to preview; if it shows 'would overwrite owner changes', reconcile the file manually before applying." },
  "SR-E-251": { summary: "Journal fails integrity check.", remediation: "Inspect .scrumrun/.transactions/pending. Do not delete; contact support or restore from backup." },

  // Memory
  "SR-E-300": { summary: "Memory candidate rejected: missing resolvable evidence.", remediation: "Attach at least one --evidence path or `sc knowledge <subject> --propose` before `--confirm`." },
  "SR-E-301": { summary: "Attempt to write into vault via canonical channel.", remediation: "vault.local.md is local-only and never indexed. Edit the file directly." },

  // Semantic index / code intel
  "SR-E-350": { summary: "Semantic index is stale.", remediation: "Rebuild with `sc knowledge map --build`. Cache is disposable; canonical memory is unaffected." },
  "SR-E-351": { summary: "Search backend advertised in the cache does not match this runtime.", remediation: "Delete .scrumrun/.cache/semantic-index.sqlite and re-run any `sc knowledge` query to rebuild against the current runtime." },

  // Migration
  "SR-E-400": { summary: "Migration preflight failed.", remediation: "Run `npx scrumrun@latest update` (dry) to see blockers, resolve them, then apply with `--migrate`." },
  "SR-E-401": { summary: "Migration rollback requested but no backup was found.", remediation: "Rollback needs the ignored byte-exact backup created during --migrate. Restore from version control if the backup is gone." },

  // Conformance / doctor
  "SR-E-450": { summary: "Conformance check failed.", remediation: "The reported invariant identifies the exact violation; the message includes the file and expected shape." },
  "SR-E-451": { summary: "Installed client asset is stale.", remediation: "Re-run `npx scrumrun@latest update` for the specific client. `doctor --strict` shows which files diverge." },

  // Configuration / install
  "SR-E-500": { summary: "ScrumRun project not initialized.", remediation: "Run `npx scrumrun@latest init` in the repository root." },
  "SR-E-501": { summary: "Unsupported Node.js runtime.", remediation: "ScrumRun requires Node.js >=22.13.0 for native SQLite. Upgrade Node and retry." }
});

class ScrumRunError extends Error {
  constructor(code, message, options = {}) {
    const entry = CATALOG[code];
    if (!entry) throw new Error(`Unknown ScrumRun error code: ${code}`);
    const composed = message || entry.summary;
    super(`${code} ${composed}`);
    this.name = "ScrumRunError";
    this.code = code;
    this.summary = entry.summary;
    this.remediation = entry.remediation;
    if (options.cause) this.cause = options.cause;
    if (options.details) this.details = options.details;
  }
}

function describe(code) {
  return CATALOG[code] || null;
}

function codes() {
  return Object.keys(CATALOG).sort();
}

module.exports = { ScrumRunError, describe, codes, CATALOG };
