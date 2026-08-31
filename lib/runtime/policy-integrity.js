"use strict";

// Daily work is intentionally Markdown-first.  This module keeps the
// enforcement at the boundary: project policy is pinned when ScrumRun is
// initialized/updated and `doctor --strict` / release audits detect drift.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function readRegular(file) {
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) return null;
  return fs.readFileSync(file, "utf8");
}

function expectedCoreFingerprint(packageRoot = path.resolve(__dirname, "../..")) {
  const core = readRegular(path.join(packageRoot, "CORE.md"));
  return core === null ? null : sha256(core);
}

function readPolicyIntegrity(scrumDir) {
  const marker = path.join(scrumDir, "method.json");
  const raw = readRegular(marker);
  if (raw === null) return { marker: null, integrity: null, error: "method.json is missing or unsafe" };
  try {
    const parsed = JSON.parse(raw);
    return { marker: parsed, integrity: parsed.integrity || null, error: null };
  } catch (error) {
    return { marker: null, integrity: null, error: error.message };
  }
}

function sealPolicyIntegrity(scrumDir, { includeGuardrails = false, coreFingerprint = expectedCoreFingerprint() } = {}) {
  const state = readPolicyIntegrity(scrumDir);
  if (state.error) throw new Error(`Cannot seal ScrumRun policy: ${state.error}`);
  const core = readRegular(path.join(scrumDir, "core.md"));
  if (core === null) throw new Error("Cannot seal ScrumRun policy: core.md is missing or unsafe.");
  const guardrails = readRegular(path.join(scrumDir, "guardrails.md"));
  if (guardrails === null) throw new Error("Cannot seal ScrumRun policy: guardrails.md is missing or unsafe.");
  const next = {
    ...state.marker,
    workflow: { ...(state.marker.workflow || {}), daily: "markdown-first" },
    integrity: {
      ...(state.integrity || {}),
      schema: 1,
      core_sha256: sha256(core),
      core_package_sha256: coreFingerprint || sha256(core),
      ...(includeGuardrails || !state.integrity || !state.integrity.guardrails_sha256
        ? { guardrails_sha256: sha256(guardrails) }
        : {})
    }
  };
  return `${JSON.stringify(next, null, 2)}\n`;
}

function auditPolicyIntegrity(scrumDir, { coreFingerprint = expectedCoreFingerprint() } = {}) {
  const state = readPolicyIntegrity(scrumDir);
  if (state.error) return [{ severity: "critical", code: "POLICY_MARKER", message: state.error }];
  const integrity = state.integrity;
  if (!integrity || integrity.schema !== 1) {
    return [{ severity: "warning", code: "POLICY_INTEGRITY_UNSEALED", message: "Policy fingerprints are not sealed. Run `scrumrun update --project --seal-policy` after owner review." }];
  }
  const findings = [];
  const core = readRegular(path.join(scrumDir, "core.md"));
  const guardrails = readRegular(path.join(scrumDir, "guardrails.md"));
  if (core === null) findings.push({ severity: "critical", code: "CORE_UNSAFE", message: "core.md is missing or unsafe." });
  else {
    const actual = sha256(core);
    if (actual !== integrity.core_sha256) findings.push({ severity: "high", code: "CORE_TAMPERED", message: "core.md differs from the owner-sealed policy. Restore it with `scrumrun update --project`." });
    if (coreFingerprint && actual !== coreFingerprint) findings.push({ severity: "high", code: "CORE_PACKAGE_DRIFT", message: "core.md differs from the installed ScrumRun Core. Review then run `scrumrun update --project`." });
  }
  if (guardrails === null) findings.push({ severity: "critical", code: "GUARDRAILS_UNSAFE", message: "guardrails.md is missing or unsafe." });
  else if (sha256(guardrails) !== integrity.guardrails_sha256) {
    findings.push({ severity: "high", code: "GUARDRAILS_TAMPERED", message: "guardrails.md changed after owner sealing. Review it, then explicitly run `scrumrun update --project --seal-policy`." });
  }
  return findings;
}

module.exports = { auditPolicyIntegrity, expectedCoreFingerprint, sealPolicyIntegrity, sha256 };
