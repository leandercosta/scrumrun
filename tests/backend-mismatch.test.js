const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { execFileSync } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");

const bin = path.join(__dirname, "..", "bin", "scrumrun.js");
const { indexStatus } = require("../lib/memory");
const { auditProject, INVARIANTS } = require("../lib/v2/conformance");

function makeProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sr-backend-"));
  execFileSync(process.execPath, [bin, "init", "--lean", "--force"], { cwd: dir, encoding: "utf8" });
  return dir;
}

function forgeCacheDeclaringFts5(dir) {
  const cacheDir = path.join(dir, ".scrumrun", ".cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const cacheFile = path.join(cacheDir, "semantic-index.sqlite");
  const db = new DatabaseSync(cacheFile);
  db.exec(`
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT);
    INSERT INTO metadata (key, value) VALUES ('schema_version', '5');
    INSERT INTO metadata (key, value) VALUES ('source_fingerprint', 'x');
    INSERT INTO metadata (key, value) VALUES ('source_watch_fingerprint', 'y');
    INSERT INTO metadata (key, value) VALUES ('search_backend', 'fts5');
  `);
  db.close();
  return cacheFile;
}

test("conformance advertises I-22: declared search backend matches runtime capabilities", () => {
  assert.ok(INVARIANTS.some((entry) => entry.id === "I-22"));
});

test("conformance detects a semantic index that declares fts5 when the runtime does not provide it", () => {
  // Forge a cache that declares search_backend=fts5 but is missing the fts5
  // virtual tables. This is exactly the shipped-in-2.1.0 shape: metadata
  // claimed fts5, but querying artifacts_fts would throw. The invariant
  // catches this proactively at conformance time instead of relying on a
  // lazy rebuild at query time.
  const dir = makeProject();
  try {
    forgeCacheDeclaringFts5(dir);
    const status = indexStatus(dir);
    assert.equal(status.backendMismatch, true, "indexStatus must flag backend mismatch");
    assert.match(status.reason, /declared search backend fts5 is not available/);

    const audit = auditProject(dir);
    const codes = audit.findings.map((finding) => finding.code);
    assert.ok(codes.includes("SEARCH_BACKEND_MISMATCH"), `expected SEARCH_BACKEND_MISMATCH, got ${codes.join(", ")}`);
    const mismatch = audit.findings.find((finding) => finding.code === "SEARCH_BACKEND_MISMATCH");
    assert.equal(mismatch.severity, "high");
    assert.equal(audit.passed, false, "backend mismatch must block conformance");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
