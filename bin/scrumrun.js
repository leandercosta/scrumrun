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
  "run-vault",
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
  scrumrun status
  scrumrun commands
  scrumrun vault add <name> <value>
  scrumrun vault add <name:value>
  scrumrun vault list
  scrumrun vault show <V-NNN|name>
  scrumrun vault remove <V-NNN|name>
  scrumrun backlog add <sprint>
  scrumrun backlog list
  scrumrun know add <topic>
  scrumrun know list
  scrumrun know approve <K-NNN>
  scrumrun know reject <K-NNN> [reason]
  scrumrun know insight <K-NNN> <text>
  scrumrun know remove <K-NNN>
  scrumrun know resume [K-NNN]
  scrumrun prompt <study|challenge|know|vault|goal-new|sprint-new|sprint-run|backlog-add> [text]
  scrumrun uninstall [--force]
  scrumrun migrate
  scrumrun doctor

Examples:
  npx github:leandercosta/scrumrun install
  npx github:leandercosta/scrumrun install claude
  npx github:leandercosta/scrumrun init
  npx github:leandercosta/scrumrun status
  npx github:leandercosta/scrumrun vault add OPENAI_API_KEY sk-local-dev
  npx github:leandercosta/scrumrun backlog add "Sprint 01"
  npx github:leandercosta/scrumrun know add "Tenant permissions for report exports"
  npx github:leandercosta/scrumrun prompt challenge "Exports need tenant permission checks"
  npx github:leandercosta/scrumrun uninstall --force
  npx github:leandercosta/scrumrun init --shared
  npx github:leandercosta/scrumrun migrate
  npx github:leandercosta/scrumrun doctor
`);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function joinArgs(parts) {
  return parts.filter((part) => part && !part.startsWith("--")).join(" ").trim();
}

function joinText(parts) {
  return parts.filter(Boolean).join(" ").trim();
}

function stripQuotes(value) {
  return value.replace(/^["']|["']$/g, "");
}

function readIfExists(file) {
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
}

function writeFile(file, content) {
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, content.endsWith("\n") ? content : `${content}\n`);
}

function projectFile(...parts) {
  return path.join(process.cwd(), ".scrumrun", ...parts);
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

function ensureKnowledgeFile(cwd) {
  const knowledgeFile = path.join(cwd, ".scrumrun", "knowledge.md");
  if (!fs.existsSync(knowledgeFile)) {
    writeFile(
      knowledgeFile,
      `# Knowledge Base - ${path.basename(cwd)}\n\nOnly approved knowledge should be used as planning context for /run-challenge, /run-sprint --new, /run-sprint --run, and feature planning.\n\n## Approved Knowledge\n\n- Pending: none.\n\n## Pending Proposals\n\n- Pending: none.\n\n## Rejected Proposals\n\n- Pending: none.\n`
    );
  }
  return knowledgeFile;
}

function ensureVaultFile(cwd) {
  const vaultFile = path.join(cwd, ".scrumrun", "vault.local.md");
  if (!fs.existsSync(vaultFile)) {
    writeFile(
      vaultFile,
      `# Local Development Vault - ${path.basename(cwd)}\n\nThis file is for local development secrets only. It is plaintext, local-only, and must never be committed.\n\n## Entries\n\n- Pending: none.\n`
    );
  }
  return vaultFile;
}

function removePendingNone(content) {
  return content.replace(/^- Pending: none\.\n?/gm, "").replace(/\n{3,}/g, "\n\n");
}

function nextVaultId(content) {
  const ids = [...content.matchAll(/\bV-(\d{3})\b/g)].map((match) => Number(match[1]));
  const next = ids.length ? Math.max(...ids) + 1 : 1;
  return `V-${String(next).padStart(3, "0")}`;
}

function findVaultBlock(content, selector) {
  const escaped = (selector || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const byId = /^V-\d{3}$/.test(selector || "")
    ? new RegExp(`^### ${escaped}\\b[\\s\\S]*?(?=^### V-\\d{3}\\b|^## |(?![\\s\\S]))`, "m")
    : null;
  const byName = selector
    ? new RegExp(`^### V-\\d{3} - ${escaped}$[\\s\\S]*?(?=^### V-\\d{3}\\b|^## |(?![\\s\\S]))`, "m")
    : null;
  const match = (byId && content.match(byId)) || (byName && content.match(byName));
  return match ? match[0].trim() : "";
}

function removeVaultBlock(content, selector) {
  const block = findVaultBlock(content, selector);
  return block ? content.replace(block, "").replace(/\n{3,}/g, "\n\n") : content;
}

function parseVaultInput(parts) {
  const values = parts.filter((part) => part && !part.startsWith("--"));
  if (values.length === 1 && values[0].includes(":")) {
    const [name, ...rest] = values[0].split(":");
    return { name: name.trim(), value: rest.join(":").trim() };
  }
  if (values.length === 1 && values[0].includes("=")) {
    const [name, ...rest] = values[0].split("=");
    return { name: name.trim(), value: rest.join("=").trim() };
  }
  return { name: values[0] || "", value: values.slice(1).join(" ").trim() };
}

function addVaultEntry(parts) {
  const { name, value } = parseVaultInput(parts);
  if (!name || !value) {
    console.error("Usage: scrumrun vault add <name> <value> OR scrumrun vault add <name:value>");
    process.exitCode = 1;
    return;
  }
  const file = ensureVaultFile(process.cwd());
  const current = readIfExists(file);
  const id = nextVaultId(current);
  let next = removePendingNone(current);
  if (!next.endsWith("\n")) next += "\n";
  next += `### ${id} - ${name}\nCreated: ${today()}\nSource: CLI\nValue: ${value}\n\n`;
  writeFile(file, next);
  console.log(`Stored local vault entry: ${id} - ${name}`);
  console.log("Value hidden. Use `scrumrun vault show <id|name>` to reveal it locally.");
}

function listVaultEntries() {
  const file = ensureVaultFile(process.cwd());
  const content = readIfExists(file);
  const entries = [...content.matchAll(/^### (V-\d{3}) - (.+)$/gm)];
  if (!entries.length) {
    console.log("No local vault entries.");
    return;
  }
  for (const [, id, name] of entries) {
    console.log(`- ${id} | ${name} | value: ******`);
  }
}

function showVaultEntry(selector) {
  if (!selector) {
    console.error("Usage: scrumrun vault show <V-NNN|name>");
    process.exitCode = 1;
    return;
  }
  const file = ensureVaultFile(process.cwd());
  const block = findVaultBlock(readIfExists(file), selector);
  if (!block) {
    console.error(`Vault entry not found: ${selector}`);
    process.exitCode = 1;
    return;
  }
  console.log(block);
}

function removeVaultEntry(selector) {
  if (!selector) {
    console.error("Usage: scrumrun vault remove <V-NNN|name>");
    process.exitCode = 1;
    return;
  }
  const file = ensureVaultFile(process.cwd());
  const current = readIfExists(file);
  if (!findVaultBlock(current, selector)) {
    console.error(`Vault entry not found: ${selector}`);
    process.exitCode = 1;
    return;
  }
  writeFile(file, removeVaultBlock(current, selector));
  console.log(`Removed local vault entry: ${selector}`);
}

function runVault(parts) {
  const action = parts[0];
  if (!action || action === "list" || action === "--list" || action === "-l") {
    listVaultEntries();
  } else if (action === "add" || action === "--add" || action === "-a") {
    addVaultEntry(parts.slice(1));
  } else if (action === "show" || action === "--show" || action === "-s") {
    showVaultEntry(parts[1]);
  } else if (action === "remove" || action === "delete" || action === "--remove" || action === "-r") {
    removeVaultEntry(parts[1]);
  } else if (action === "path") {
    console.log(ensureVaultFile(process.cwd()));
  } else if (parts.includes("--add") || parts.includes("-a")) {
    addVaultEntry(parts);
  } else {
    showVaultEntry(action);
  }
}

function addBacklogItem(label) {
  if (!label) {
    console.error("Usage: scrumrun backlog add <sprint number or name>");
    process.exitCode = 1;
    return;
  }
  const file = ensureBacklogFile(process.cwd());
  const current = readIfExists(file);
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`^- \\[[ xX]\\] .*${escaped}(?: |$)`, "m").test(current)) {
    console.log(`Already in backlog: ${label}`);
    return;
  }
  let next = removePendingNone(current);
  if (!next.endsWith("\n")) next += "\n";
  next += `- [ ] ${label} - added ${today()}. Source: CLI.\n`;
  writeFile(file, next);
  console.log(`Added to backlog: ${label}`);
}

function listBacklog(filter = "") {
  const file = ensureBacklogFile(process.cwd());
  const content = readIfExists(file);
  if (!filter) {
    console.log(content);
    return;
  }
  const lines = content.split(/\r?\n/).filter((line) => line.toLowerCase().includes(filter.toLowerCase()));
  console.log(lines.length ? lines.join("\n") : `No backlog items matched: ${filter}`);
}

function sectionRegex(section) {
  return new RegExp(`(^## ${section}\\n)([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m");
}

function replaceSection(content, section, body) {
  const regex = sectionRegex(section);
  const cleanBody = body.trim() ? `${body.trim()}\n\n` : "- Pending: none.\n\n";
  if (regex.test(content)) {
    return content.replace(regex, `$1\n${cleanBody}`);
  }
  return `${content.trim()}\n\n## ${section}\n\n${cleanBody}`;
}

function getSection(content, section) {
  const match = content.match(sectionRegex(section));
  return match ? match[2].trim() : "";
}

function nextKnowledgeId(content) {
  const ids = [...content.matchAll(/\bK-(\d{3})\b/g)].map((match) => Number(match[1]));
  const next = ids.length ? Math.max(...ids) + 1 : 1;
  return `K-${String(next).padStart(3, "0")}`;
}

function findKnowledgeBlock(content, id) {
  const regex = new RegExp(`^### ${id}\\b[\\s\\S]*?(?=^### K-\\d{3}\\b|^## |(?![\\s\\S]))`, "m");
  const match = content.match(regex);
  return match ? match[0].trim() : "";
}

function removeKnowledgeBlock(content, id) {
  const regex = new RegExp(`\\n?^### ${id}\\b[\\s\\S]*?(?=^### K-\\d{3}\\b|^## |(?![\\s\\S]))`, "m");
  return content.replace(regex, "\n").replace(/\n{3,}/g, "\n\n");
}

function updateKnowledgeStatus(block, status, extra = "") {
  const lines = block.split(/\r?\n/);
  const next = lines.map((line) => line.startsWith("Status: ") ? `Status: ${status}` : line);
  if (!lines.some((line) => line.startsWith("Status: "))) {
    next.splice(1, 0, `Status: ${status}`);
  }
  if (extra) {
    next.push("", extra);
  }
  return next.join("\n").trim();
}

function addKnowledge(topic) {
  if (!topic) {
    console.error("Usage: scrumrun know add <topic>");
    process.exitCode = 1;
    return;
  }
  const file = ensureKnowledgeFile(process.cwd());
  const current = readIfExists(file);
  const id = nextKnowledgeId(current);
  const block = `### ${id} - ${stripQuotes(topic)}\nStatus: pending\nDate: ${today()}\nSource: CLI\nApprover: pending\n\n#### User Insight\n\n${stripQuotes(topic)}\n\n#### Verified Facts\n\n- Pending: requires agent verification with /run-know.\n\n#### Assumptions and Uncertainty\n\n- This entry was created from CLI input and has not been verified by an agent.\n\n#### Risks If Wrong\n\n- Future sprint planning could be based on an incorrect assumption if approved without review.\n\n#### Affected Modules\n\n- Pending: unknown.\n\n#### Suggested Future Use\n\n- Use as context only after approval.\n`;
  const pending = getSection(current, "Pending Proposals");
  const nextPending = `${pending.replace(/^- Pending: none\.\n?/gm, "").trim()}\n\n${block}`.trim();
  writeFile(file, replaceSection(current, "Pending Proposals", nextPending));
  console.log(`Created pending knowledge: ${id}`);
  console.log(`Approve later with: scrumrun know approve ${id}`);
}

function moveKnowledge(id, targetSection, status, reason = "") {
  if (!/^K-\d{3}$/.test(id || "")) {
    console.error(`Invalid knowledge id: ${id || "(missing)"}`);
    process.exitCode = 1;
    return;
  }
  const file = ensureKnowledgeFile(process.cwd());
  const current = readIfExists(file);
  const block = findKnowledgeBlock(current, id);
  if (!block) {
    console.error(`Knowledge entry not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  let next = removeKnowledgeBlock(current, id);
  const extra = status === "approved"
    ? `Approved: ${today()}`
    : reason ? `Rejected: ${today()}\nReason: ${reason}` : `Rejected: ${today()}`;
  const moved = updateKnowledgeStatus(block, status, extra);
  const target = getSection(next, targetSection).replace(/^- Pending: none\.\n?/gm, "").trim();
  next = replaceSection(next, targetSection, `${target}\n\n${moved}`.trim());
  writeFile(file, next);
  console.log(`${status === "approved" ? "Approved" : "Rejected"} knowledge: ${id}`);
}

function removeKnowledge(id) {
  const file = ensureKnowledgeFile(process.cwd());
  const current = readIfExists(file);
  if (!findKnowledgeBlock(current, id)) {
    console.error(`Knowledge entry not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  writeFile(file, removeKnowledgeBlock(current, id));
  console.log(`Removed knowledge: ${id}`);
}

function addKnowledgeInsight(id, text) {
  if (!text) {
    console.error("Usage: scrumrun know insight <K-NNN> <text>");
    process.exitCode = 1;
    return;
  }
  const file = ensureKnowledgeFile(process.cwd());
  const current = readIfExists(file);
  const block = findKnowledgeBlock(current, id);
  if (!block) {
    console.error(`Knowledge entry not found: ${id}`);
    process.exitCode = 1;
    return;
  }
  const insight = `- ${today()}: ${text}`;
  const updated = block.includes("#### Insights")
    ? block.replace(/(#### Insights\n\n)/, `$1${insight}\n`)
    : `${block}\n\n#### Insights\n\n${insight}`;
  writeFile(file, current.replace(block, updated));
  console.log(`Added insight to ${id}`);
}

function listKnowledge(id = "") {
  const file = ensureKnowledgeFile(process.cwd());
  const content = readIfExists(file);
  if (id) {
    const block = findKnowledgeBlock(content, id);
    console.log(block || `Knowledge entry not found: ${id}`);
    return;
  }
  console.log(content);
}

function resumeKnowledge(id = "") {
  const file = ensureKnowledgeFile(process.cwd());
  const content = readIfExists(file);
  const source = id ? findKnowledgeBlock(content, id) : content;
  if (!source) {
    console.log(`Knowledge entry not found: ${id}`);
    return;
  }
  const entries = [...source.matchAll(/^### (K-\d{3}) - (.+)$/gm)];
  if (!entries.length) {
    console.log(source);
    return;
  }
  for (const [, entryId, title] of entries) {
    const block = findKnowledgeBlock(content, entryId);
    const status = (block.match(/^Status: (.+)$/m) || [])[1] || "unknown";
    const fact = (block.match(/#### Verified Facts\n\n([\s\S]*?)(?=\n#### |$)/) || [])[1] || "";
    console.log(`- ${entryId} | ${status} | ${title}`);
    console.log(`  ${fact.trim().split(/\r?\n/)[0] || "No verified fact summary."}`);
  }
}

function runKnow(parts) {
  const action = parts[0];
  if (!action || action === "list" || action === "--list" || action === "-l") {
    listKnowledge(parts[1]);
  } else if (action === "add" || action === "--add" || action === "-a") {
    addKnowledge(joinArgs(parts.slice(1)));
  } else if (action === "approve") {
    moveKnowledge(parts[1], "Approved Knowledge", "approved");
  } else if (action === "reject") {
    moveKnowledge(parts[1], "Rejected Proposals", "rejected", joinArgs(parts.slice(2)));
  } else if (action === "remove" || action === "delete" || action === "--remove" || action === "-r") {
    removeKnowledge(parts[1]);
  } else if (action === "insight" || action === "--insight" || action === "-i") {
    addKnowledgeInsight(parts[1], joinArgs(parts.slice(2)));
  } else if (action === "resume" || action === "--resume" || action === "-s") {
    resumeKnowledge(parts[1]);
  } else if (/^K-\d{3}$/.test(action) && (parts[1] === "resume" || parts[1] === "--resume" || parts[1] === "-s")) {
    resumeKnowledge(action);
  } else {
    addKnowledge(joinArgs(parts));
  }
}

function runBacklog(parts) {
  const action = parts[0];
  if (!action || action === "list" || action === "--list" || action === "-l") {
    listBacklog(joinArgs(parts.slice(1)));
  } else if (action === "add" || action === "--add" || action === "-a") {
    addBacklogItem(joinArgs(parts.slice(1)));
  } else {
    addBacklogItem(joinArgs(parts));
  }
}

function commandList() {
  console.log(`Slash commands installed by ScrumRun:

Project:
  /run-help
  /run-init
  /run-uninstall
  /run-update
  /run-study
  /run-challenge

Knowledge and planning:
  /run-vault
  /run-know
  /run-goal
  /run-feature
  /run-sprint
  /run-backlog

Project controls:
  /run-config
  /run-golden
  /run-map
  /run-agent
  /run-review
  /run-decisions

CLI helpers:
  scrumrun status
  scrumrun commands
  scrumrun vault add "NAME" "local-dev-value"
  scrumrun backlog add "Sprint 01"
  scrumrun know add "Topic"
  scrumrun prompt challenge "..."
`);
}

function countMatches(content, regex) {
  return (content.match(regex) || []).length;
}

function sprintStatusCounts(history) {
  return {
    completed: countMatches(history, /Status:\s*completed\.?/gi),
    partial: countMatches(history, /Status:\s*partial\.?/gi),
    blocked: countMatches(history, /Status:\s*blocked\.?/gi)
  };
}

function statusProject() {
  const cwd = process.cwd();
  const scrumDir = path.join(cwd, ".scrumrun");
  const required = [
    "config.md",
    "golden-rules.md",
    "map.md",
    "agents.md",
    "runbook.md",
    "project.md",
    "backlog.md",
    "knowledge.md",
    path.join("goals", "main", "sprint.md"),
    path.join("goals", "main", "history.md"),
    path.join("goals", "main", "decisions.md")
  ];
  console.log(`# ScrumRun Status - ${path.basename(cwd)}`);
  console.log("");
  console.log(`Project files: ${fs.existsSync(scrumDir) ? "present" : "missing"}`);
  console.log(`AGENTS.md: ${fs.existsSync(path.join(cwd, "AGENTS.md")) ? "present" : "missing"}`);
  if (hasGitRepo(cwd)) {
    const exclude = readIfExists(path.join(cwd, ".git", "info", "exclude"));
    console.log(`Local git exclude: ${exclude.includes(".scrumrun/") ? ".scrumrun/ ignored" : ".scrumrun/ not ignored"}`);
  }
  console.log("");
  console.log("## Files");
  for (const file of required) {
    const full = path.join(scrumDir, file);
    console.log(`- ${fs.existsSync(full) ? "ok" : "missing"} ${path.join(".scrumrun", file)}`);
  }
  const backlog = readIfExists(projectFile("backlog.md"));
  const knowledge = readIfExists(projectFile("knowledge.md"));
  const sprint = readIfExists(projectFile("goals", "main", "sprint.md"));
  const history = readIfExists(projectFile("goals", "main", "history.md"));
  const counts = sprintStatusCounts(history);
  const vaultFile = projectFile("vault.local.md");
  console.log("");
  console.log("## Counts");
  console.log(`- Backlog candidates: ${countMatches(backlog, /^- \[[ xX]\] /gm)}`);
  console.log(`- Knowledge approved: ${countMatches(getSection(knowledge, "Approved Knowledge"), /^### K-\d{3}/gm)}`);
  console.log(`- Knowledge pending: ${countMatches(getSection(knowledge, "Pending Proposals"), /^### K-\d{3}/gm)}`);
  console.log(`- Knowledge rejected: ${countMatches(getSection(knowledge, "Rejected Proposals"), /^### K-\d{3}/gm)}`);
  console.log(`- Vault entries: ${countMatches(readIfExists(vaultFile), /^### V-\d{3}/gm)} (${fs.existsSync(vaultFile) ? "local vault present" : "local vault not created"})`);
  console.log(`- Planned sprints: ${countMatches(sprint, /^##+ .*Sprint/gi)}`);
  console.log(`- Completed: ${counts.completed}`);
  console.log(`- Partial: ${counts.partial}`);
  console.log(`- Blocked: ${counts.blocked}`);
}

function promptCommand(parts) {
  const kind = parts[0];
  const text = joinText(parts.slice(1));
  const prompts = {
    study: `/run-study${text ? ` ${text}` : ""}`,
    challenge: `/run-challenge ${text}`.trim(),
    know: `/run-know ${text}`.trim(),
    vault: `/run-vault ${text}`.trim(),
    "goal-new": `/run-goal --new ${text}`.trim(),
    goal: `/run-goal --new ${text}`.trim(),
    "sprint-new": `/run-sprint --new ${text}`.trim(),
    "sprint-run": `/run-sprint --run ${text}`.trim(),
    "backlog-add": `/run-backlog --add ${text}`.trim(),
    backlog: `/run-backlog --add ${text}`.trim(),
    status: `/run-sprint --status${text ? ` ${text}` : ""}`
  };
  if (!kind || !prompts[kind]) {
    console.error("Usage: scrumrun prompt <study|challenge|know|vault|goal-new|sprint-new|sprint-run|backlog-add|status> [text]");
    process.exitCode = 1;
    return;
  }
  console.log(prompts[kind]);
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
  results.push(addLocalExclude(cwd, ".scrumrun/vault.local.md"));

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
    removeLocalExclude(cwd, ".scrumrun/vault.local.md"),
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
} else if (command === "status") {
  statusProject();
} else if (command === "commands") {
  commandList();
} else if (command === "vault") {
  runVault(args.slice(1));
} else if (command === "backlog" || command === "backlog-add" || command === "backlog-list") {
  if (command === "backlog-add") {
    runBacklog(["add", ...args.slice(1)]);
  } else if (command === "backlog-list") {
    runBacklog(["list", ...args.slice(1)]);
  } else {
    runBacklog(args.slice(1));
  }
} else if (command === "know") {
  runKnow(args.slice(1));
} else if (command === "prompt") {
  promptCommand(args.slice(1));
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
