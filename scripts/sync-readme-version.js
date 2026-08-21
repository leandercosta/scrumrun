#!/usr/bin/env node

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const { version } = require(path.join(root, "package.json"));
const readmeFile = path.join(root, "README.md");

const readme = fs.readFileSync(readmeFile, "utf8");
const updated = readme.replace(/(\*\*Package:\*\* `)(\d+\.\d+\.\d+)(`)/, `$1${version}$3`);

if (updated === readme) {
  process.exit(0);
}

fs.writeFileSync(readmeFile, updated);
console.log(`Synced README badge to ${version}`);
