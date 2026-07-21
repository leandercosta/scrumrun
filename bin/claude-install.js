#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const path = require("node:path");

const scrumrun = path.join(__dirname, "scrumrun.js");
const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  console.log(`ScrumRun for Claude Code

Usage:
  sr-claude install [--force]
  sr-claude update
  sr-claude doctor [--compat]

This compatibility binary delegates to the manifest-driven ScrumRun CLI.
`);
  process.exit(0);
}

if (!["install", "update", "doctor"].includes(command)) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [scrumrun, "claude", command, ...args.slice(1)], {
  stdio: "inherit"
});
if (result.error) throw result.error;
process.exitCode = result.status === null ? 1 : result.status;
