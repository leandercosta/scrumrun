const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ArtifactRepository, METHOD_VERSION } = require("../lib/v2/artifacts");
const { INDEX_SCHEMA_VERSION, graphIndex, indexPath, indexStatus, mapStatus, queryIndex, rebuildIndex, writeMap } = require("../lib/memory/index");
const { createMemory, listMemory, transitionMemory } = require("../lib/memory/service");

const bin = path.resolve(__dirname, "..", "bin", "scrumrun.js");

function project() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-memory-"));
  const scrum = path.join(root, ".scrumrun");
  fs.mkdirSync(scrum, { recursive: true });
  fs.writeFileSync(path.join(scrum, "method.json"), `${JSON.stringify({ method: METHOD_VERSION }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, "pricing.js"), "export function calculateFinalPrice() {}\n");
  return root;
}

function run(root, ...args) {
  return execFileSync(process.execPath, [bin, ...args], { cwd: root, encoding: "utf8" });
}

test("AI insights stay candidate until resolvable evidence is explicitly confirmed", () => {
  const root = project();
  const insight = createMemory(root, "insight", {
    title: "Pricing stays in the backend",
    content: "The calculation has consumers outside checkout.",
    sourceType: "ai",
    subjectType: "symbol",
    subjectId: "function:calculateFinalPrice"
  });

  assert.equal(insight.record.status, "candidate");
  assert.throws(() => transitionMemory(root, "insight", insight.record.id, "confirm"), /requires at least one evidence/);

  const confirmed = transitionMemory(root, "insight", insight.record.id, "confirm", {
    evidence: ["pricing.js#L1"],
    note: "Owner verified the implementation and rationale."
  });
  assert.equal(confirmed.record.status, "confirmed");
  assert.match(confirmed.body, /pricing\.js#L1/);
  assert.match(confirmed.body, /Owner verified/);
});

test("repeated review evidence is normalized before rebuilding the semantic index", () => {
  const root = project();
  fs.writeFileSync(path.join(root, "pricing.js"), "export function price() { return 42; }\n");
  const insight = createMemory(root, "insight", {
    title: "Pricing placement",
    content: "Pricing stays in the backend.",
    evidence: ["pricing.js"],
    sourceType: "human"
  });

  transitionMemory(root, "insight", insight.record.id, "confirm", { evidence: ["pricing.js"] });
  const rebuilt = rebuildIndex(root);

  assert.equal(rebuilt.artifacts > 0, true);
  assert.equal(queryIndex(root, "Pricing placement").results[0].id, insight.record.id);
});

test("confirmed facts reject missing, unsafe, and vault evidence", () => {
  const root = project();
  const fact = createMemory(root, "knowledge", { title: "Pricing rule", sourceType: "human" });

  assert.throws(() => transitionMemory(root, "knowledge", fact.record.id, "approve", { evidence: ["missing.js"] }), /Unresolved evidence/);
  assert.throws(() => transitionMemory(root, "knowledge", fact.record.id, "approve", { evidence: ["../outside.md"] }), /unsafe path/);
  assert.throws(() => transitionMemory(root, "knowledge", fact.record.id, "approve", { evidence: [".scrumrun/vault.local.md"] }), /vault evidence is forbidden/);
  assert.equal(listMemory(root, "knowledge")[0].record.status, "candidate");
});

test("active dossiers require evidence and relations cannot fail silently", () => {
  const root = project();
  assert.throws(() => createMemory(root, "dossier", { title: "Pricing dossier" }), /requires at least one evidence/);
  assert.throws(() => createMemory(root, "insight", { title: "Bad graph", relations: ["not a relation"] }), /Malformed relation/);
  const dossier = createMemory(root, "dossier", { title: "Pricing dossier", evidence: ["pricing.js"] });
  assert.equal(dossier.record.status, "active");
});

test("artifact evidence resolves through stable ids and invalidated truth is inactive", () => {
  const root = project();
  const repository = new ArtifactRepository(path.join(root, ".scrumrun"));
  repository.write({
    id: "TASK-001", kind: "task", status: "completed", created: "2026-07-21", updated: "2026-07-21", method: METHOD_VERSION
  }, "# Pricing validation");
  const fact = createMemory(root, "knowledge", { title: "Deterministic pricing" });
  transitionMemory(root, "knowledge", fact.record.id, "approve", { evidence: ["TASK-001"] });
  transitionMemory(root, "knowledge", fact.record.id, "invalidate", { note: "The commercial rule changed." });

  assert.equal(listMemory(root, "knowledge", { includeInactive: false }).length, 0);
  assert.equal(listMemory(root, "knowledge", { includeInactive: true })[0].record.status, "invalidated");
});

test("SQLite index is disposable, deterministic, relational, and excludes the vault", () => {
  const root = project();
  fs.writeFileSync(path.join(root, ".scrumrun", "vault.local.md"), "DO_NOT_INDEX_ULTRA_SECRET\n");
  const insight = createMemory(root, "insight", {
    title: "Pricing placement rationale",
    content: "calculateFinalPrice belongs to pricing because quotation also consumes it.",
    evidence: ["pricing.js"],
    relations: ["used_by: OrderService", "constrained_by: DEC-018"],
    subjectType: "symbol",
    subjectId: "function:calculateFinalPrice",
    sourceType: "ai"
  });
  transitionMemory(root, "insight", insight.record.id, "confirm");

  const built = rebuildIndex(root);
  const header = fs.readFileSync(built.file).subarray(0, 16).toString("utf8");
  assert.equal(header, "SQLite format 3\u0000");
  const first = queryIndex(root, "OrderService", { rebuild: false });
  assert.equal(first.results[0].id, insight.record.id);
  assert.match(first.results[0].match, /relation/);
  assert.ok(first.results[0].relations.some((edge) => edge.relation === "used_by" && edge.to_id === "OrderService"));

  const databaseBytes = fs.readFileSync(indexPath(root)).toString("latin1");
  assert.doesNotMatch(databaseBytes, /DO_NOT_INDEX_ULTRA_SECRET/);
  const graph = graphIndex(root, { rebuild: false });
  assert.ok(graph.edges.some((edge) => edge.from === insight.record.id && edge.relation === "about" && edge.to === "function:calculateFinalPrice"));

  const expected = first.results;
  fs.rmSync(indexPath(root));
  const rebuilt = queryIndex(root, "OrderService");
  assert.equal(rebuilt.rebuilt, true);
  assert.deepEqual(rebuilt.results, expected);
});

test("stale and expired memory are labeled while invalidated memory is excluded", () => {
  const root = project();
  const insight = createMemory(root, "insight", {
    title: "Historical pricing caveat",
    evidence: ["pricing.js"],
    sourceType: "human",
    reviewTrigger: "pricing module changes"
  });
  transitionMemory(root, "insight", insight.record.id, "confirm");
  transitionMemory(root, "insight", insight.record.id, "stale");
  rebuildIndex(root);

  const stale = queryIndex(root, "Historical", { rebuild: false });
  assert.equal(stale.results[0].truth, "stale");
  assert.match(stale.results[0].warning, /requires review/);
  assert.equal(stale.results[0].reviewTrigger, "pricing module changes");

  transitionMemory(root, "insight", insight.record.id, "invalidate");
  rebuildIndex(root);
  assert.deepEqual(queryIndex(root, "Historical", { rebuild: false }).results, []);
  const inactive = queryIndex(root, "Historical", { includeInactive: true, rebuild: false });
  assert.equal(inactive.results[0].truth, "inactive");
});

test("expired validity is surfaced without silently invalidating canonical memory", () => {
  const root = project();
  const fact = createMemory(root, "knowledge", {
    title: "Temporary tax policy",
    evidence: ["pricing.js"],
    validFrom: "2025-01-01",
    validUntil: "2025-12-31"
  });
  transitionMemory(root, "knowledge", fact.record.id, "approve");
  const result = queryIndex(root, "Temporary tax policy");
  assert.equal(result.results[0].truth, "stale");
  assert.match(result.results[0].warning, /expired on 2025-12-31/);
  assert.equal(listMemory(root, "knowledge")[0].record.status, "approved");
});

test("v2 CLI proposes, confirms, queries, and clears memory without touching Markdown", () => {
  const root = project();
  const created = run(root, "sc", "knowledge", "insight", "--propose", "Backend pricing", "--source", "ai", "--evidence", "pricing.js", "--relation", "used_by: OrderService");
  assert.match(created, /Created candidate INS-001/);
  const confirmed = run(root, "sc", "knowledge", "insight", "--confirm", "INS-001");
  assert.match(confirmed, /INS-001: confirmed/);
  const queried = run(root, "sc", "knowledge", "study", "OrderService");
  assert.match(queried, /INS-001/);
  const canonical = fs.readFileSync(path.join(root, ".scrumrun", "memory", "insights", "INS-001.md"), "utf8");
  const cleared = run(root, "sc", "knowledge", "context", "--clear");
  assert.match(cleared, /canonical Markdown was not changed/);
  assert.equal(fs.existsSync(indexPath(root)), false);
  assert.equal(fs.readFileSync(path.join(root, ".scrumrun", "memory", "insights", "INS-001.md"), "utf8"), canonical);
});

test("semantic query caps relation output and reports truncation", () => {
  const root = project();
  const insight = createMemory(root, "insight", {
    title: "Bounded relation context",
    relations: Array.from({ length: 8 }, (_, index) => `used_by: Consumer${index}`)
  });
  const result = queryIndex(root, "Bounded relation context", { relationLimit: 3 });
  const record = result.results.find((item) => item.id === insight.record.id);
  assert.equal(record.relations.length, 3);
  assert.equal(record.relationCount, 8);
  assert.equal(record.relationsTruncated, true);
});

test("generated map is bounded, fingerprinted, and explicitly non-authoritative", () => {
  const root = project();
  createMemory(root, "insight", { title: "Mapped insight", relations: ["used_by: MapConsumer"] });
  rebuildIndex(root);
  const result = writeMap(root, { nodeLimit: 2, edgeLimit: 2 });
  const content = fs.readFileSync(result.file, "utf8");
  assert.match(content, /^Source fingerprint: [a-f0-9]{64}$/m);
  assert.match(content, /Authority: none/);
  assert.match(content, /Mapped insight/);
  assert.equal(mapStatus(root).stale, false);
});

test("generated map status refuses stale projection", () => {
  const root = project();
  assert.equal(mapStatus(root).stale, true);
  const shown = spawnSync(process.execPath, [bin, "sc", "knowledge", "map", "--show"], { cwd: root, encoding: "utf8" });
  assert.notEqual(shown.status, 0);
  assert.match(`${shown.stdout}${shown.stderr}`, /map\.md is stale/);
  rebuildIndex(root);
  assert.equal(mapStatus(root).reason, "map.md is missing");
  writeMap(root);
  assert.equal(mapStatus(root).stale, false);
  fs.writeFileSync(path.join(root, "pricing.js"), "export function changedPrice() {}\n");
  assert.equal(mapStatus(root).stale, true);
});

test("semantic index staleness uses metadata fast path and content hash fallback", () => {
  const root = project();
  rebuildIndex(root);
  const source = path.join(root, "pricing.js");
  const originalRead = fs.readFileSync;
  let sourceReads = 0;
  fs.readFileSync = function instrumented(file, ...args) {
    if (path.resolve(String(file)) === path.resolve(source)) sourceReads++;
    return originalRead.call(fs, file, ...args);
  };
  let fresh;
  try {
    fresh = indexStatus(root);
  } finally {
    fs.readFileSync = originalRead;
  }
  assert.equal(fresh.stale, false);
  assert.equal(fresh.check, "metadata");
  assert.equal(sourceReads, 0);

  const before = fs.statSync(source);
  fs.utimesSync(source, before.atime, new Date(before.mtimeMs + 1000));
  const metadataOnly = indexStatus(root);
  assert.equal(metadataOnly.stale, false);
  assert.equal(metadataOnly.check, "hash");
  assert.match(metadataOnly.reason, /semantic content is unchanged/);

  fs.writeFileSync(source, "export function calculateFinalPrice() { return 42; }\n");
  const changed = indexStatus(root);
  assert.equal(changed.stale, true);
  assert.equal(changed.check, "hash");
  assert.match(changed.reason, /content changed/);
  assert.equal(queryIndex(root, "calculateFinalPrice").rebuilt, true);
  assert.equal(indexStatus(root).check, "metadata");
});

test("obsolete semantic index schema forces one disposable rebuild", () => {
  const root = project();
  rebuildIndex(root);
  const { DatabaseSync } = require("node:sqlite");
  const database = new DatabaseSync(indexPath(root));
  database.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'").run(String(INDEX_SCHEMA_VERSION - 1));
  database.close();
  const status = indexStatus(root);
  assert.equal(status.stale, true);
  assert.equal(status.check, "schema");
  assert.equal(queryIndex(root, "calculateFinalPrice").rebuilt, true);
});
