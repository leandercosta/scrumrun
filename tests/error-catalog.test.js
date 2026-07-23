const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { ScrumRunError, describe, codes, CATALOG } = require("../lib/errors");

test("error catalog exposes stable codes and every entry has a summary + remediation", () => {
  const list = codes();
  assert.ok(list.length >= 20, `catalog should have grown beyond a handful, got ${list.length}`);
  for (const code of list) {
    assert.match(code, /^SR-E-\d{3}$/, `code must match SR-E-NNN, got ${code}`);
    const entry = describe(code);
    assert.ok(entry, `describe(${code}) should not be null`);
    assert.ok(typeof entry.summary === "string" && entry.summary.length > 0, `${code} summary is missing`);
    assert.ok(typeof entry.remediation === "string" && entry.remediation.length > 0, `${code} remediation is missing`);
  }
});

test("ScrumRunError attaches code, summary, and remediation and refuses unknown codes", () => {
  const error = new ScrumRunError("SR-E-100", "Run RUN-999 not found.");
  assert.equal(error.code, "SR-E-100");
  assert.equal(error.name, "ScrumRunError");
  assert.match(error.message, /^SR-E-100 /);
  assert.ok(error.summary.length > 0);
  assert.ok(error.remediation.length > 0);

  assert.throws(() => new ScrumRunError("SR-E-999", "nope"), /Unknown ScrumRun error code/);
});

test("ScrumRunError falls back to the catalog summary when no message is supplied", () => {
  const error = new ScrumRunError("SR-E-050");
  assert.equal(error.message, `SR-E-050 ${CATALOG["SR-E-050"].summary}`);
});

test("docs/ERROR-CODES.md documents every catalog entry", () => {
  const doc = fs.readFileSync(path.join(__dirname, "..", "docs", "ERROR-CODES.md"), "utf8");
  for (const code of codes()) {
    assert.match(doc, new RegExp(`\`${code}\``), `${code} is missing from docs/ERROR-CODES.md`);
  }
});
