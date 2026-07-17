const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");

test("package exposes the expected CLI", () => {
  const pkg = require(path.join(root, "package.json"));

  assert.equal(pkg.name, "scrumrun");
  assert.equal(pkg.bin.scrumrun, "bin/scrumrun.js");
  assert.equal(pkg.engines.node, ">=18");
});

test("CLI help uses the public npm command", () => {
  const output = execFileSync(process.execPath, [path.join(root, "bin/scrumrun.js"), "--help"], {
    encoding: "utf8",
  });

  assert.match(output, /npx scrumrun@latest init/);
  assert.doesNotMatch(output, /github:leandercosta\/scrumrun/);
});

test("CLI reports its package version", () => {
  const pkg = require(path.join(root, "package.json"));

  for (const flag of ["--version", "-v"]) {
    const output = execFileSync(process.execPath, [path.join(root, "bin/scrumrun.js"), flag], {
      encoding: "utf8",
    });

    assert.equal(output.trim(), `ScrumRun ${pkg.version}`);
  }
});
