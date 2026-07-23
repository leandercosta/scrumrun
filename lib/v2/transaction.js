"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  assertNoSymlinkPath,
  atomicWrite,
  sha256,
  withArtifactLock
} = require("./artifacts");

const TRANSACTION_SCHEMA = 1;
const TRANSACTION_ROOT = path.join(".backup", "transactions");
const PENDING_DIR = path.join(TRANSACTION_ROOT, "pending");
const RECEIPT_DIR = path.join(TRANSACTION_ROOT, "receipts");
const FORBIDDEN = [".backup/", ".cache/", ".migration/", "vault.local.md"];

function posix(value) {
  return value.split(path.sep).join("/");
}

function transactionId() {
  return `TXN-${Date.now()}-${crypto.randomBytes(6).toString("hex")}`;
}

function safeTransactionPath(scrumDir, relative) {
  return assertNoSymlinkPath(scrumDir, path.join(scrumDir, relative));
}

function relativeTarget(scrumDir, file) {
  const target = assertNoSymlinkPath(scrumDir, path.resolve(file));
  const relative = posix(path.relative(path.resolve(scrumDir), target));
  if (!relative || relative.startsWith("../") || path.isAbsolute(relative)) throw new Error(`Transaction target escapes .scrumrun: ${file}`);
  if (FORBIDDEN.some((entry) => relative === entry.replace(/\/$/, "") || relative.startsWith(entry))) {
    throw new Error(`Transaction target is outside the canonical mutation boundary: ${relative}`);
  }
  return { relative, file: target };
}

function snapshot(content) {
  if (content === null) return { exists: false, sha256: "missing", content_base64: null };
  const value = Buffer.isBuffer(content) ? content : Buffer.from(String(content));
  return { exists: true, sha256: sha256(value), content_base64: value.toString("base64") };
}

function fileSnapshot(scrumDir, relative) {
  const file = safeTransactionPath(scrumDir, relative);
  if (!fs.existsSync(file)) return snapshot(null);
  if (!fs.lstatSync(file).isFile()) throw new Error(`Transaction target is not a regular file: ${relative}`);
  return snapshot(fs.readFileSync(file));
}

function sameSnapshot(left, right) {
  return Boolean(left && right && left.exists === right.exists && left.sha256 === right.sha256);
}

function applySnapshot(scrumDir, relative, value) {
  const file = safeTransactionPath(scrumDir, relative);
  if (!value.exists) {
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    return;
  }
  atomicWrite(file, Buffer.from(value.content_base64, "base64"));
}

function pendingDirectory(scrumDir) {
  return safeTransactionPath(scrumDir, PENDING_DIR);
}

function receipt(transaction, status, details = {}) {
  return {
    schema: TRANSACTION_SCHEMA,
    id: transaction.id,
    name: transaction.name,
    status,
    created_at: transaction.created_at,
    finished_at: new Date().toISOString(),
    changes: transaction.changes.map((change) => ({
      relative: change.relative,
      before_sha256: change.before.sha256,
      after_sha256: change.after.sha256
    })),
    ...details
  };
}

function finishJournal(scrumDir, journalFile, transaction, status, details = {}) {
  const receiptFile = safeTransactionPath(scrumDir, path.join(RECEIPT_DIR, `${transaction.id}.json`));
  atomicWrite(receiptFile, `${JSON.stringify(receipt(transaction, status, details), null, 2)}\n`);
  fs.rmSync(journalFile, { force: true });
}

function pendingTransactions(scrumDir) {
  const directory = pendingDirectory(scrumDir);
  if (!fs.existsSync(directory)) return [];
  if (!fs.lstatSync(directory).isDirectory()) throw new Error("Transaction pending path is not a directory.");
  const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    if (entry.isSymbolicLink() || !entry.isFile() || !/^TXN-[a-zA-Z0-9-]+\.json$/.test(entry.name)) {
      throw new Error(`Unexpected transaction journal entry: ${entry.name}`);
    }
  }
  return entries.map((entry) => {
      const file = safeTransactionPath(scrumDir, path.join(PENDING_DIR, entry.name));
      try {
        const transaction = JSON.parse(fs.readFileSync(file, "utf8"));
        return { file, transaction };
      } catch (error) {
        throw new Error(`Transaction journal is malformed: ${entry.name}: ${error.message}`);
      }
    });
}

function validateJournal(transaction) {
  const errors = [];
  if (!transaction || transaction.schema !== TRANSACTION_SCHEMA) errors.push(`schema must be ${TRANSACTION_SCHEMA}`);
  if (!/^TXN-[a-zA-Z0-9-]+$/.test(transaction && transaction.id || "")) errors.push("id is invalid");
  if (!transaction || !["prepared", "committed"].includes(transaction.status)) errors.push("status must be prepared or committed");
  if (!transaction || !Array.isArray(transaction.changes) || !transaction.changes.length) errors.push("changes must be a non-empty array");
  for (const change of transaction && Array.isArray(transaction.changes) ? transaction.changes : []) {
    if (typeof change.relative !== "string" || !change.relative) errors.push("change.relative is required");
    for (const key of ["before", "after"]) {
      const value = change[key];
      if (!value || typeof value.exists !== "boolean" || typeof value.sha256 !== "string") errors.push(`${change.relative || "change"}.${key} is malformed`);
      if (value && value.exists && typeof value.content_base64 !== "string") errors.push(`${change.relative || "change"}.${key} content is missing`);
      if (value && value.exists && typeof value.content_base64 === "string") {
        const decoded = Buffer.from(value.content_base64, "base64");
        if (decoded.toString("base64") !== value.content_base64 || sha256(decoded) !== value.sha256) {
          errors.push(`${change.relative || "change"}.${key} content hash is invalid`);
        }
      }
      if (value && !value.exists && (value.sha256 !== "missing" || value.content_base64 !== null)) {
        errors.push(`${change.relative || "change"}.${key} missing snapshot is invalid`);
      }
    }
  }
  return errors;
}

function recoverPendingTransactionsUnlocked(scrumDir) {
  const recovered = [];
  for (const { file, transaction } of pendingTransactions(scrumDir)) {
    const errors = validateJournal(transaction);
    if (errors.length) throw new Error(`Unsafe transaction journal ${path.basename(file)}: ${errors.join("; ")}`);
    for (const change of transaction.changes) {
      const target = relativeTarget(scrumDir, path.join(scrumDir, change.relative));
      if (target.relative !== change.relative) throw new Error(`Unsafe transaction target in ${transaction.id}: ${change.relative}`);
    }
    const current = transaction.changes.map((change) => ({ change, value: fileSnapshot(scrumDir, change.relative) }));
    const unexpected = current.filter(({ change, value }) => !sameSnapshot(value, change.before) && !sameSnapshot(value, change.after));
    if (unexpected.length) {
      throw new Error(`Pending transaction ${transaction.id} cannot recover without overwriting owner changes: ${unexpected.map(({ change }) => change.relative).join(", ")}`);
    }
    if (transaction.status === "prepared") {
      for (const change of [...transaction.changes].reverse()) applySnapshot(scrumDir, change.relative, change.before);
      const unrestored = transaction.changes.filter((change) => !sameSnapshot(fileSnapshot(scrumDir, change.relative), change.before));
      if (unrestored.length) throw new Error(`Transaction ${transaction.id} recovery verification failed: ${unrestored.map((change) => change.relative).join(", ")}`);
      finishJournal(scrumDir, file, transaction, "recovered", { action: "rolled-back-prepared" });
      recovered.push({ id: transaction.id, action: "rolled-back" });
    } else {
      const incomplete = current.filter(({ change, value }) => !sameSnapshot(value, change.after));
      if (incomplete.length) throw new Error(`Committed transaction ${transaction.id} is incomplete: ${incomplete.map(({ change }) => change.relative).join(", ")}`);
      finishJournal(scrumDir, file, transaction, "committed", { action: "verified-commit" });
      recovered.push({ id: transaction.id, action: "verified" });
    }
  }
  return recovered;
}

function recoverPendingTransactions(scrumDir) {
  return withArtifactLock(scrumDir, "kernel", () => recoverPendingTransactionsUnlocked(scrumDir));
}

function normalizeChanges(scrumDir, changes) {
  if (!Array.isArray(changes) || !changes.length) throw new Error("Kernel transaction requires at least one change.");
  const seen = new Set();
  return changes.map((change) => {
    const target = relativeTarget(scrumDir, change.file);
    if (seen.has(target.relative)) throw new Error(`Duplicate transaction target: ${target.relative}`);
    seen.add(target.relative);
    if (!Object.prototype.hasOwnProperty.call(change, "previous") || !Object.prototype.hasOwnProperty.call(change, "next")) {
      throw new Error(`Transaction change requires previous and next content: ${target.relative}`);
    }
    return { relative: target.relative, before: snapshot(change.previous), after: snapshot(change.next) };
  });
}

function writeKernelTransactionUnlocked(scrumDir, name, changes, { failurePoint = null, interruptPoint = null } = {}) {
  if (!/^[a-z0-9-]+$/i.test(name || "")) throw new Error(`Invalid transaction name: ${name || "missing"}`);
  const normalized = normalizeChanges(scrumDir, changes);
  const conflicts = normalized.filter((change) => !sameSnapshot(fileSnapshot(scrumDir, change.relative), change.before));
  if (conflicts.length) throw new Error(`Transaction source changed before prepare: ${conflicts.map((change) => change.relative).join(", ")}`);
  const transaction = {
    schema: TRANSACTION_SCHEMA,
    id: transactionId(),
    name,
    status: "prepared",
    created_at: new Date().toISOString(),
    changes: normalized
  };
  const journalFile = safeTransactionPath(scrumDir, path.join(PENDING_DIR, `${transaction.id}.json`));
  atomicWrite(journalFile, `${JSON.stringify(transaction, null, 2)}\n`);
  if (interruptPoint === "after-prepare") throw Object.assign(new Error("Simulated interruption after transaction prepare."), { code: "SCRUMRUN_INTERRUPTED" });
  try {
    for (let index = 0; index < transaction.changes.length; index++) {
      const change = transaction.changes[index];
      applySnapshot(scrumDir, change.relative, change.after);
      if (interruptPoint === `after-${index + 1}`) {
        throw Object.assign(new Error(`Simulated interruption after transaction write ${index + 1}.`), { code: "SCRUMRUN_INTERRUPTED" });
      }
      if (failurePoint === `after-${index + 1}`) throw new Error(`Injected transaction failure after write ${index + 1}.`);
    }
    const invalid = transaction.changes.filter((change) => !sameSnapshot(fileSnapshot(scrumDir, change.relative), change.after));
    if (invalid.length) throw new Error(`Transaction verification failed: ${invalid.map((change) => change.relative).join(", ")}`);
    const committed = { ...transaction, status: "committed", committed_at: new Date().toISOString() };
    atomicWrite(journalFile, `${JSON.stringify(committed, null, 2)}\n`);
    if (interruptPoint === "after-commit") {
      throw Object.assign(new Error("Simulated interruption after transaction commit."), { code: "SCRUMRUN_INTERRUPTED" });
    }
    finishJournal(scrumDir, journalFile, committed, "committed", { action: "applied" });
    return { id: transaction.id, status: "committed", changes: transaction.changes.length };
  } catch (error) {
    if (error.code === "SCRUMRUN_INTERRUPTED") throw error;
    for (const change of [...transaction.changes].reverse()) applySnapshot(scrumDir, change.relative, change.before);
    finishJournal(scrumDir, journalFile, transaction, "recovered", { action: "rolled-back-error", error: error.message });
    throw error;
  }
}

function runKernelTransaction(scrumDir, name, changes, options = {}) {
  return withArtifactLock(scrumDir, "kernel", () => {
    const recovered = recoverPendingTransactionsUnlocked(scrumDir);
    const result = writeKernelTransactionUnlocked(scrumDir, name, changes, options);
    return { ...result, recovered };
  });
}

function previewPendingRecovery(scrumDir) {
  const preview = { plans: [], errors: [] };
  let entries;
  try {
    entries = pendingTransactions(scrumDir);
  } catch (error) {
    preview.errors.push(error.message);
    return preview;
  }
  for (const { file, transaction } of entries) {
    const plan = { id: transaction.id, name: transaction.name || null, journal: path.basename(file), status: transaction.status, action: null, files: [], warnings: [] };
    const journalErrors = validateJournal(transaction);
    if (journalErrors.length) {
      plan.action = "blocked";
      plan.warnings.push(`journal validation failed: ${journalErrors.join("; ")}`);
      preview.plans.push(plan);
      continue;
    }
    let unsafePath = null;
    for (const change of transaction.changes) {
      const target = relativeTarget(scrumDir, path.join(scrumDir, change.relative));
      if (target.relative !== change.relative) {
        unsafePath = change.relative;
        break;
      }
    }
    if (unsafePath) {
      plan.action = "blocked";
      plan.warnings.push(`unsafe transaction target: ${unsafePath}`);
      preview.plans.push(plan);
      continue;
    }
    const current = transaction.changes.map((change) => ({ change, value: fileSnapshot(scrumDir, change.relative) }));
    const unexpected = current.filter(({ change, value }) => !sameSnapshot(value, change.before) && !sameSnapshot(value, change.after));
    if (unexpected.length) {
      plan.action = "blocked";
      plan.warnings.push(`would overwrite owner changes at: ${unexpected.map(({ change }) => change.relative).join(", ")}`);
      preview.plans.push(plan);
      continue;
    }
    if (transaction.status === "prepared") {
      plan.action = "rollback";
      plan.files = transaction.changes.map((change) => ({ relative: change.relative, from: "current", to: "pre-transaction" }));
    } else {
      const incomplete = current.filter(({ change, value }) => !sameSnapshot(value, change.after));
      if (incomplete.length) {
        plan.action = "blocked";
        plan.warnings.push(`committed transaction is incomplete: ${incomplete.map(({ change }) => change.relative).join(", ")}`);
      } else {
        plan.action = "verify-commit";
        plan.files = transaction.changes.map((change) => ({ relative: change.relative, from: "current", to: "verified-commit" }));
      }
    }
    preview.plans.push(plan);
  }
  return preview;
}

function pendingTransactionStatus(scrumDir) {
  try {
    return { pending: pendingTransactions(scrumDir).map(({ transaction }) => ({ id: transaction.id, name: transaction.name, status: transaction.status })) };
  } catch (error) {
    return { pending: [], error: error.message };
  }
}

module.exports = {
  TRANSACTION_SCHEMA,
  pendingTransactionStatus,
  previewPendingRecovery,
  recoverPendingTransactions,
  recoverPendingTransactionsUnlocked,
  runKernelTransaction,
  writeKernelTransactionUnlocked
};
