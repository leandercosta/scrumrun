"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {
  ARTIFACT_TRANSITIONS,
  ARTIFACT_TYPES,
  METHOD_VERSION,
  SCALAR_FIELDS,
  STRUCTURAL_RELATIONS
} = require("./schema");

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function scalar(value) {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean" || typeof value === "number") return String(value);
  const text = String(value);
  if (/^[A-Za-z0-9._/-]+$/.test(text)) return text;
  return JSON.stringify(text);
}

function parseScalar(value) {
  const text = value.trim();
  if (text === "null") return null;
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  if (text.startsWith('"')) {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }
  return text;
}

function serializeArtifact(record, body = "") {
  const required = ["id", "kind", "status", "created", "updated", "method"];
  const ordered = {};
  for (const key of required) ordered[key] = record[key];
  for (const [key, value] of Object.entries(record)) {
    if (!required.includes(key)) ordered[key] = value;
  }
  const frontmatter = Object.entries(ordered)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}: ${scalar(value)}`)
    .join("\n");
  return `---\n${frontmatter}\n---\n\n${body.trim()}\n`;
}

function parseArtifact(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!match) return { record: null, body: content, errors: ["missing or malformed frontmatter"] };
  const record = {};
  const errors = [];
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim()) continue;
    const field = line.match(/^([a-z][a-z0-9_]*):\s*(.*)$/i);
    if (!field) {
      errors.push(`malformed frontmatter line: ${line}`);
      continue;
    }
    if (Object.prototype.hasOwnProperty.call(record, field[1])) {
      errors.push(`duplicate frontmatter field: ${field[1]}`);
      continue;
    }
    record[field[1]] = parseScalar(field[2]);
  }
  return { record, body: match[2], errors };
}

function validateArtifact(record, expectedKind = null) {
  const errors = [];
  if (!record || typeof record !== "object") return ["artifact record is missing"];
  const type = ARTIFACT_TYPES[record.kind];
  if (!type) errors.push(`unknown kind: ${record.kind || "missing"}`);
  if (expectedKind && record.kind !== expectedKind) errors.push(`expected kind ${expectedKind}, got ${record.kind}`);
  if (type && !new RegExp(`^${type.prefix}-\\d{3,}$`).test(record.id || "")) {
    errors.push(`invalid ${record.kind} id: ${record.id || "missing"}`);
  }
  if (type && !type.statuses.includes(record.status)) {
    errors.push(`invalid ${record.kind} status: ${record.status || "missing"}`);
  }
  if (record.method !== METHOD_VERSION) errors.push(`method must be ${METHOD_VERSION}`);
  for (const field of ["created", "updated"]) {
    const value = record[field] || "";
    const timestamp = /^\d{4}-\d{2}-\d{2}$/.test(value) ? Date.parse(`${value}T00:00:00.000Z`) : NaN;
    const valid = Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
    if (!valid) errors.push(`${field} must be a real YYYY-MM-DD date`);
  }
  for (const [field, relation] of Object.entries(STRUCTURAL_RELATIONS)) {
    const target = ARTIFACT_TYPES[relation.targetKind];
    if (record[field] !== undefined && record[field] !== null && !new RegExp(`^${target.prefix}-\\d{3,}$`).test(record[field])) {
      errors.push(`${record.kind}.${field} must reference ${target.prefix}-NNN or null`);
    }
    if ((relation.requiredFor || []).includes(record.kind) && (record[field] === undefined || record[field] === null)) {
      errors.push(`${record.kind}.${field} must reference ${target.prefix}-NNN`);
    }
  }
  for (const [field, constraint] of Object.entries(SCALAR_FIELDS)) {
    if (!constraint.kinds.includes(record.kind)) continue;
    if (constraint.required && (record[field] === undefined || record[field] === null)) {
      errors.push(`${record.kind}.${field} is required`);
      continue;
    }
    if (field === "attempt" && (!Number.isInteger(record[field]) || record[field] < 1)) {
      errors.push(`${record.kind}.${field} must be a positive integer`);
    }
    if (field === "ledger" && record[field] !== undefined && record[field] !== 1) {
      errors.push(`${record.kind}.${field} must be 1`);
    }
  }
  return errors;
}

function transitionArtifact(record, nextStatus, updated) {
  const errors = validateArtifact(record);
  if (errors.length) throw new Error(`Cannot transition invalid artifact: ${errors.join("; ")}`);
  const allowed = (ARTIFACT_TRANSITIONS[record.kind] && ARTIFACT_TRANSITIONS[record.kind][record.status]) || [];
  if (!allowed.includes(nextStatus)) {
    throw new Error(`Invalid ${record.kind} transition: ${record.status} -> ${nextStatus}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(updated || "")) throw new Error("Transition date must be YYYY-MM-DD");
  return { ...record, status: nextStatus, updated };
}

function relativeArtifactPath(record) {
  const type = ARTIFACT_TYPES[record.kind];
  if (!type) throw new Error(`Unknown artifact kind: ${record.kind}`);
  if (!new RegExp(`^${type.prefix}-\\d{3,}$`).test(record.id || "")) throw new Error(`Invalid artifact id: ${record.id}`);
  return path.join(type.directory, `${record.id}.md`);
}

function safePath(root, relative) {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, relative);
  if (target !== resolvedRoot && !target.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes artifact root: ${relative}`);
  }
  return target;
}

function assertNoSymlinkPath(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Path escapes artifact root: ${target}`);
  }
  const relative = path.relative(resolvedRoot, resolvedTarget);
  let current = resolvedRoot;
  const candidates = [resolvedRoot, ...relative.split(path.sep).filter(Boolean).map((segment) => (current = path.join(current, segment)))];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.lstatSync(candidate).isSymbolicLink()) {
      throw new Error(`Symbolic links are forbidden in canonical artifact paths: ${path.relative(resolvedRoot, candidate) || "."}`);
    }
  }
  return resolvedTarget;
}

function atomicWrite(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`);
  try {
    fs.writeFileSync(temp, content);
    fs.renameSync(temp, file);
  } catch (error) {
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
    throw error;
  }
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function withArtifactLock(scrumDir, name, operation, { timeoutMs = 3000, staleMs = 30000 } = {}) {
  if (!/^[a-z0-9-]+$/i.test(name)) throw new Error(`Invalid lock name: ${name}`);
  const lockDir = path.join(scrumDir, ".cache", "locks");
  assertNoSymlinkPath(scrumDir, lockDir);
  fs.mkdirSync(lockDir, { recursive: true });
  const lockFile = path.join(lockDir, `${name}.lock`);
  const token = `${process.pid}:${Date.now()}:${crypto.randomBytes(8).toString("hex")}`;
  const started = Date.now();
  let descriptor = null;
  while (descriptor === null) {
    try {
      descriptor = fs.openSync(lockFile, "wx", 0o600);
      fs.writeFileSync(descriptor, token);
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      let stat;
      try {
        stat = fs.lstatSync(lockFile);
      } catch (statError) {
        if (statError.code === "ENOENT") continue;
        throw statError;
      }
      if (stat.isSymbolicLink()) throw new Error(`Symbolic lock path is forbidden: ${name}`);
      if (Date.now() - stat.mtimeMs > staleMs) {
        let current;
        try {
          current = fs.lstatSync(lockFile);
        } catch (statError) {
          if (statError.code === "ENOENT") continue;
          throw statError;
        }
        if (current.ino === stat.ino && current.mtimeMs === stat.mtimeMs) fs.rmSync(lockFile, { force: true });
        continue;
      }
      if (Date.now() - started >= timeoutMs) throw new Error(`Timed out waiting for ScrumRun lock: ${name}`);
      wait(10);
    }
  }
  try {
    return operation();
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
    try {
      if (fs.existsSync(lockFile) && fs.readFileSync(lockFile, "utf8") === token) fs.rmSync(lockFile, { force: true });
    } catch {
      // A failed cleanup leaves a short-lived stale lock; it never changes canonical state.
    }
  }
}

function graphFromRecords(records) {
  const nodes = [];
  const edges = [];
  for (const record of records) {
    if (!record || validateArtifact(record).length) continue;
    nodes.push({ id: record.id, kind: record.kind, status: record.status });
    const relations = [
      ["feature", "belongs_to"],
      ["sprint", "included_in"],
      ["task", "executes"],
      ["subject", "about"],
      ["source_id", "evidenced_by"]
    ];
    for (const [field, relation] of relations) {
      if (typeof record[field] === "string" && /^[A-Z]+-\d{3,}$/.test(record[field])) {
        edges.push({ from: record.id, relation, to: record[field] });
      }
    }
  }
  return { nodes, edges };
}

class ArtifactRepository {
  constructor(scrumDir) {
    this.scrumDir = path.resolve(scrumDir);
  }

  pathFor(record) {
    const file = safePath(this.scrumDir, relativeArtifactPath(record));
    return assertNoSymlinkPath(this.scrumDir, file);
  }

  write(record, body, { overwrite = false } = {}) {
    const errors = validateArtifact(record);
    if (errors.length) throw new Error(`Invalid artifact ${record.id || "unknown"}: ${errors.join("; ")}`);
    const file = this.pathFor(record);
    const content = serializeArtifact(record, body);
    if (fs.existsSync(file)) {
      const current = fs.readFileSync(file, "utf8");
      if (current === content) return { status: "unchanged", file, hash: sha256(content) };
      if (!overwrite) throw new Error(`Artifact already exists with different content: ${path.relative(this.scrumDir, file)}`);
    }
    atomicWrite(file, content);
    return { status: "written", file, hash: sha256(content) };
  }

  read(kind, id) {
    const file = this.pathFor({ kind, id });
    if (!fs.existsSync(file)) return null;
    const content = fs.readFileSync(file, "utf8");
    const parsed = parseArtifact(content);
    const errors = [...parsed.errors, ...validateArtifact(parsed.record, kind)];
    if (parsed.record && parsed.record.id !== id) errors.push(`artifact id ${parsed.record.id || "missing"} does not match filename ${id}`);
    return { ...parsed, file, errors };
  }

  transition(kind, id, nextStatus, updated) {
    const artifact = this.read(kind, id);
    if (!artifact) throw new Error(`Artifact not found: ${id}`);
    if (artifact.errors.length) throw new Error(`Invalid artifact ${id}: ${artifact.errors.join("; ")}`);
    transitionArtifact(artifact.record, nextStatus, updated);
    const content = fs.readFileSync(artifact.file, "utf8");
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/);
    if (!match) throw new Error(`Invalid artifact ${id}: missing frontmatter`);
    let frontmatter = match[1];
    frontmatter = frontmatter.replace(/^status:\s*.*$/m, `status: ${nextStatus}`);
    frontmatter = frontmatter.replace(/^updated:\s*.*$/m, `updated: ${updated}`);
    const next = `---\n${frontmatter}\n---${match[2]}`;
    const parsed = parseArtifact(next);
    const errors = [...parsed.errors, ...validateArtifact(parsed.record, kind)];
    if (errors.length) throw new Error(`Transition validation failed for ${id}: ${errors.join("; ")}`);
    atomicWrite(artifact.file, next);
    return { status: "written", file: artifact.file, record: parsed.record, hash: sha256(next) };
  }

  list(kind) {
    const type = ARTIFACT_TYPES[kind];
    if (!type) throw new Error(`Unknown artifact kind: ${kind}`);
    const directory = safePath(this.scrumDir, type.directory);
    assertNoSymlinkPath(this.scrumDir, directory);
    if (!fs.existsSync(directory)) return [];
    return fs.readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && new RegExp(`^${type.prefix}-\\d{3,}\\.md$`).test(entry.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((entry) => this.read(kind, path.basename(entry.name, ".md")));
  }

  graph() {
    const records = [];
    for (const kind of Object.keys(ARTIFACT_TYPES)) {
      for (const artifact of this.list(kind)) {
        if (!artifact.record || artifact.errors.length) continue;
        records.push(artifact.record);
      }
    }
    return graphFromRecords(records);
  }
}

module.exports = {
  ARTIFACT_TYPES,
  ARTIFACT_TRANSITIONS,
  ArtifactRepository,
  METHOD_VERSION,
  assertNoSymlinkPath,
  atomicWrite,
  graphFromRecords,
  parseArtifact,
  relativeArtifactPath,
  safePath,
  serializeArtifact,
  sha256,
  transitionArtifact,
  validateArtifact,
  withArtifactLock
};
