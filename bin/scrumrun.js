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
  console.log(`ScrumRun

Usage:
  scrumrun install [all|codex|opencode|claude] [--force]
  scrumrun update  [all|codex|opencode|claude]
  scrumrun init [--local|--shared] [--no-agent-hint] [--force]
  scrumrun uninstall [--force]
  scrumrun migrate
  scrumrun doctor

Examples:
  npx github:leandercosta/scrumrun install
  npx github:leandercosta/scrumrun install claude
  npx github:leandercosta/scrumrun init
  npx github:leandercosta/scrumrun uninstall --force
  npx github:leandercosta/scrumrun init --shared
  npx github:leandercosta/scrumrun migrate
  npx github:leandercosta/scrumrun doctor
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
    const prefix = result.status === "skipped" ? "skip" : result.status;
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

function installClaude(force) {
  const home = os.homedir();
  const commandsDir = path.join(home, ".claude", "commands");
  cleanupLegacy(commandsDir, path.join(home, ".claude", "skills"));
  const results = [
    ...copyDir(path.join(templates, "codex", "prompts"), commandsDir, { force }),
    ...copyDir(path.join(templates, "codex", "skills"), path.join(home, ".claude", "skills"), { force })
  ];
  printResults("Installed claude", results);
}

function installOpenCode(force) {
  const home = os.homedir();
  const commandsDir = path.join(home, ".config", "opencode", "commands");
  cleanupLegacy(commandsDir, path.join(home, ".config", "opencode", "skills"));
  const results = [
    ...copyDir(path.join(templates, "opencode", "commands"), commandsDir, { force }),
    ...copyDir(path.join(templates, "opencode", "skills"), path.join(home, ".config", "opencode", "skills"), { force })
  ];
  printResults("Installed opencode", results);
}

function install(target, force) {
  if (target === "all") {
    installClaude(force);
    installOpenCode(force);
  } else if (target === "codex" || target === "claude") {
    installClaude(force);
  } else if (target === "opencode") {
    installOpenCode(force);
  }
}

function hasGitRepo(cwd) {
  return fs.existsSync(path.join(cwd, ".git"));
}

function addLocalExclude(cwd, pattern) {
  const excludeFile = path.join(cwd, ".git", "info", "exclude");
  if (!fs.existsSync(path.join(cwd, ".git"))) {
    return { status: "skipped", dest: `${pattern} (not a git repo)` };
  }
  ensureDir(path.dirname(excludeFile));
  const existing = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : "";
  const lines = existing.split(/\r?\n/).map((line) => line.trim());
  if (lines.includes(pattern)) {
    return { status: "skipped", dest: excludeFile };
  }
  const prefix = existing && !existing.endsWith("\n") ? "\n" : "";
  fs.appendFileSync(excludeFile, `${prefix}${pattern}\n`);
  return { status: "written", dest: `${excludeFile} (${pattern})` };
}

function removeLocalExclude(cwd, pattern) {
  const excludeFile = path.join(cwd, ".git", "info", "exclude");
  if (!fs.existsSync(excludeFile)) {
    return { status: "skipped", dest: `${pattern} (no .git/info/exclude)` };
  }
  const existing = fs.readFileSync(excludeFile, "utf8");
  const next = existing
    .split(/\r?\n/)
    .filter((line) => line.trim() !== pattern)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n");
  if (next === existing) {
    return { status: "skipped", dest: `${excludeFile} (${pattern})` };
  }
  fs.writeFileSync(excludeFile, next.endsWith("\n") || next === "" ? next : `${next}\n`);
  return { status: "removed", dest: `${excludeFile} (${pattern})` };
}

function looksLikeScrumRunAgents(file) {
  if (!fs.existsSync(file)) return false;
  const content = fs.readFileSync(file, "utf8");
  return content.includes("This project uses ScrumRun.")
    || content.includes("## ScrumRun")
    || content.includes(".scrumrun/golden-rules.md");
}

function removePathIfExists(target, { force = false, onlyIfScrumRunAgents = false } = {}) {
  if (!fs.existsSync(target)) return { status: "skipped", dest: target };
  if (!force) return { status: "skipped", dest: `${target} (use --force to remove)` };
  if (onlyIfScrumRunAgents && !looksLikeScrumRunAgents(target)) {
    return { status: "skipped", dest: `${target} (not recognized as ScrumRun-generated)` };
  }
  fs.rmSync(target, { recursive: true, force: true });
  return { status: "removed", dest: target };
}

function ensureBacklogFile(cwd) {
  const backlogFile = path.join(cwd, ".scrumrun", "backlog.md");
  if (!fs.existsSync(backlogFile)) {
    ensureDir(path.dirname(backlogFile));
    fs.writeFileSync(
      backlogFile,
      `# Sprint Backlog - ${path.basename(cwd)}\n\nBacklog items are sprint candidates. They are not active work until the user explicitly runs \`/run-sprint --run\`.\n\n## Items\n\n- Pending: none.\n`
    );
  }
  return backlogFile;
}

function initProject({ force, mode, agentHint }) {
  const cwd = process.cwd();
  const vars = {
    PROJECT_NAME: path.basename(cwd),
    DATE: new Date().toISOString().slice(0, 10)
  };
  const projectTemplate = path.join(templates, "project");
  const results = [];

  results.push(...copyDir(path.join(projectTemplate, ".scrumrun"), path.join(cwd, ".scrumrun"), { force, vars }));

  if (mode === "shared" || agentHint) {
    results.push(copyFile(path.join(projectTemplate, "AGENTS.md"), path.join(cwd, "AGENTS.md"), { force, vars }));
  } else {
    results.push({ status: "skipped", dest: path.join(cwd, "AGENTS.md") });
  }

  if (mode === "local") {
    results.push(addLocalExclude(cwd, ".scrumrun/"));
    if (agentHint) {
      results.push(addLocalExclude(cwd, "AGENTS.md"));
    }
  }

  const title = mode === "local"
    ? "Initialized local ScrumRun project"
    : "Initialized shared ScrumRun project";
  printResults(title, results);
  if (mode === "local" && hasGitRepo(cwd)) {
    console.log("\nLocal mode keeps ScrumRun out of commits by writing .scrumrun/ to .git/info/exclude.");
  }
}

function uninstallProject(force) {
  const cwd = process.cwd();
  const results = [
    removeLocalExclude(cwd, ".scrumrun/"),
    removeLocalExclude(cwd, "AGENTS.md"),
    removePathIfExists(path.join(cwd, ".scrumrun"), { force }),
    removePathIfExists(path.join(cwd, "AGENTS.md"), { force, onlyIfScrumRunAgents: true })
  ];

  printResults(force ? "Uninstalled ScrumRun project files" : "Prepared ScrumRun uninstall", results);
  if (!force) {
    console.log("\nRun `scrumrun uninstall --force` to remove .scrumrun/ and a ScrumRun-generated AGENTS.md.");
  }
}

function moveIfPossible(cwd, from, to) {
  const src = path.join(cwd, from);
  const dest = path.join(cwd, to);
  if (!fs.existsSync(src)) return { status: "missing", dest: src };
  if (fs.existsSync(dest)) return { status: "skipped", dest };
  ensureDir(path.dirname(dest));
  fs.renameSync(src, dest);
  return { status: "moved", dest: `${src} -> ${dest}` };
}

function migrateProject() {
  const cwd = process.cwd();
  const moves = [
    ["asm-config.md", ".scrumrun/config.md"],
    ["golden-rules.md", ".scrumrun/golden-rules.md"],
    ["map.md", ".scrumrun/map.md"],
    ["review-agents.md", ".scrumrun/agents.md"],
    ["ai-sprint-runbook.md", ".scrumrun/runbook.md"],
    ["sprint.md", ".scrumrun/goals/main/sprint.md"],
    ["history.md", ".scrumrun/goals/main/history.md"]
  ];
  ensureDir(path.join(cwd, ".scrumrun", "features"));
  ensureDir(path.join(cwd, ".scrumrun", "reviews"));
  ensureDir(path.join(cwd, ".scrumrun", "goals", "main"));
  const results = moves.map(([from, to]) => moveIfPossible(cwd, from, to));
  if (!fs.existsSync(path.join(cwd, ".scrumrun", "goals", "main", "decisions.md"))) {
    fs.writeFileSync(
      path.join(cwd, ".scrumrun", "goals", "main", "decisions.md"),
      "# Main Goal Decisions\n\n## Open Decisions\n\n- Pending: none.\n\n## Resolved Decisions\n\n- Pending: none.\n"
    );
    results.push({ status: "written", dest: path.join(cwd, ".scrumrun", "goals", "main", "decisions.md") });
  }
  if (!fs.existsSync(path.join(cwd, ".scrumrun", "project.md"))) {
    fs.writeFileSync(
      path.join(cwd, ".scrumrun", "project.md"),
      `# Project - ${path.basename(cwd)}\n\n## Purpose\n\nPending: review migrated ScrumRun files and update with /run-goal --new.\n\n## Active Lanes\n\n- Main goal: .scrumrun/goals/main/\n- Features: .scrumrun/features/\n`
    );
    results.push({ status: "written", dest: path.join(cwd, ".scrumrun", "project.md") });
  }
  if (!fs.existsSync(path.join(cwd, ".scrumrun", "backlog.md"))) {
    ensureBacklogFile(cwd);
    results.push({ status: "written", dest: path.join(cwd, ".scrumrun", "backlog.md") });
  }
  if (!fs.existsSync(path.join(cwd, ".scrumrun", "knowledge.md"))) {
    fs.writeFileSync(
      path.join(cwd, ".scrumrun", "knowledge.md"),
      `# Knowledge Base - ${path.basename(cwd)}\n\nOnly approved knowledge should be used as planning context for /run-challenge, /run-sprint --new, /run-sprint --run, and feature planning.\n\n## Approved Knowledge\n\n- Pending: none.\n\n## Pending Proposals\n\n- Pending: none.\n\n## Rejected Proposals\n\n- Pending: none.\n`
    );
    results.push({ status: "written", dest: path.join(cwd, ".scrumrun", "knowledge.md") });
  }
  printResults("Migrated project", results.filter((result) => result.status !== "missing"));
}

function doctor() {
  const home = os.homedir();
  const checks = [];

  for (const command of COMMANDS) {
    checks.push([`Claude command ${command}`, path.join(home, ".claude", "commands", `${command}.md`)]);
  }
  checks.push(["Claude skill scrumrun", path.join(home, ".claude", "skills", "scrumrun", "SKILL.md")]);

  for (const command of COMMANDS) {
    checks.push([`OpenCode command ${command}`, path.join(home, ".config", "opencode", "commands", `${command}.md`)]);
  }
  checks.push(["OpenCode skill scrumrun", path.join(home, ".config", "opencode", "skills", "scrumrun", "SKILL.md")]);

  let ok = true;
  for (const [label, file] of checks) {
    const exists = fs.existsSync(file);
    ok = ok && exists;
    console.log(`${exists ? "ok " : "miss"} ${label}: ${file}`);
  }
  process.exitCode = ok ? 0 : 1;
}

const args = process.argv.slice(2);
const command = args[0];
const force = args.includes("--force") || args.includes("-f");
const local = args.includes("--local") || args.includes("-l");
const shared = args.includes("--shared") || args.includes("-s");
const noAgentHint = args.includes("--no-agent-hint") || args.includes("-n");

if (!command || command === "--help" || command === "-h") {
  usage();
} else if (command === "install" || command === "update") {
  const target = ["all", "codex", "opencode", "claude"].includes(args[1]) ? args[1] : "all";
  install(target, true);
} else if (command === "init") {
  if (local && shared) {
    console.error("Use either --local or --shared, not both.");
    process.exitCode = 1;
  } else {
    initProject({ force, mode: shared ? "shared" : "local", agentHint: shared || !noAgentHint });
  }
} else if (command === "uninstall") {
  uninstallProject(force);
} else if (command === "migrate") {
  migrateProject();
} else if (command === "doctor") {
  doctor();
} else if (command === "claude") {
  const sub = args[1];
  if (sub === "install" || sub === "update") {
    installClaude(true);
  } else if (sub === "doctor") {
    doctor();
  } else {
    console.error("Usage: scrumrun claude [install|update|doctor]");
    process.exitCode = 1;
  }
} else if (command === "opencode") {
  const sub = args[1];
  if (sub === "install" || sub === "update") {
    installOpenCode(true);
  } else if (sub === "doctor") {
    doctor();
  } else {
    console.error("Usage: scrumrun opencode [install|update|doctor]");
    process.exitCode = 1;
  }
} else {
  console.error(`Unknown command: ${command}`);
  usage();
  process.exitCode = 1;
}
