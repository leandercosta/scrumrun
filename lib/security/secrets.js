"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SECRET_PATTERNS = Object.freeze([
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/-]{16,}=*/i,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|private[_-]?key)\s*[:=]\s*[^\s]+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
]);

function containsSecret(value) {
  const text = String(value || "");
  return SECRET_PATTERNS.some((pattern) => pattern.test(text));
}

function assertNoSecret(values, message = "Secret-like content is forbidden outside the local vault.") {
  const list = Array.isArray(values) ? values : [values];
  if (list.some(containsSecret)) throw new Error(message);
}

function secretFingerprints(value) {
  const text = String(value || "");
  const found = new Set();
  for (const pattern of SECRET_PATTERNS) {
    const matcher = new RegExp(pattern.source, `${pattern.flags.replace(/g/g, "")}g`);
    for (const match of text.matchAll(matcher)) {
      found.add(crypto.createHash("sha256").update(match[0]).digest("hex"));
    }
  }
  return [...found].sort();
}

function parseFrontmatter(text) {
  const match = String(text || "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { explicit: {}, raw: "" };
  const body = match[1];
  const explicit = {};
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const kv = line.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/);
    if (!kv) continue;
    const key = kv[1].trim();
    let value = kv[2].trim();
    if (value.startsWith("[") && value.endsWith("]")) {
      value = value.slice(1, -1).split(",").map((s) => s.trim().replace(/^['"]|['"]$/g, "")).filter(Boolean);
    } else if (/^['"].*['"]$/.test(value)) {
      value = value.slice(1, -1);
    } else if (value === "true" || value === "false") {
      value = value === "true";
    }
    explicit[key] = value;
  }
  return { explicit, raw: body };
}

function loadSecretAllowlist(scrumDir) {
  if (!scrumDir || !fs.existsSync(scrumDir)) return new Set();
  const configFile = path.join(scrumDir, "config.md");
  if (!fs.existsSync(configFile) || !fs.lstatSync(configFile).isFile()) return new Set();
  let text;
  try {
    text = fs.readFileSync(configFile, "utf8");
  } catch {
    return new Set();
  }
  const { explicit } = parseFrontmatter(text);
  const raw = explicit.allow_secrets_in;
  if (!raw) return new Set();
  const list = Array.isArray(raw) ? raw : [String(raw)];
  return new Set(list.map((p) => String(p).replace(/^\.\//, "").trim()).filter(Boolean));
}

function isSecretAllowed(relativePath, allowlist) {
  if (!allowlist || !allowlist.size) return false;
  if (!relativePath) return false;
  const normalized = String(relativePath).replace(/^\.\//, "");
  if (allowlist.has(normalized)) return true;
  for (const entry of allowlist) {
    if (entry.endsWith("/") && normalized.startsWith(entry)) return true;
    if (entry.includes("*")) {
      const re = new RegExp("^" + entry.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
      if (re.test(normalized)) return true;
    }
  }
  return false;
}

function containsSecretWithAllowlist(value, relativePath, allowlist) {
  if (isSecretAllowed(relativePath, allowlist)) return false;
  return containsSecret(value);
}

module.exports = {
  SECRET_PATTERNS,
  assertNoSecret,
  containsSecret,
  containsSecretWithAllowlist,
  isSecretAllowed,
  loadSecretAllowlist,
  parseFrontmatter,
  secretFingerprints
};
