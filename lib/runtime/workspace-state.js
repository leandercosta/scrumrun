"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { assertNoSymlinkPath, sha256 } = require("../v2/artifacts");
const { secretFingerprints } = require("../security/secrets");

const SKIP_DIRECTORIES = new Set([".git", ".scrumrun", "node_modules"]);

function posix(value) {
  return value.split(path.sep).join("/");
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function normalizedRelative(projectRoot, value) {
  const root = path.resolve(projectRoot);
  const text = String(value || "").trim().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "");
  if (!text || text === "." || path.posix.isAbsolute(text) || text.split("/").includes("..")) throw new Error(`Unsafe mutation path: ${value || "missing"}`);
  if (text === ".git" || text.startsWith(".git/") || text === ".scrumrun" || text.startsWith(".scrumrun/")) {
    throw new Error(`Mutation Gateway cannot authorize control path: ${text}`);
  }
  const target = path.resolve(root, text);
  if (!target.startsWith(`${root}${path.sep}`)) throw new Error(`Mutation path escapes project: ${text}`);
  assertNoSymlinkPath(root, target);
  return posix(path.relative(root, target));
}

function fileValue(projectRoot, relative) {
  const target = path.join(projectRoot, relative);
  let stat;
  try {
    stat = fs.lstatSync(target);
  } catch (error) {
    if (error.code === "ENOENT") return { path: relative, sha256: null, kind: "missing", mode: null, scan: "not-applicable", secrets: [] };
    throw error;
  }
  if (stat.isSymbolicLink()) {
    const link = fs.readlinkSync(target);
    return { path: relative, sha256: sha256(`symlink\0${link}`), kind: "symlink", mode: stat.mode & 0o777, scan: "not-applicable", secrets: [] };
  }
  if (!stat.isFile()) return { path: relative, sha256: sha256(`non-file\0${stat.mode}`), kind: "other", mode: stat.mode & 0o777, scan: "not-applicable", secrets: [] };
  const content = fs.readFileSync(target);
  const scan = content.length > 10 * 1024 * 1024 ? "too-large" : content.includes(0) ? "binary" : "text";
  const secrets = scan === "text" ? secretFingerprints(content.toString("utf8")) : [];
  return { path: relative, sha256: sha256(content), kind: "file", mode: stat.mode & 0o777, scan, secrets };
}

function gitOutput(projectRoot, args) {
  return execFileSync("git", args, { cwd: projectRoot, encoding: "buffer", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
}

function gitState(projectRoot) {
  let top;
  try {
    top = gitOutput(projectRoot, ["rev-parse", "--show-toplevel"]).toString("utf8").trim();
  } catch {
    return null;
  }
  if (path.resolve(top) !== path.resolve(projectRoot)) return null;
  const head = gitOutput(projectRoot, ["rev-parse", "--verify", "HEAD"]).toString("utf8").trim();
  const flagged = gitOutput(projectRoot, ["ls-files", "-v", "-z", "--", "."]).toString("utf8").split("\0").filter(Boolean)
    .filter((entry) => /^[a-zS] /.test(entry));
  if (flagged.length) throw new Error(`Git workspace contains hidden index flags (assume-unchanged or skip-worktree): ${flagged.slice(0, 10).map((entry) => entry.slice(2)).join(", ")}.`);
  const tracked = gitOutput(projectRoot, ["diff", "--name-only", "-z", "--no-renames", "HEAD", "--", "."]);
  const untracked = gitOutput(projectRoot, ["ls-files", "--others", "--exclude-standard", "-z", "--", "."]);
  const ignored = gitOutput(projectRoot, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z", "--", "."]);
  const paths = new Set(Buffer.concat([tracked, untracked, ignored]).toString("utf8").split("\0").filter(Boolean)
    .map((entry) => entry.replace(/\\/g, "/"))
    .filter((entry) => {
      const segments = entry.split("/");
      return entry !== ".scrumrun" && !entry.startsWith(".scrumrun/") && !segments.includes("node_modules") && !segments.includes(".git");
    }));
  if (paths.size > 20000) throw new Error("Git workspace exceeds the 20,000-file Mutation Gateway limit after ignored-file coverage.");
  const files = [...paths].sort().map((relative) => fileValue(projectRoot, relative));
  return { schema: 1, mode: "git", head, files };
}

function fileState(projectRoot) {
  const files = [];
  function visit(directory, relative = "") {
    const entries = fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) continue;
      const next = relative ? `${relative}/${entry.name}` : entry.name;
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target, next);
      else files.push(fileValue(projectRoot, next));
      if (files.length > 20000) throw new Error("Non-git workspace exceeds the 20,000-file Mutation Gateway limit.");
    }
  }
  visit(projectRoot);
  return { schema: 1, mode: "files", head: null, files };
}

function workspaceState(projectRoot) {
  const root = path.resolve(projectRoot);
  const state = gitState(root) || fileState(root);
  const canonical = {
    schema: state.schema,
    mode: state.mode,
    head: state.head,
    files: state.files.map(({ path: file, sha256: hash, kind, mode, scan }) => ({ path: file, sha256: hash, kind, mode, scan }))
  };
  return { ...state, fingerprint: sha256(stable(canonical)) };
}

function currentBranch(projectRoot) {
  try {
    const branch = gitOutput(projectRoot, ["rev-parse", "--abbrev-ref", "HEAD"]).toString("utf8").trim();
    if (!branch || branch === "HEAD") return null;
    return branch;
  } catch {
    return null;
  }
}

function changesBetween(before, after) {
  if (!before || !after || before.mode !== after.mode || before.head !== after.head) throw new Error("Workspace baseline mode or Git HEAD changed during the Run.");
  const left = new Map(before.files.map((item) => [item.path, item]));
  const right = new Map(after.files.map((item) => [item.path, item]));
  return [...new Set([...left.keys(), ...right.keys()])].sort().flatMap((file) => {
    const previous = left.get(file) || { sha256: null, kind: "clean", mode: null, scan: "not-applicable", secrets: [] };
    const next = right.get(file) || { sha256: null, kind: "clean", mode: null, scan: "not-applicable", secrets: [] };
    if (previous.sha256 === next.sha256 && previous.kind === next.kind && previous.mode === next.mode) return [];
    return [{
      path: file,
      before_sha256: previous.sha256,
      after_sha256: next.sha256,
      before_kind: previous.kind,
      after_kind: next.kind,
      before_mode: previous.mode,
      after_mode: next.mode,
      before_scan: previous.scan,
      after_scan: next.scan,
      new_secret_fingerprints: (next.secrets || []).filter((value) => !(previous.secrets || []).includes(value))
    }];
  });
}

function pathAuthorized(relative, allowed) {
  return allowed.some((entry) => relative === entry || relative.startsWith(`${entry}/`));
}

module.exports = {
  changesBetween,
  currentBranch,
  normalizedRelative,
  pathAuthorized,
  stable,
  workspaceState
};
