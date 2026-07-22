"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { ARTIFACT_TYPES, ArtifactRepository, assertNoSymlinkPath, atomicWrite, sha256 } = require("../v2/artifacts");
const { extractEvidence, extractRelations } = require("./markdown");
const { JavaScriptAdapter } = require("../code-intel/javascript");
const { scanProject, sourceFiles } = require("../code-intel/scanner");
const { DEFAULT_CONTEXT_RESULTS, DEFAULT_RELATIONS_PER_RESULT, MAX_CONTEXT_RESULTS, MAX_RELATIONS_PER_RESULT } = require("../runtime/budgets");
const { containsSecret } = require("../security/secrets");
const { canonicalWatchSnapshot, fileWatchSnapshot } = require("../runtime/canonical-snapshot");

const CACHE_RELATIVE = path.join(".cache", "semantic-index.sqlite");
const INDEX_SCHEMA_VERSION = 4;
const INACTIVE = new Set(["rejected", "invalidated", "deprecated", "archived"]);
const SEARCH_BACKENDS = new Set(["auto", "fts5", "like"]);
const MAX_SEARCH_TOKENS = 32;

function indexPath(projectRoot) {
  return path.join(projectRoot, ".scrumrun", CACHE_RELATIVE);
}

function titleFromBody(body, fallback) {
  return ((String(body || "").match(/^#\s+([^\r\n]+)/m) || [])[1] || fallback).trim();
}

function normalizeSearchText(...values) {
  return values.map((value) => String(value || "")).join(" ").normalize("NFKC").toLowerCase();
}

function canonicalArtifacts(scrumDir) {
  const repository = new ArtifactRepository(scrumDir);
  const artifacts = [];
  for (const kind of Object.keys(ARTIFACT_TYPES)) {
    for (const artifact of repository.list(kind)) {
      if (!artifact.record || artifact.errors.length) continue;
      const content = fs.readFileSync(artifact.file, "utf8");
      if (containsSecret(content)) throw new Error(`Secret-like content detected in canonical artifact: ${path.relative(scrumDir, artifact.file)}`);
      artifacts.push({
        record: artifact.record,
        body: artifact.body,
        content,
        path: path.relative(scrumDir, artifact.file).split(path.sep).join("/"),
        title: titleFromBody(artifact.body, artifact.record.id)
      });
    }
  }
  return artifacts.sort((a, b) => a.record.id.localeCompare(b.record.id));
}

function memoryFingerprint(scrumDir) {
  const rows = canonicalArtifacts(scrumDir)
    .map((artifact) => `${artifact.path}\0${sha256(artifact.content)}`);
  return sha256(rows.join("\n"));
}

function sourceSnapshot(projectRoot, { watch = null } = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const artifacts = canonicalArtifacts(scrumDir);
  const code = scanProject(projectRoot);
  const artifactRows = artifacts.map((artifact) => `${artifact.path}\0${sha256(artifact.content)}`);
  const codeRows = code.nodes
    .filter((node) => node.kind === "module")
    .map((node) => `${node.path}\0${node.fingerprint}`);
  const fingerprint = sha256([...artifactRows, ...codeRows].sort().join("\n"));
  return { artifacts, code, fingerprint, watch: watch || sourceWatchSnapshot(projectRoot) };
}

function sourceWatchSnapshot(projectRoot) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const canonical = canonicalWatchSnapshot(scrumDir);
  const adapters = [new JavaScriptAdapter()];
  const discovered = sourceFiles(path.resolve(projectRoot), adapters);
  const code = fileWatchSnapshot(projectRoot, discovered.files.map((item) => item.file), adapters.map((adapter) => `adapter\0${adapter.id}`));
  const rows = [
    ...canonical.rows.map((row) => `canonical\0${row}`),
    ...code.rows.map((row) => `code\0${row}`)
  ];
  return {
    fingerprint: sha256(rows.sort().join("\n")),
    canonicalFiles: canonical.files,
    sourceFiles: code.files,
    warnings: discovered.warnings
  };
}

function explicitEdges(artifact) {
  const edges = [];
  const fields = [
    ["feature", "belongs_to"],
    ["sprint", "included_in"],
    ["task", "executes"],
    ["subject", "about"],
    ["subject_id", "about"],
    ["source_id", "evidenced_by"]
  ];
  for (const [field, relation] of fields) {
    const target = artifact.record[field];
    if (typeof target === "string" && target.trim()) edges.push({ relation, target: target.trim(), evidence: `frontmatter:${field}` });
  }
  for (const item of extractRelations(artifact.body)) {
    edges.push({ relation: item.relation, target: item.target, evidence: "body:Relations" });
  }
  for (const target of extractEvidence(artifact.body)) {
    edges.push({ relation: "evidenced_by", target, evidence: "body:Evidence" });
  }
  const unique = new Map();
  for (const edge of edges) unique.set(`${edge.relation}\0${edge.target}\0${edge.evidence}`, edge);
  return [...unique.values()];
}

function createSchema(database, { searchBackend = "auto" } = {}) {
  if (!SEARCH_BACKENDS.has(searchBackend)) throw new Error(`Unknown semantic search backend: ${searchBackend}`);
  database.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = FULL;
    CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      hash TEXT NOT NULL,
      content TEXT NOT NULL,
      valid_from TEXT,
      valid_until TEXT,
      last_verified_commit TEXT,
      review_trigger TEXT,
      search_text TEXT NOT NULL,
      active INTEGER NOT NULL CHECK (active IN (0, 1))
    );
    CREATE TABLE edges (
      from_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      to_id TEXT NOT NULL,
      evidence TEXT NOT NULL,
      confidence TEXT NOT NULL,
      PRIMARY KEY (from_id, relation, to_id, evidence)
    );
    CREATE TABLE code_nodes (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      name TEXT NOT NULL,
      qualified_name TEXT NOT NULL,
      path TEXT NOT NULL,
      line INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      commit_hash TEXT,
      status TEXT NOT NULL CHECK (status IN ('current', 'orphaned')),
      language TEXT NOT NULL,
      exported INTEGER NOT NULL CHECK (exported IN (0, 1)),
      remapped_from TEXT,
      search_text TEXT NOT NULL
    );
    CREATE TABLE evidence_snapshots (
      artifact_id TEXT NOT NULL,
      reference TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (artifact_id, reference)
    );
    CREATE TABLE subject_snapshots (
      artifact_id TEXT PRIMARY KEY,
      subject_id TEXT NOT NULL,
      symbol_id TEXT,
      fingerprint TEXT NOT NULL
    );
    CREATE TABLE invalidations (
      artifact_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      reference TEXT NOT NULL,
      artifact_hash TEXT NOT NULL,
      PRIMARY KEY (artifact_id, reason, reference)
    );
    CREATE INDEX edges_from ON edges(from_id);
    CREATE INDEX edges_to ON edges(to_id);
    CREATE INDEX artifacts_status ON artifacts(status);
  `);
  if (searchBackend === "like") return "like";
  try {
    database.exec(`
      CREATE VIRTUAL TABLE artifacts_fts USING fts5(id UNINDEXED, title, content, tokenize='unicode61');
      CREATE VIRTUAL TABLE code_fts USING fts5(id UNINDEXED, name, qualified_name, path, tokenize='unicode61');
    `);
    return "fts5";
  } catch (error) {
    if (searchBackend === "fts5" || !/no such module:\s*fts5/i.test(error.message)) throw error;
    return "like";
  }
}

function tableExists(database, name) {
  return Boolean(database.prepare("SELECT 1 FROM sqlite_master WHERE name = ?").get(name));
}

function priorIndex(file) {
  if (!fs.existsSync(file)) return { nodes: [], edges: [], evidence: [], subjects: [], invalidations: [] };
  let database;
  try {
    database = new DatabaseSync(file, { readOnly: true });
    if (!tableExists(database, "code_nodes")) return { nodes: [], edges: [], evidence: [], subjects: [], invalidations: [] };
    return {
      nodes: database.prepare("SELECT * FROM code_nodes").all(),
      edges: database.prepare("SELECT e.* FROM edges e JOIN code_nodes c ON c.id = e.from_id").all(),
      evidence: tableExists(database, "evidence_snapshots") ? database.prepare("SELECT * FROM evidence_snapshots").all() : [],
      subjects: tableExists(database, "subject_snapshots") ? database.prepare("SELECT * FROM subject_snapshots").all() : [],
      invalidations: tableExists(database, "invalidations") ? database.prepare("SELECT * FROM invalidations").all() : []
    };
  } catch {
    return { nodes: [], edges: [], evidence: [], subjects: [], invalidations: [] };
  } finally {
    if (database) database.close();
  }
}

function remapCode(currentNodes, prior) {
  const previous = prior.nodes.filter((node) => node.status === "current");
  const currentIds = new Set(currentNodes.map((node) => node.id));
  const used = new Set();
  const nodes = currentNodes.map((node) => {
    if (currentIds.has(node.id) && previous.some((old) => old.id === node.id)) {
      used.add(node.id);
      return { ...node, status: "current", remappedFrom: null };
    }
    const candidates = previous.filter((old) => !used.has(old.id) && old.kind === node.kind && old.fingerprint === node.fingerprint);
    const match = candidates.length === 1 ? candidates[0] : null;
    if (match) used.add(match.id);
    return { ...node, status: "current", remappedFrom: match ? match.id : null };
  });
  const newlyOrphaned = previous
    .filter((node) => !currentIds.has(node.id) && !used.has(node.id))
    .map((node) => ({
      id: node.id,
      name: node.name,
      qualifiedName: node.qualified_name,
      kind: node.kind,
      path: node.path,
      line: node.line,
      fingerprint: node.fingerprint,
      commit: node.commit_hash,
      status: "orphaned",
      language: node.language,
      exported: Boolean(node.exported),
      remappedFrom: null
    }));
  const carriedOrphans = prior.nodes
    .filter((node) => node.status === "orphaned" && !currentIds.has(node.id))
    .map((node) => ({
      id: node.id,
      name: node.name,
      qualifiedName: node.qualified_name,
      kind: node.kind,
      path: node.path,
      line: node.line,
      fingerprint: node.fingerprint,
      commit: node.commit_hash,
      status: "orphaned",
      language: node.language,
      exported: Boolean(node.exported),
      remappedFrom: null
    }));
  const orphaned = [...new Map([...newlyOrphaned, ...carriedOrphans].map((node) => [node.id, node])).values()];
  return { nodes: [...nodes, ...orphaned], orphanIds: new Set(orphaned.map((node) => node.id)) };
}

function evidenceFile(projectRoot, reference) {
  const raw = String(reference);
  if (/^[A-Z]+-\d{3,}$/.test(raw)) return { type: "artifact", value: raw };
  const relative = raw.replace(/^path:\s*/i, "").replace(/#L\d+(?:-L\d+)?$/i, "").replace(/:\d+(?::\d+)?$/, "");
  if (path.isAbsolute(relative) || relative.split(/[\\/]+/).includes("..") || /(^|[\\/])vault(?:\.local)?\.md$/i.test(relative)) {
    return { type: "forbidden", value: relative };
  }
  return { type: "path", value: relative };
}

function evidenceSnapshots(projectRoot, artifacts) {
  const artifactHashes = new Map(artifacts.map((artifact) => [artifact.record.id, sha256(artifact.content)]));
  const snapshots = [];
  for (const artifact of artifacts.filter((item) => ["knowledge", "decision", "insight", "dossier"].includes(item.record.kind))) {
    for (const reference of extractEvidence(artifact.body)) {
      const resolved = evidenceFile(projectRoot, reference);
      let fingerprint = resolved.type;
      if (resolved.type === "artifact") fingerprint = artifactHashes.get(resolved.value) || "missing";
      if (resolved.type === "path") {
        const candidates = [path.resolve(projectRoot, resolved.value), path.resolve(projectRoot, ".scrumrun", resolved.value)];
        const file = candidates.find((candidate) => {
          if (!candidate.startsWith(`${path.resolve(projectRoot)}${path.sep}`) || !fs.existsSync(candidate)) return false;
          try {
            assertNoSymlinkPath(projectRoot, candidate);
            return fs.lstatSync(candidate).isFile();
          } catch {
            return false;
          }
        });
        fingerprint = file ? sha256(fs.readFileSync(file)) : "missing";
      }
      snapshots.push({ artifactId: artifact.record.id, reference, fingerprint });
    }
  }
  return snapshots;
}

function codeSubject(record) {
  const type = String(record.subject_type || "").toLowerCase();
  const subject = typeof record.subject_id === "string" ? record.subject_id : typeof record.subject === "string" ? record.subject : null;
  if (!subject) return null;
  if (/^(?:symbol|module):/.test(subject) || /^(?:function|class|interface|type|enum):/.test(subject)) return subject;
  if (["symbol", "function", "class", "interface", "type", "enum", "module"].includes(type)) return `${type}:${subject}`;
  return null;
}

function resolveSubject(subject, codeNodes, priorSubject = null) {
  const current = codeNodes.filter((node) => node.status === "current");
  let matches = current.filter((node) => node.id === subject || node.qualifiedName === subject);
  const generic = subject.match(/^(function|class|interface|type|enum):(.+)$/);
  if (!matches.length && generic) matches = current.filter((node) => node.kind === generic[1] && node.name === generic[2]);
  const symbolic = subject.match(/^symbol:(.+)$/);
  if (!matches.length && symbolic) matches = current.filter((node) => node.kind !== "module" && node.name === symbolic[1]);
  if (!matches.length && priorSubject && priorSubject.symbol_id) {
    matches = current.filter((node) => node.remappedFrom === priorSubject.symbol_id);
  }
  if (matches.length !== 1) return { symbolId: null, fingerprint: matches.length ? "ambiguous" : "missing" };
  return { symbolId: matches[0].id, fingerprint: matches[0].fingerprint };
}

function derivedInvalidations(projectRoot, artifacts, codeNodes, prior, evidence) {
  const artifactHashes = new Map(artifacts.map((artifact) => [artifact.record.id, sha256(artifact.content)]));
  const invalidations = new Map();
  const add = (artifactId, reason, reference) => {
    const artifactHash = artifactHashes.get(artifactId);
    if (!artifactHash) return;
    invalidations.set(`${artifactId}\0${reason}\0${reference}`, { artifactId, reason, reference, artifactHash });
  };
  for (const old of prior.invalidations) {
    if (artifactHashes.get(old.artifact_id) === old.artifact_hash) add(old.artifact_id, old.reason, old.reference);
  }
  const priorEvidence = new Map(prior.evidence.map((item) => [`${item.artifact_id}\0${item.reference}`, item]));
  for (const snapshot of evidence) {
    const old = priorEvidence.get(`${snapshot.artifactId}\0${snapshot.reference}`);
    if (old && old.fingerprint !== snapshot.fingerprint) add(snapshot.artifactId, "Evidence changed since the last index build", snapshot.reference);
    if (["missing", "forbidden"].includes(snapshot.fingerprint)) add(snapshot.artifactId, "Evidence is no longer resolvable", snapshot.reference);
  }
  const priorSubjects = new Map(prior.subjects.map((item) => [item.artifact_id, item]));
  const subjects = [];
  for (const artifact of artifacts.filter((item) => ["knowledge", "decision", "insight", "dossier"].includes(item.record.kind))) {
    const subject = codeSubject(artifact.record);
    if (!subject) continue;
    const old = priorSubjects.get(artifact.record.id);
    const resolved = resolveSubject(subject, codeNodes, old);
    subjects.push({ artifactId: artifact.record.id, subjectId: subject, ...resolved });
    if (old && resolved.fingerprint !== old.fingerprint) {
      add(artifact.record.id, resolved.fingerprint === "missing" ? "Code subject became orphaned" : "Code subject implementation changed", subject);
    } else if (resolved.fingerprint === "missing") {
      add(artifact.record.id, "Code subject cannot be resolved", subject);
    } else if (resolved.fingerprint === "ambiguous") {
      add(artifact.record.id, "Code subject is ambiguous", subject);
    }
  }
  return { invalidations: [...invalidations.values()], subjects };
}

function rebuildIndex(projectRoot, { searchBackend = "auto" } = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  if (!fs.existsSync(scrumDir)) throw new Error("Not a ScrumRun project: .scrumrun/ is missing.");
  const cacheDir = path.join(scrumDir, ".cache");
  assertNoSymlinkPath(scrumDir, cacheDir);
  fs.mkdirSync(cacheDir, { recursive: true });
  const target = indexPath(projectRoot);
  assertNoSymlinkPath(scrumDir, target);
  const temp = path.join(cacheDir, `.semantic-index.${process.pid}.${Date.now()}.tmp`);
  const snapshot = sourceSnapshot(projectRoot);
  const artifacts = snapshot.artifacts;
  const prior = priorIndex(target);
  const remapped = remapCode(snapshot.code.nodes, prior);
  const evidence = evidenceSnapshots(projectRoot, artifacts);
  const derived = derivedInvalidations(projectRoot, artifacts, remapped.nodes, prior, evidence);
  let database;
  let selectedSearchBackend;
  try {
    database = new DatabaseSync(temp);
    selectedSearchBackend = createSchema(database, { searchBackend });
    const insertArtifact = database.prepare("INSERT INTO artifacts(id, kind, status, title, path, hash, content, valid_from, valid_until, last_verified_commit, review_trigger, search_text, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertFts = selectedSearchBackend === "fts5"
      ? database.prepare("INSERT INTO artifacts_fts(id, title, content) VALUES (?, ?, ?)")
      : null;
    const insertEdge = database.prepare("INSERT OR IGNORE INTO edges(from_id, relation, to_id, evidence, confidence) VALUES (?, ?, ?, ?, ?)");
    const insertCode = database.prepare("INSERT INTO code_nodes(id, kind, name, qualified_name, path, line, fingerprint, commit_hash, status, language, exported, remapped_from, search_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
    const insertCodeFts = selectedSearchBackend === "fts5"
      ? database.prepare("INSERT INTO code_fts(id, name, qualified_name, path) VALUES (?, ?, ?, ?)")
      : null;
    database.exec("BEGIN IMMEDIATE");
    try {
      for (const artifact of artifacts) {
        insertArtifact.run(
          artifact.record.id,
          artifact.record.kind,
          artifact.record.status,
          artifact.title,
          artifact.path,
          sha256(artifact.content),
          artifact.content,
          artifact.record.valid_from || null,
          artifact.record.valid_until || null,
          artifact.record.last_verified_commit || null,
          artifact.record.review_trigger || null,
          normalizeSearchText(artifact.title, artifact.content),
          INACTIVE.has(artifact.record.status) ? 0 : 1
        );
        if (insertFts) insertFts.run(artifact.record.id, artifact.title, artifact.content);
        for (const edge of explicitEdges(artifact)) insertEdge.run(artifact.record.id, edge.relation, edge.target, edge.evidence, "canonical");
      }
      for (const node of remapped.nodes) {
        insertCode.run(
          node.id,
          node.kind,
          node.name,
          node.qualifiedName,
          node.path,
          node.line,
          node.fingerprint,
          node.commit || null,
          node.status,
          node.language,
          node.exported ? 1 : 0,
          node.remappedFrom || null,
          normalizeSearchText(node.name, node.qualifiedName, node.path)
        );
        if (insertCodeFts) insertCodeFts.run(node.id, node.name, node.qualifiedName, node.path);
      }
      for (const edge of snapshot.code.edges) insertEdge.run(edge.from, edge.relation, edge.to, edge.evidence, edge.confidence);
      for (const edge of prior.edges.filter((item) => remapped.orphanIds.has(item.from_id))) {
        insertEdge.run(edge.from_id, edge.relation, edge.to_id, edge.evidence, edge.confidence || "historical");
      }
      const insertEvidence = database.prepare("INSERT OR REPLACE INTO evidence_snapshots(artifact_id, reference, fingerprint) VALUES (?, ?, ?)");
      for (const item of evidence) insertEvidence.run(item.artifactId, item.reference, item.fingerprint);
      const insertSubject = database.prepare("INSERT INTO subject_snapshots(artifact_id, subject_id, symbol_id, fingerprint) VALUES (?, ?, ?, ?)");
      for (const item of derived.subjects) insertSubject.run(item.artifactId, item.subjectId, item.symbolId, item.fingerprint);
      const insertInvalidation = database.prepare("INSERT INTO invalidations(artifact_id, reason, reference, artifact_hash) VALUES (?, ?, ?, ?)");
      for (const item of derived.invalidations) insertInvalidation.run(item.artifactId, item.reason, item.reference, item.artifactHash);
      const metadata = database.prepare("INSERT INTO metadata(key, value) VALUES (?, ?)");
      metadata.run("schema_version", String(INDEX_SCHEMA_VERSION));
      metadata.run("method_version", "2.0.0");
      metadata.run("search_backend", selectedSearchBackend);
      metadata.run("source_fingerprint", snapshot.fingerprint);
      metadata.run("source_watch_fingerprint", snapshot.watch.fingerprint);
      metadata.run("artifact_count", String(artifacts.length));
      metadata.run("code_node_count", String(remapped.nodes.length));
      metadata.run("source_file_count", String(snapshot.watch.sourceFiles));
      metadata.run("code_adapter", snapshot.code.adapterIds.join(","));
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
    database.close();
    database = null;
    fs.renameSync(temp, target);
  } catch (error) {
    if (database) database.close();
    if (fs.existsSync(temp)) fs.rmSync(temp, { force: true });
    throw error;
  }
  return {
    file: target,
    fingerprint: snapshot.fingerprint,
    watchFingerprint: snapshot.watch.fingerprint,
    searchBackend: selectedSearchBackend,
    artifacts: artifacts.length,
    codeNodes: remapped.nodes.length,
    warnings: [...snapshot.code.warnings, ...snapshot.watch.warnings]
  };
}

function runtimeSupportsFts5(database) {
  try {
    database.prepare("SELECT 1 FROM artifacts_fts LIMIT 1").get();
    return true;
  } catch {
    return false;
  }
}

function indexStatus(projectRoot) {
  const file = indexPath(projectRoot);
  if (!fs.existsSync(file)) return { exists: false, stale: true, file };
  let database;
  try {
    assertNoSymlinkPath(path.join(projectRoot, ".scrumrun"), file);
    database = new DatabaseSync(file, { readOnly: true });
    const metadata = new Map(database.prepare("SELECT key, value FROM metadata").all().map((row) => [row.key, row.value]));
    const stored = metadata.get("source_fingerprint") || null;
    const searchBackend = metadata.get("search_backend") || null;
    if (
      metadata.get("schema_version") !== String(INDEX_SCHEMA_VERSION)
      || !metadata.get("source_watch_fingerprint")
      || !["fts5", "like"].includes(searchBackend)
    ) {
      return { exists: true, stale: true, file, stored, check: "schema", reason: `semantic index schema ${INDEX_SCHEMA_VERSION} rebuild required` };
    }
    if (searchBackend === "fts5" && !runtimeSupportsFts5(database)) {
      return { exists: true, stale: true, file, stored, searchBackend, check: "schema", reason: "semantic index requires unavailable FTS5; fallback rebuild required" };
    }
    const watch = sourceWatchSnapshot(projectRoot);
    if (metadata.get("source_watch_fingerprint") === watch.fingerprint) {
      return { exists: true, stale: false, file, stored, actual: stored, watch: watch.fingerprint, searchBackend, check: "metadata" };
    }
    const actual = sourceSnapshot(projectRoot, { watch }).fingerprint;
    return {
      exists: true,
      stale: !stored || stored !== actual,
      file,
      stored,
      actual,
      watch: watch.fingerprint,
      searchBackend,
      check: "hash",
      reason: stored === actual ? "file metadata changed but semantic content is unchanged" : "canonical or source content changed"
    };
  } catch (error) {
    return { exists: true, stale: true, file, error: error.message };
  } finally {
    if (database) database.close();
  }
}

function searchTokens(query) {
  return (String(query || "").normalize("NFKC").match(/[\p{L}\p{N}_-]+/gu) || []).slice(0, MAX_SEARCH_TOKENS);
}

function ftsQuery(query) {
  const tokens = searchTokens(query);
  return tokens.map((token) => `"${token.replace(/"/g, "")}"`).join(" AND ");
}

function fallbackArtifactRows(database, tokens, activeClause, cap) {
  if (!tokens.length) return [];
  const clauses = tokens.map(() => "instr(a.search_text, ?) > 0").join(" AND ");
  const parameters = tokens.map((token) => normalizeSearchText(token));
  return database.prepare(`
    SELECT a.id, a.kind, a.status, a.title, a.path, a.active, a.valid_until, a.review_trigger
    FROM artifacts a
    WHERE ${clauses} ${activeClause}
    ORDER BY a.id LIMIT ?
  `).all(...parameters, cap);
}

function fallbackCodeRows(database, tokens, cap) {
  if (!tokens.length) return [];
  const clauses = tokens.map(() => "instr(c.search_text, ?) > 0").join(" AND ");
  const parameters = tokens.map((token) => normalizeSearchText(token));
  return database.prepare(`
    SELECT c.id, c.kind, c.name AS title, c.qualified_name, c.path, c.line, c.fingerprint,
      c.commit_hash, c.status, c.language, c.remapped_from
    FROM code_nodes c
    WHERE ${clauses}
    ORDER BY CASE c.status WHEN 'current' THEN 0 ELSE 1 END, c.id LIMIT ?
  `).all(...parameters, cap);
}

function queryIndex(projectRoot, query, { includeInactive = false, limit = DEFAULT_CONTEXT_RESULTS, relationLimit = DEFAULT_RELATIONS_PER_RESULT, rebuild = true } = {}) {
  const text = String(query || "").trim();
  if (!text) throw new Error("A non-empty memory query is required.");
  const status = indexStatus(projectRoot);
  let rebuilt = false;
  if (status.stale) {
    if (!rebuild) throw new Error("Semantic index is missing or stale; rebuild it first.");
    rebuildIndex(projectRoot);
    rebuilt = true;
  }
  const database = new DatabaseSync(indexPath(projectRoot), { readOnly: true });
  try {
    const metadata = new Map(database.prepare("SELECT key, value FROM metadata").all().map((row) => [row.key, row.value]));
    const searchBackend = metadata.get("search_backend");
    const cap = Math.max(1, Math.min(Number(limit) || DEFAULT_CONTEXT_RESULTS, MAX_CONTEXT_RESULTS));
    const relationCap = Math.max(1, Math.min(Number(relationLimit) || DEFAULT_RELATIONS_PER_RESULT, MAX_RELATIONS_PER_RESULT));
    const activeClause = includeInactive ? "" : "AND a.active = 1";
    const matches = new Map();
    const tokens = searchTokens(text);
    const match = ftsQuery(text);
    if (tokens.length) {
      const rows = searchBackend === "fts5"
        ? database.prepare(`
          SELECT a.id, a.kind, a.status, a.title, a.path, a.active, a.valid_until, a.review_trigger, bm25(artifacts_fts) AS rank
          FROM artifacts_fts JOIN artifacts a ON a.id = artifacts_fts.id
          WHERE artifacts_fts MATCH ? ${activeClause}
          ORDER BY rank, a.id LIMIT ?
        `).all(match, cap)
        : fallbackArtifactRows(database, tokens, activeClause, cap);
      for (const row of rows) matches.set(`artifact:${row.id}`, { ...row, nodeType: "artifact", match: "content" });
    }
    const like = `%${text.toLowerCase()}%`;
    const relationRows = database.prepare(`
      SELECT DISTINCT a.id, a.kind, a.status, a.title, a.path, a.active, a.valid_until, a.review_trigger,
        e.relation, e.to_id, e.evidence
      FROM edges e JOIN artifacts a ON a.id = e.from_id
      WHERE (lower(e.to_id) LIKE ? OR lower(e.relation) LIKE ?) ${activeClause}
      ORDER BY a.id LIMIT ?
    `).all(like, like, cap);
    for (const row of relationRows) {
      const key = `artifact:${row.id}`;
      const existing = matches.get(key);
      if (existing) existing.match = "content+relation";
      else matches.set(key, { ...row, nodeType: "artifact", match: "relation" });
    }
    if (tokens.length) {
      const codeRows = searchBackend === "fts5"
        ? database.prepare(`
          SELECT c.id, c.kind, c.name AS title, c.qualified_name, c.path, c.line, c.fingerprint,
            c.commit_hash, c.status, c.language, c.remapped_from, bm25(code_fts) AS rank
          FROM code_fts JOIN code_nodes c ON c.id = code_fts.id
          WHERE code_fts MATCH ?
          ORDER BY CASE c.status WHEN 'current' THEN 0 ELSE 1 END, rank, c.id LIMIT ?
        `).all(match, cap)
        : fallbackCodeRows(database, tokens, cap);
      for (const row of codeRows) matches.set(`code:${row.id}`, { ...row, nodeType: "code", match: "code" });
    }
    const codeRelationRows = database.prepare(`
      SELECT DISTINCT c.id, c.kind, c.name AS title, c.qualified_name, c.path, c.line, c.fingerprint,
        c.commit_hash, c.status, c.language, c.remapped_from, e.relation, e.to_id, e.evidence
      FROM edges e JOIN code_nodes c ON c.id = e.from_id
      WHERE lower(e.to_id) LIKE ? OR lower(e.relation) LIKE ?
      ORDER BY CASE c.status WHEN 'current' THEN 0 ELSE 1 END, c.id LIMIT ?
    `).all(like, like, cap);
    for (const row of codeRelationRows) {
      const key = `code:${row.id}`;
      const existing = matches.get(key);
      if (existing) existing.match = existing.match === "code" ? "code+relation" : existing.match;
      else matches.set(key, { ...row, nodeType: "code", match: "relation" });
    }
    const results = [...matches.values()].slice(0, cap).map((row) => {
      const relationCount = Number(database.prepare("SELECT count(*) AS total FROM edges WHERE from_id = ?").get(row.id).total);
      const relations = database.prepare("SELECT relation, to_id, evidence FROM edges WHERE from_id = ? ORDER BY relation, to_id LIMIT ?").all(row.id, relationCap);
      if (row.nodeType === "code") {
        return {
          id: row.id,
          kind: row.kind,
          title: row.title,
          qualifiedName: row.qualified_name,
          path: row.path,
          line: row.line,
          fingerprint: row.fingerprint,
          commit: row.commit_hash,
          status: row.status,
          language: row.language,
          match: row.match,
          truth: row.status === "orphaned" ? "orphaned" : "derived",
          ...(row.remapped_from ? { remappedFrom: row.remapped_from } : {}),
          ...(row.status === "orphaned" ? { warning: "Symbol no longer exists at this identity; inspect remaps or history." } : {}),
          relationCount,
          relationsTruncated: relationCount > relations.length,
          relations
        };
      }
      const expired = row.valid_until && row.valid_until < new Date().toISOString().slice(0, 10);
      const invalidations = database.prepare("SELECT reason, reference FROM invalidations WHERE artifact_id = ? ORDER BY reason, reference").all(row.id);
      return {
        id: row.id,
        kind: row.kind,
        status: row.status,
        title: row.title,
        path: row.path,
        match: row.match,
        truth: row.status === "stale" || expired || invalidations.length ? "stale" : row.active ? (CONFIRMED_STATUSES.has(row.status) ? "confirmed" : "candidate") : "inactive",
        ...(expired
          ? { warning: `Validity expired on ${row.valid_until}.` }
          : invalidations.length
            ? { warning: invalidations.map((item) => `${item.reason}: ${item.reference}`).join("; ") }
            : row.status === "stale"
              ? { warning: "Memory is marked stale and requires review." }
              : {}),
        ...(row.review_trigger ? { reviewTrigger: row.review_trigger } : {}),
        ...(invalidations.length ? { invalidations } : {}),
        relationCount,
        relationsTruncated: relationCount > relations.length,
        relations
      };
    });
    return { indexFile: indexPath(projectRoot), rebuilt, searchBackend, query: text, results };
  } finally {
    database.close();
  }
}

const CONFIRMED_STATUSES = new Set(["approved", "confirmed", "resolved", "completed", "passed", "active"]);

function graphIndex(projectRoot, { rebuild = true } = {}) {
  const status = indexStatus(projectRoot);
  if (status.stale && rebuild) rebuildIndex(projectRoot);
  else if (status.stale) throw new Error("Semantic index is missing or stale; rebuild it first.");
  const database = new DatabaseSync(indexPath(projectRoot), { readOnly: true });
  try {
    const artifacts = database.prepare("SELECT id, kind, status, title, path, 'artifact' AS node_type FROM artifacts ORDER BY id").all();
    const code = database.prepare("SELECT id, kind, status, name AS title, path, 'code' AS node_type, fingerprint, remapped_from FROM code_nodes ORDER BY id").all();
    return {
      nodes: [...artifacts, ...code],
      edges: database.prepare("SELECT from_id AS 'from', relation, to_id AS 'to', evidence, confidence FROM edges ORDER BY from_id, relation, to_id").all(),
      invalidations: database.prepare("SELECT artifact_id, reason, reference FROM invalidations ORDER BY artifact_id, reason, reference").all()
    };
  } finally {
    database.close();
  }
}

function writeMap(projectRoot, { nodeLimit = 200, edgeLimit = 400 } = {}) {
  const status = indexStatus(projectRoot);
  if (status.stale) rebuildIndex(projectRoot);
  const graph = graphIndex(projectRoot, { rebuild: false });
  const current = indexStatus(projectRoot);
  const nodes = graph.nodes.slice(0, Math.max(1, nodeLimit));
  const edges = graph.edges.slice(0, Math.max(1, edgeLimit));
  const body = [
    "# ScrumRun Project Map",
    "",
    "Projection schema: 1",
    `Generated: ${new Date().toISOString()}`,
    `Source fingerprint: ${current.stored}`,
    "Authority: none; rebuild from canonical artifacts and source code.",
    "",
    "## Summary",
    "",
    `- Nodes: ${graph.nodes.length}`,
    `- Edges: ${graph.edges.length}`,
    `- Derived invalidations: ${graph.invalidations.length}`,
    "",
    "## Nodes",
    "",
    ...(nodes.length ? nodes.map((node) => `- ${node.id} | ${node.node_type} | ${node.kind} | ${node.status} | ${node.title} | ${node.path}`) : ["- None."]),
    ...(graph.nodes.length > nodes.length ? [`- … ${graph.nodes.length - nodes.length} more nodes in the semantic index.`] : []),
    "",
    "## Relations",
    "",
    ...(edges.length ? edges.map((edge) => `- ${edge.from} --${edge.relation}--> ${edge.to} | ${edge.evidence}`) : ["- None."]),
    ...(graph.edges.length > edges.length ? [`- … ${graph.edges.length - edges.length} more relations in the semantic index.`] : []),
    ""
  ].join("\n");
  const file = path.join(projectRoot, ".scrumrun", "map.md");
  atomicWrite(file, body);
  return { file, nodes: graph.nodes.length, edges: graph.edges.length, fingerprint: current.stored };
}

function mapStatus(projectRoot, { semanticStatus = null } = {}) {
  const file = path.join(projectRoot, ".scrumrun", "map.md");
  if (!fs.existsSync(file)) return { exists: false, stale: true, file, reason: "map.md is missing" };
  try {
    assertNoSymlinkPath(path.join(projectRoot, ".scrumrun"), file);
    if (!fs.lstatSync(file).isFile()) return { exists: true, stale: true, file, reason: "map.md is not a regular file" };
    const content = fs.readFileSync(file, "utf8");
    const stored = (content.match(/^Source fingerprint:\s*([a-f0-9]{64})$/m) || [])[1] || null;
    if (!stored) return { exists: true, stale: true, file, stored, reason: "map.md has no source fingerprint" };
    const semantic = semanticStatus || indexStatus(projectRoot);
    if (!semantic.exists) return { exists: true, stale: true, file, stored, reason: "semantic index is missing" };
    if (semantic.stale) return { exists: true, stale: true, file, stored, reason: semantic.reason || "semantic index is stale" };
    return { exists: true, stale: stored !== semantic.stored, file, stored, actual: semantic.stored, reason: stored === semantic.stored ? null : "map fingerprint differs from the semantic index" };
  } catch (error) {
    return { exists: true, stale: true, file, error: error.message, reason: "map freshness check failed" };
  }
}

module.exports = { CACHE_RELATIVE, INDEX_SCHEMA_VERSION, graphIndex, indexPath, indexStatus, mapStatus, memoryFingerprint, queryIndex, rebuildIndex, sourceSnapshot, sourceWatchSnapshot, writeMap };
