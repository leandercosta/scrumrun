"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { JavaScriptAdapter } = require("./javascript");

const EXCLUDED = new Set([".git", ".scrumrun", "node_modules", "vendor", "dist", "build", "coverage", ".next", ".nuxt"]);
const TEST_FILE = /(?:^|\/)(?:__tests__\/.*|[^/]*(?:\.test|\.spec)\.[^/]+)$/i;

function posix(value) {
  return value.split(path.sep).join("/");
}

function currentCommit(projectRoot) {
  const gitDir = path.join(projectRoot, ".git");
  const headFile = path.join(gitDir, "HEAD");
  if (!fs.existsSync(headFile)) return null;
  const head = fs.readFileSync(headFile, "utf8").trim();
  if (/^[a-f0-9]{40,64}$/i.test(head)) return head;
  const ref = (head.match(/^ref:\s+(.+)$/) || [])[1];
  if (!ref || ref.includes("..")) return null;
  const loose = path.join(gitDir, ref);
  if (fs.existsSync(loose)) return fs.readFileSync(loose, "utf8").trim() || null;
  const packed = path.join(gitDir, "packed-refs");
  if (!fs.existsSync(packed)) return null;
  const match = fs.readFileSync(packed, "utf8").match(new RegExp(`^([a-f0-9]{40,64})\\s+${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"));
  return match ? match[1] : null;
}

function sourceFiles(projectRoot, adapters, { maxFiles = 2000, maxFileBytes = 1024 * 1024 } = {}) {
  const files = [];
  const warnings = [];
  function walk(directory) {
    if (files.length >= maxFiles) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (files.length >= maxFiles) break;
      if (entry.isSymbolicLink()) {
        warnings.push(`Skipped symbolic link: ${posix(path.relative(projectRoot, path.join(directory, entry.name)))}`);
        continue;
      }
      if (entry.isDirectory()) {
        if (!EXCLUDED.has(entry.name)) walk(path.join(directory, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const file = path.join(directory, entry.name);
      const adapter = adapters.find((candidate) => candidate.supports(file));
      if (!adapter) continue;
      const size = fs.statSync(file).size;
      if (size > maxFileBytes) {
        warnings.push(`Skipped oversized source: ${posix(path.relative(projectRoot, file))}`);
        continue;
      }
      files.push({ file, relative: path.relative(projectRoot, file), adapter });
    }
  }
  walk(projectRoot);
  if (files.length >= maxFiles) warnings.push(`Source scan reached the ${maxFiles}-file limit.`);
  return { files, warnings };
}

function scanProject(projectRoot, options = {}) {
  const root = path.resolve(projectRoot);
  const adapters = options.adapters || [new JavaScriptAdapter()];
  const commit = currentCommit(root);
  const discovered = sourceFiles(root, adapters, options);
  const scans = [];
  const warnings = [...discovered.warnings];
  for (const source of discovered.files) {
    try {
      scans.push(source.adapter.scan({ projectRoot: root, file: source.file, relative: source.relative, commit }));
    } catch (error) {
      warnings.push(`Failed to scan ${posix(source.relative)}: ${error.message}`);
    }
  }

  const nodes = scans.flatMap((scan) => [scan.module, ...scan.symbols]);
  const edges = [];
  for (const scan of scans) {
    for (const symbol of scan.symbols) {
      edges.push({ from: symbol.id, relation: "defined_in", to: scan.module.id, evidence: `${symbol.path}:${symbol.line}`, confidence: "structural" });
      for (const dependency of scan.dependencies) {
        edges.push({ from: symbol.id, relation: "depends_on", to: dependency.target, evidence: `${symbol.path}:import:${dependency.specifier}`, confidence: "module" });
      }
    }
    for (const dependency of scan.dependencies) {
      edges.push({ from: scan.module.id, relation: "depends_on", to: dependency.target, evidence: `${scan.module.path}:import:${dependency.specifier}`, confidence: "module" });
    }
  }

  const references = new Map();
  for (const scan of scans) {
    const identifiers = new Set(scan.masked.match(/[A-Za-z_$][\w$]*/g) || []);
    for (const identifier of identifiers) {
      if (!references.has(identifier)) references.set(identifier, []);
      references.get(identifier).push(scan);
    }
  }
  const symbols = nodes.filter((node) => node.kind !== "module");
  for (const symbol of symbols) {
    for (const scan of references.get(symbol.name) || []) {
      if (scan.module.path === symbol.path) continue;
      const test = TEST_FILE.test(scan.module.path);
      edges.push({
        from: symbol.id,
        relation: test ? "protected_by" : "used_by",
        to: test ? `test:${scan.module.path}` : scan.module.id,
        evidence: `${scan.module.path}:lexical-reference:${symbol.name}`,
        confidence: "lexical"
      });
    }
  }

  const uniqueEdges = new Map();
  for (const edge of edges) uniqueEdges.set(`${edge.from}\0${edge.relation}\0${edge.to}\0${edge.evidence}`, edge);
  return {
    adapterIds: adapters.map((adapter) => adapter.id),
    commit,
    nodes: nodes.map(({ start, end, ...node }) => node),
    edges: [...uniqueEdges.values()].sort((a, b) => `${a.from}\0${a.relation}\0${a.to}`.localeCompare(`${b.from}\0${b.relation}\0${b.to}`)),
    files: scans.length,
    warnings
  };
}

module.exports = { EXCLUDED, TEST_FILE, currentCommit, scanProject, sourceFiles };
