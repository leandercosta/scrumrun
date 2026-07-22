"use strict";

const crypto = require("node:crypto");

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

module.exports = { SECRET_PATTERNS, assertNoSecret, containsSecret, secretFingerprints };
