#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.resolve(__dirname, "..");
const templates = path.join(root, "templates");

const COMMANDS = [
  "run-help",
  "run-study",
  "run-init",
  "run-uninstall",
  "run-update",
  "run-know",
  "run-config",
  "run-golden",
  "run-map",
  "run-challenge",
  "run-goal",
  "run-backlog",
  "run-feature",
  "run-sprint",
  "run-agent",
  "run-review",
  "run-decisions"
];

function usage() {
  console.log(`ScrumRun for Claude Code

Usage:
  sr-claude install [--force]
  sr-claude update
  sr-claude doctor

Examples:
  npx github:leandercosta/scrumrun sr-claude install
  npx github:leandercosta/scrumrun sr-claude update
  npx github:leandercosta/scrumrun sr-claude doctor
`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest, { force = true, vars = {} } = {}) {
  if (fs.existsSync(dest) && !force) {
    return { status: "skipped", dest };
  }
  ensureDir(path.dirname(dest));
  let content = fs.readFileSync(src, "utf8");
  for (const [key, value] of Object.entries(vars)) {
    content = content.split(`{{${key}}}`).join(value);
  }
  fs.writeFileSync(dest, content);
  return { status: "written", dest };
}

function copyDir(srcDir, destDir, options = {}) {
  const results = [];
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dest = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      results.push(...copyDir(src, dest, options));
    } else {
      results.push(copyFile(src, dest, options));
    }
  }
  return results;
}

function printResults(title, results) {
  console.log(`\n${title}`);
  for (const result of results) {
    const prefix = result.status === "skipped" ? "skip" : "write";
    console.log(`  ${prefix} ${result.dest}`);
  }
}

function cleanupLegacy(commandsDir, skillsDir) {
  if (fs.existsSync(commandsDir)) {
    for (const entry of fs.readdirSync(commandsDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const name = entry.name;
      const legacyPrefix = name.startsWith("srun-") || name.startsWith("asm-") || name.startsWith("sr-") || name.startsWith("scr-") || name.startsWith("src-");
      const oldConsolidated = /^scr-[a-z]+-[a-z]+\.md$/.test(name);
      if (legacyPrefix || oldConsolidated) {
        fs.rmSync(path.join(commandsDir, name), { force: true });
        console.log(`  rm legacy ${path.join(commandsDir, name)}`);
      }
    }
  }
  const oldSkill = path.join(skillsDir, "ai-scrum");
  if (fs.existsSync(oldSkill)) {
    fs.rmSync(oldSkill, { recursive: true, force: true });
    console.log(`  rm legacy ${oldSkill}`);
  }
}

function install(force) {
  const home = os.homedir();
  const commandsDir = path.join(home, ".claude", "commands");
  cleanupLegacy(commandsDir, path.join(home, ".claude", "skills"));
  const results = [
    ...copyDir(path.join(templates, "codex", "prompts"), commandsDir, { force }),
    ...copyDir(path.join(templates, "codex", "skills"), path.join(home, ".claude", "skills"), { force })
  ];
  printResults("Claude ScrumRun installed", results);
}

function doctor() {
  const home = os.homedir();
  const checks = COMMANDS.map((command) => [
    command,
    path.join(home, ".claude", "commands", `${command}.md`)
  ]);
  checks.push(["scrumrun skill", path.join(home, ".claude", "skills", "scrumrun", "SKILL.md")]);

  let ok = true;
  for (const [label, file] of checks) {
    const exists = fs.existsSync(file);
    ok = ok && exists;
    console.log(`${exists ? "ok " : "miss"} ${label}`);
  }
  process.exitCode = ok ? 0 : 1;
}

const args = process.argv.slice(2);
const command = args[0];

if (!command || command === "--help" || command === "-h") {
  usage();
} else if (command === "install" || command === "update") {
  install(true);
} else if (command === "doctor") {
  doctor();
} else {
  console.error(`Unknown command: ${command}`);
  usage();
  process.exitCode = 1;
}
