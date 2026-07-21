"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  ArtifactRepository,
  METHOD_VERSION,
  assertNoSymlinkPath,
  atomicWrite,
  parseArtifact,
  serializeArtifact,
  sha256,
  validateArtifact,
  withArtifactLock
} = require("./artifacts");
const { RUN_LEDGER_VERSION } = require("./schema");
const { migrateLegacyRun, validateRunLedger } = require("../runtime/run-ledger");

const MIGRATION_NAME = "run-ledger-v1";
const MIGRATION_DIR = path.join(".migration", MIGRATION_NAME);
const MANIFEST_PATH = path.join(MIGRATION_DIR, "manifest.json");

function posix(value) {
  return value.split(path.sep).join("/");
}

function backupPath(relative) {
  return posix(path.join(MIGRATION_DIR, "backup", relative));
}

function readMarker(scrumDir) {
  const file = assertNoSymlinkPath(scrumDir, path.join(scrumDir, "method.json"));
  if (!fs.existsSync(file) || !fs.lstatSync(file).isFile()) throw new Error("Canonical method.json is missing or unsafe.");
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    if (value.method !== METHOD_VERSION) throw new Error(`method must be ${METHOD_VERSION}`);
    return { file, value, content: fs.readFileSync(file, "utf8") };
  } catch (error) {
    throw new Error(`Canonical method.json is malformed: ${error.message}`);
  }
}

function planRunLedgerMigration(projectRoot) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  if (!fs.existsSync(scrumDir) || !fs.lstatSync(scrumDir).isDirectory()) throw new Error("Not a ScrumRun project: .scrumrun/ is missing.");
  const marker = readMarker(scrumDir);
  const repository = new ArtifactRepository(scrumDir);
  const changes = [];
  const warnings = [];
  const errors = [];

  for (const artifact of repository.list("run")) {
    if (!artifact.record || artifact.errors.length) {
      errors.push(`${path.relative(scrumDir, artifact.file)}: ${artifact.errors.join("; ")}`);
      continue;
    }
    if (artifact.record.ledger === RUN_LEDGER_VERSION) {
      const ledger = validateRunLedger(artifact.record, artifact.body);
      for (const error of ledger.errors) errors.push(`${artifact.record.id}: ${error}`);
      continue;
    }
    const relative = posix(path.relative(scrumDir, artifact.file));
    const before = fs.readFileSync(artifact.file, "utf8");
    try {
      const migrated = migrateLegacyRun(artifact.record, artifact.body, {
        legacyHash: sha256(before),
        backupRef: `.scrumrun/${backupPath(relative)}`
      });
      const after = serializeArtifact(migrated.record, migrated.body);
      const parsed = parseArtifact(after);
      const validation = [...parsed.errors, ...validateArtifact(parsed.record, "run"), ...validateRunLedger(parsed.record, parsed.body).errors];
      if (validation.length) throw new Error(validation.join("; "));
      changes.push({ relative, before, after, beforeSha256: sha256(before), afterSha256: sha256(after), mode: migrated.mode });
      if (migrated.mode === "snapshot") warnings.push(`${artifact.record.id}: missing transition history is preserved as an evidenced snapshot, not reconstructed.`);
    } catch (error) {
      errors.push(`${artifact.record.id}: ${error.message}`);
    }
  }

  const markerValue = {
    ...marker.value,
    schemas: { ...(marker.value.schemas || {}), run_ledger: RUN_LEDGER_VERSION }
  };
  const markerAfter = `${JSON.stringify(markerValue, null, 2)}\n`;
  if (marker.content !== markerAfter) {
    changes.push({
      relative: "method.json",
      before: marker.content,
      after: markerAfter,
      beforeSha256: sha256(marker.content),
      afterSha256: sha256(markerAfter),
      mode: "schema-marker"
    });
  }
  const fingerprint = sha256(changes.map((change) => `${change.relative}\0${change.beforeSha256}`).sort().join("\n"));
  return {
    projectRoot,
    scrumDir,
    status: errors.length ? "blocked" : changes.length ? "ready" : "current",
    migration: MIGRATION_NAME,
    ledger: RUN_LEDGER_VERSION,
    fingerprint,
    changes,
    warnings,
    errors
  };
}

function reportRunLedgerMigration(plan, status = plan.status) {
  const mappings = plan.changes.length
    ? plan.changes.map((change) => `- \`${change.relative}\` · ${change.mode} · \`${change.beforeSha256.slice(0, 12)}\` → \`${change.afterSha256.slice(0, 12)}\``).join("\n")
    : "- No changes required.";
  const warnings = plan.warnings.length ? plan.warnings.map((warning) => `- ${warning}`).join("\n") : "- None.";
  const errors = plan.errors.length ? plan.errors.map((error) => `- ${error}`).join("\n") : "- None.";
  return `# ScrumRun Run Ledger Migration\n\nStatus: ${status}\nSchema: ${RUN_LEDGER_VERSION}\nSource fingerprint: \`${plan.fingerprint}\`\nChanged files: ${plan.changes.length}\n\n## Mappings\n\n${mappings}\n\n## Warnings\n\n${warnings}\n\n## Blockers\n\n${errors}\n`;
}

function manifestFile(scrumDir) {
  return assertNoSymlinkPath(scrumDir, path.join(scrumDir, MANIFEST_PATH));
}

function loadManifest(scrumDir) {
  const file = manifestFile(scrumDir);
  if (!fs.existsSync(file)) return null;
  if (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink()) throw new Error("Run ledger migration manifest is unsafe.");
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function backupChanges(plan) {
  for (const change of plan.changes) {
    const target = assertNoSymlinkPath(plan.scrumDir, path.join(plan.scrumDir, backupPath(change.relative)));
    if (fs.existsSync(target)) {
      if (sha256(fs.readFileSync(target)) !== change.beforeSha256) throw new Error(`Migration backup conflicts for ${change.relative}.`);
      continue;
    }
    atomicWrite(target, change.before);
  }
}

function verifyChanges(scrumDir, changes, field) {
  const problems = [];
  for (const change of changes) {
    const file = assertNoSymlinkPath(scrumDir, path.join(scrumDir, change.relative));
    const actual = fs.existsSync(file) && fs.lstatSync(file).isFile() ? sha256(fs.readFileSync(file)) : "missing";
    if (actual !== change[field]) problems.push(`${change.relative}: expected ${change[field]}, found ${actual}`);
  }
  return problems;
}

function restoreChanges(scrumDir, changes) {
  for (const change of [...changes].reverse()) {
    const backup = assertNoSymlinkPath(scrumDir, path.join(scrumDir, backupPath(change.relative)));
    if (!fs.existsSync(backup) || sha256(fs.readFileSync(backup)) !== change.beforeSha256) {
      throw new Error(`Run ledger backup is missing or corrupt for ${change.relative}.`);
    }
    const target = assertNoSymlinkPath(scrumDir, path.join(scrumDir, change.relative));
    atomicWrite(target, fs.readFileSync(backup));
  }
}

function recoverPrepared(scrumDir, manifest) {
  if (!manifest || manifest.status !== "prepared") return false;
  const allowed = [];
  for (const change of manifest.changes) {
    const file = path.join(scrumDir, change.relative);
    const actual = fs.existsSync(file) ? sha256(fs.readFileSync(file)) : "missing";
    if (![change.beforeSha256, change.afterSha256].includes(actual)) allowed.push(`${change.relative}: unexpected ${actual}`);
  }
  if (allowed.length) throw new Error(`Interrupted Run ledger migration cannot recover safely:\n${allowed.join("\n")}`);
  restoreChanges(scrumDir, manifest.changes);
  atomicWrite(manifestFile(scrumDir), `${JSON.stringify({ ...manifest, status: "recovered", recovered_at: new Date().toISOString() }, null, 2)}\n`);
  return true;
}

function applyRunLedgerMigration(projectRoot, { failurePoint = null } = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const preview = planRunLedgerMigration(projectRoot);
  if (preview.errors.length) throw new Error(`Run ledger migration is blocked:\n${preview.errors.join("\n")}`);
  if (!preview.changes.length) return { status: "current", plan: preview, output: reportRunLedgerMigration(preview, "current") };
  return withArtifactLock(scrumDir, "run-ledger-migration", () => {
    const existing = loadManifest(scrumDir);
    if (existing && existing.status === "prepared") recoverPrepared(scrumDir, existing);
    const plan = planRunLedgerMigration(projectRoot);
    if (plan.errors.length) throw new Error(`Run ledger migration is blocked:\n${plan.errors.join("\n")}`);
    if (!plan.changes.length) return { status: "current", plan, output: reportRunLedgerMigration(plan, "current") };
    const changed = verifyChanges(scrumDir, plan.changes, "beforeSha256");
    if (changed.length) throw new Error(`Run ledger source changed after preflight:\n${changed.join("\n")}`);
    backupChanges(plan);
    const manifest = {
      migration: MIGRATION_NAME,
      schema: RUN_LEDGER_VERSION,
      status: "prepared",
      prepared_at: new Date().toISOString(),
      source_fingerprint: plan.fingerprint,
      changes: plan.changes.map(({ relative, beforeSha256, afterSha256, mode }) => ({ relative, beforeSha256, afterSha256, mode }))
    };
    atomicWrite(manifestFile(scrumDir), `${JSON.stringify(manifest, null, 2)}\n`);
    try {
      for (let index = 0; index < plan.changes.length; index++) {
        const change = plan.changes[index];
        const target = assertNoSymlinkPath(scrumDir, path.join(scrumDir, change.relative));
        atomicWrite(target, change.after);
        if (failurePoint === `after-${index + 1}`) throw new Error(`Injected Run ledger migration failure after write ${index + 1}.`);
      }
      const afterProblems = verifyChanges(scrumDir, plan.changes, "afterSha256");
      if (afterProblems.length) throw new Error(`Run ledger migration verification failed:\n${afterProblems.join("\n")}`);
      const applied = { ...manifest, status: "applied", applied_at: new Date().toISOString() };
      atomicWrite(manifestFile(scrumDir), `${JSON.stringify(applied, null, 2)}\n`);
      return { status: "applied", plan, manifest: applied, output: reportRunLedgerMigration(plan, "applied") };
    } catch (error) {
      restoreChanges(scrumDir, manifest.changes);
      atomicWrite(manifestFile(scrumDir), `${JSON.stringify({ ...manifest, status: "recovered", recovered_at: new Date().toISOString() }, null, 2)}\n`);
      throw error;
    }
  });
}

function rollbackRunLedgerMigration(projectRoot) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  return withArtifactLock(scrumDir, "run-ledger-migration", () => {
    const manifest = loadManifest(scrumDir);
    if (!manifest || !["applied", "prepared"].includes(manifest.status)) throw new Error("No applied Run ledger migration is available for rollback.");
    if (manifest.status === "applied") {
      const changed = verifyChanges(scrumDir, manifest.changes, "afterSha256");
      if (changed.length) throw new Error(`Rollback would erase post-migration changes:\n${changed.join("\n")}`);
    }
    restoreChanges(scrumDir, manifest.changes);
    const rolledBack = { ...manifest, status: "rolled-back", rolled_back_at: new Date().toISOString() };
    atomicWrite(manifestFile(scrumDir), `${JSON.stringify(rolledBack, null, 2)}\n`);
    return { status: "rolled-back", manifest: rolledBack };
  });
}

module.exports = {
  MIGRATION_NAME,
  applyRunLedgerMigration,
  planRunLedgerMigration,
  reportRunLedgerMigration,
  rollbackRunLedgerMigration
};
