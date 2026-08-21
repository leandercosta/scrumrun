"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ARTIFACT_TYPES, ArtifactRepository, assertNoSymlinkPath, sha256 } = require("../v2/artifacts");
const { containsSecret } = require("../security/secrets");

const CONTROL_FILES = Object.freeze(["guardrails.md", "config.md", "project.md", "method.json"]);

function posix(value) {
  return value.split(path.sep).join("/");
}

function read(file) {
  return fs.existsSync(file) && fs.lstatSync(file).isFile() ? fs.readFileSync(file, "utf8") : "";
}

function artifactSnapshot(scrumDir) {
  const repository = new ArtifactRepository(scrumDir);
  const records = {};
  const hashes = [];
  const warnings = [];
  for (const kind of Object.keys(ARTIFACT_TYPES)) {
    records[kind] = repository.list(kind).map((artifact) => {
      const relative = posix(path.relative(scrumDir, artifact.file));
      const content = read(artifact.file);
      hashes.push(`${relative}\0${sha256(content)}`);
      if (containsSecret(content)) {
        warnings.push(`Secret-like content detected in canonical artifact: ${relative}`);
        return { id: artifact.record ? artifact.record.id : path.basename(artifact.file, ".md"), status: "unsafe", title: "[redacted]" };
      }
      return artifact.record ? {
        id: artifact.record.id,
        status: artifact.record.status,
        title: ((artifact.body || "").match(/^# ([^\r\n]+)/m) || [])[1] || artifact.record.id,
        task: artifact.record.task || null,
        sprint: artifact.record.sprint || null,
        feature: artifact.record.feature || null,
        assignee: artifact.record.assignee || null
      } : { id: path.basename(artifact.file, ".md"), status: "invalid", errors: artifact.errors };
    });
  }
  return { records, hashes, warnings };
}

function canonicalFingerprint(scrumDir, artifactHashes = null) {
  const hashes = artifactHashes || artifactSnapshot(scrumDir).hashes;
  const controls = CONTROL_FILES.map((relative) => {
    const file = path.join(scrumDir, relative);
    const exists = fs.existsSync(file) && fs.lstatSync(file).isFile();
    return `${relative}\0${exists ? sha256(fs.readFileSync(file)) : "missing"}`;
  });
  return sha256([...controls, ...hashes].sort().join("\n"));
}

function statRow(root, file) {
  assertNoSymlinkPath(root, file);
  const stat = fs.statSync(file, { bigint: true });
  if (!stat.isFile()) throw new Error(`Projection source is not a regular file: ${posix(path.relative(root, file))}`);
  return [
    posix(path.relative(root, file)),
    stat.size,
    stat.mtimeNs,
    stat.ctimeNs,
    stat.ino,
    stat.dev
  ].join("\0");
}

function canonicalWatchSnapshot(scrumDir) {
  const root = path.resolve(scrumDir);
  const rows = [];
  let files = 0;
  for (const relative of CONTROL_FILES) {
    const file = path.join(root, relative);
    if (!fs.existsSync(file)) rows.push(`${relative}\0missing`);
    else {
      rows.push(statRow(root, file));
      files++;
    }
  }
  for (const type of Object.values(ARTIFACT_TYPES)) {
    const directory = path.join(root, type.directory);
    assertNoSymlinkPath(root, directory);
    if (!fs.existsSync(directory)) continue;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!new RegExp(`^${type.prefix}-\\d{3,}\\.md$`).test(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (!entry.isFile()) throw new Error(`Canonical projection source is not a regular file: ${posix(path.relative(root, file))}`);
      rows.push(statRow(root, file));
      files++;
    }
  }
  return { fingerprint: sha256(rows.sort().join("\n")), files, rows };
}

function fileWatchSnapshot(root, files, extraRows = []) {
  const resolvedRoot = path.resolve(root);
  const rows = files.map((file) => statRow(resolvedRoot, path.resolve(file)));
  rows.push(...extraRows.map(String));
  return { fingerprint: sha256(rows.sort().join("\n")), files: files.length, rows };
}

module.exports = {
  CONTROL_FILES,
  artifactSnapshot,
  canonicalFingerprint,
  canonicalWatchSnapshot,
  fileWatchSnapshot,
  statRow
};
