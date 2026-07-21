#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");

const root = path.resolve(__dirname, "..");
const templates = path.join(root, "templates");
const { version } = require(path.join(root, "package.json"));
const { applyMigration, dryRunMigration, rollbackMigration } = require(path.join(root, "lib", "v2", "migration"));
const { ARTIFACT_TYPES, ArtifactRepository } = require(path.join(root, "lib", "v2", "artifacts"));
const { aliases: COMMAND_ALIASES, resolveAlias, resolveRoute } = require(path.join(root, "lib", "commands", "manifest"));
const { renderCommandHelp, renderCompatibilityPrompt, renderRootPrompt } = require(path.join(root, "lib", "commands", "render"));
const { planRequest } = require(path.join(root, "lib", "runtime", "request-engine"));
const { approveRequest, refreshState, retryTask, transitionRun } = require(path.join(root, "lib", "runtime", "orchestrator"));
const { createMemory, listMemory, showMemory, transitionMemory } = require(path.join(root, "lib", "memory", "service"));
const { indexPath, indexStatus, queryIndex, rebuildIndex, writeMap } = require(path.join(root, "lib", "memory", "index"));
const { auditProject } = require(path.join(root, "lib", "v2", "conformance"));
const { containsSecret } = require(path.join(root, "lib", "security", "secrets"));

const COMMANDS = ["sc"];
const COMPATIBILITY_COMMANDS = Object.keys(COMMAND_ALIASES);
const MANAGED_COMMANDS = [...new Set(["sc", "sc-plan", "sc-knowledge", "sc-rules", ...COMPATIBILITY_COMMANDS])];

function usage() {
  console.log(`ScrumRun

Usage:
  scrumrun --version
  scrumrun sc
  scrumrun sc <noun> <subject> <action> [args]
  scrumrun install [all|codex|opencode|claude] [--force]
  scrumrun update  [all|codex|opencode|claude] [--migrate]
  scrumrun init [--local|--shared] [--lean] [--no-agent-hint] [--force]
  scrumrun status
  scrumrun core [--path|--prompt]
  scrumrun commands
  scrumrun migrate --to 2 --dry-run
  scrumrun migrate --to 2 --apply
  scrumrun migrate --to 2 --rollback
  scrumrun doctor [all|codex|opencode|claude] [--strict]
  scrumrun uninstall [--force]

Examples:
  npx scrumrun@latest install
  npx scrumrun@latest sc knowledge decision --list
  npx scrumrun@latest init
  npx scrumrun@latest status
  npx scrumrun@latest migrate --to 2 --dry-run
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

function writeFile(file, content, { backup = false } = {}) {
  ensureDir(path.dirname(file));
  const normalized = content.endsWith("\n") ? content : `${content}\n`;
  const current = readIfExists(file);
  if (current === normalized) return { changed: false, backup: null };

  let backupFile = null;
  if (backup && current) {
    const scrumDir = path.join(process.cwd(), ".scrumrun");
    const relative = path.relative(scrumDir, file);
    const safeName = relative.replace(/[^a-zA-Z0-9._-]+/g, "__");
    const digest = crypto.createHash("sha256").update(current).digest("hex").slice(0, 16);
    backupFile = path.join(scrumDir, ".backup", `${safeName}.${digest}.bak`);
    if (!fs.existsSync(backupFile)) {
      ensureDir(path.dirname(backupFile));
      fs.writeFileSync(backupFile, current);
    }
  }

  const tempFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`
  );
  try {
    fs.writeFileSync(tempFile, normalized);
    fs.renameSync(tempFile, file);
  } catch (error) {
    if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    throw error;
  }
  return { changed: true, backup: backupFile };
}

function projectFile(...parts) {
  return path.join(process.cwd(), ".scrumrun", ...parts);
}

function ensureInteractionPreferences(cwd) {
  const configFile = path.join(cwd, ".scrumrun", "config.md");
  if (!fs.existsSync(configFile)) return null;

  let content = fs.readFileSync(configFile, "utf8").trimEnd();
  const defaults = [
    ["Interaction Mode:", "Interaction Mode: guided"],
    ["Execution Approval:", "Execution Approval: always"],
    ["Quick Tasks:", "Quick Tasks: ask"]
  ];
  const added = defaults.filter(([prefix]) => !content.split("\n").some((line) => line.trim().startsWith(prefix)));
  if (!added.length) return null;

  const section = content.includes("\n## Intake") ? "\n" : "\n\n## Intake\n\n";
  content += `${section}${added.map(([, line]) => line).join("\n")}\n`;
  fs.writeFileSync(configFile, content);
  return { status: "updated", dest: configFile };
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
      const legacyPrefix = name.startsWith("srun-") || name.startsWith("asm-") || name.startsWith("sr-") || name.startsWith("scr-") || name.startsWith("src-") || name.startsWith("run-");
      const oldConsolidated = /^scr-[a-z]+-[a-z]+\.md$/.test(name);
      const managed = MANAGED_COMMANDS.some((command) => name === `${command}.md`);
      if (legacyPrefix || oldConsolidated || managed) {
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

function writeCommandAsset(destination, content, force) {
  if (fs.existsSync(destination) && !force) return { status: "skipped", dest: destination };
  ensureDir(path.dirname(destination));
  fs.writeFileSync(destination, content);
  return { status: "written", dest: destination };
}

function installClient(label, commandsDir, skillsDir, skillTemplateDir, force, { compatibility = false } = {}) {
  cleanupLegacy(commandsDir, skillsDir);
  const results = [
    writeCommandAsset(path.join(commandsDir, "sc.md"), renderRootPrompt(), force),
    ...copyDir(skillTemplateDir, skillsDir, { force })
  ];
  if (compatibility) {
    for (const alias of COMPATIBILITY_COMMANDS) {
      results.push(writeCommandAsset(path.join(commandsDir, `${alias}.md`), renderCompatibilityPrompt(alias), force));
    }
  }
  printResults(`Installed ${label}`, results);
  console.log(compatibility
    ? "  compatibility adapters installed for this v1 upgrade cycle"
    : "  canonical surface: /sc only");
}

function installClaude(force, options = {}) {
  const home = os.homedir();
  installClient(
    "claude",
    path.join(home, ".claude", "commands"),
    path.join(home, ".claude", "skills"),
    path.join(templates, "shared", "skills"),
    force,
    options
  );
}

function installCodex(force, options = {}) {
  const home = os.homedir();
  installClient(
    "codex",
    path.join(home, ".codex", "prompts"),
    path.join(home, ".codex", "skills"),
    path.join(templates, "shared", "skills"),
    force,
    options
  );
}

function installOpenCode(force, options = {}) {
  const home = os.homedir();
  installClient(
    "opencode",
    path.join(home, ".config", "opencode", "commands"),
    path.join(home, ".config", "opencode", "skills"),
    path.join(templates, "shared", "skills"),
    force,
    options
  );
}

function install(target, force, options = {}) {
  if (target === "all") {
    installCodex(force, options);
    installClaude(force, options);
    installOpenCode(force, options);
  } else if (target === "codex") {
    installCodex(force, options);
  } else if (target === "claude") {
    installClaude(force, options);
  } else if (target === "opencode") {
    installOpenCode(force, options);
  }
}

function migrationPreflightOnUpdate({ apply = false } = {}) {
  const scrumDir = path.join(process.cwd(), ".scrumrun");
  if (!fs.existsSync(scrumDir)) return { status: "not-a-project" };
  const marker = path.join(scrumDir, "method.json");
  if (fs.existsSync(marker)) {
    try {
      if (JSON.parse(fs.readFileSync(marker, "utf8")).method === "2.0.0") return { status: "already-v2" };
    } catch {
      console.error("Project migration preflight failed: .scrumrun/method.json is malformed.");
      process.exitCode = 1;
      return { status: "blocked" };
    }
  }
  try {
    const preview = dryRunMigration(process.cwd());
    console.log("\n## Project migration preflight\n");
    console.log(preview.output.trimEnd());
    if (preview.status === "blocked") {
      for (const error of preview.plan.errors) console.error(`BLOCKED: ${error}`);
      process.exitCode = 1;
      return { status: "blocked" };
    }
    if (!apply) {
      console.log("\nThe project remains unchanged. Apply the verified plan with: npx scrumrun@latest update --migrate");
      return { status: "ready" };
    }
    const result = applyMigration(process.cwd(), { plan: preview.plan });
    console.log("\nApplied the verified ScrumRun v1 → v2 project migration.");
    console.log(`Source fingerprint: ${result.manifest.sourceInventory.rootSha256}`);
    console.log("Rollback remains available with: npx scrumrun@latest migrate --to 2 --rollback");
    return { status: "applied", result };
  } catch (error) {
    console.error(`Project migration preflight failed: ${error.message}`);
    process.exitCode = 1;
    return { status: "blocked" };
  }
}

function updateInstallation(target, { migrate = false } = {}) {
  const migration = migrationPreflightOnUpdate({ apply: migrate });
  install(target, true, { compatibility: true });
  return migration;
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

function ensureProjectIgnore(cwd) {
  const file = path.join(cwd, ".scrumrun", ".gitignore");
  if (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink()) {
    throw new Error("Refusing to write a symbolic .scrumrun/.gitignore.");
  }
  const current = readIfExists(file);
  const lines = current.split(/\r?\n/).filter(Boolean);
  for (const pattern of [".cache/", ".backup/", ".migration/", "vault.local.md"]) {
    if (!lines.includes(pattern)) lines.push(pattern);
  }
  const next = `${lines.join("\n")}\n`;
  if (next === current) return { status: "skipped", dest: file };
  writeFile(file, next);
  return { status: "written", dest: file };
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
      `# Sprint Backlog - ${path.basename(cwd)}\n\nBacklog items are sprint candidates. They are not active work until the user explicitly runs \`/sc-sprint --run\`.\n\n## Items\n\n- Pending: none.\n`
    );
  }
  return backlogFile;
}

function ensureKnowledgeFile(cwd) {
  const knowledgeFile = path.join(cwd, ".scrumrun", "knowledge.md");
  if (!fs.existsSync(knowledgeFile)) {
    writeFile(
      knowledgeFile,
      `# Knowledge Base - ${path.basename(cwd)}\n\nOnly approved knowledge should be used as planning context for /sc-challenge, /sc-sprint --add, /sc-sprint --run, and feature planning.\n\n## Approved Knowledge\n\n- Pending: none.\n\n## Pending Proposals\n\n- Pending: none.\n\n## Rejected Proposals\n\n- Pending: none.\n`
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

function contextTemplate(cwd, { stale = false, reason = "CLI" } = {}) {
  const name = path.basename(cwd);
  const status = stale ? "stale - rebuild required" : "cli placeholder - agent verification required";
  return `# ScrumRun Context Snapshot - ${name}

This file is a token-safe snapshot. It helps agents decide what to read next, but it is not a source of truth.

Canonical sources remain \`golden-rules.md\`, \`config.md\`, \`project.md\`, \`knowledge.md\`, \`runbook.md\`, sprint/feature plans, history, decisions, and source code.

Last updated: ${today()}
Updated by: ${reason}
Confidence: ${status}

## Current Focus

- Main goal: pending.
- Active sprint: pending.
- Active feature lane: none.
- Current challenge: none.

## Must Read For Current Work

- \`AGENTS.md\`
- \`.scrumrun/core.md\`
- \`.scrumrun/golden-rules.md\`
- \`.scrumrun/config.md\`
- \`.scrumrun/token-policy.md\`
- \`.scrumrun/map.md\`
- \`.scrumrun/project.md\`
- \`.scrumrun/knowledge.md\`
- \`.scrumrun/runbook.md\`

## Read Only If Needed

- Full historical reviews under \`.scrumrun/reviews/\`
- Full old sprint history unrelated to the current lane
- Large generated files, build outputs, dependency folders, and logs

## Current Decisions

- Pending: none.

## Current Risks

- Do not treat this snapshot as canonical truth.
- Do not use pending knowledge as approved planning truth.
- Never print or copy \`.scrumrun/vault.local.md\` values.

## Current Map Pointers

- Pending: run \`/sc-map --build\` or \`/sc-context --build\`.

## Staleness Triggers

Refresh this snapshot after:

- \`/sc-study\`
- \`/sc-goal --set\`
- \`/sc-feature --add\`
- \`/sc-sprint --add\`
- \`/sc-sprint --run\`
- \`/sc-sprint --fix\`
- \`/sc-review --code\`
- major changes to \`knowledge.md\`, \`project.md\`, \`map.md\`, \`history.md\`, or \`decisions.md\`
`;
}

function ensureContextFile(cwd) {
  const contextFile = path.join(cwd, ".scrumrun", "context.md");
  if (!fs.existsSync(contextFile)) {
    writeFile(contextFile, contextTemplate(cwd));
  }
  return contextFile;
}

function ensureTokenPolicyFile(cwd) {
  const policyFile = path.join(cwd, ".scrumrun", "token-policy.md");
  if (!fs.existsSync(policyFile)) {
    writeFile(
      policyFile,
      `# ScrumRun Token Policy - ${path.basename(cwd)}

This policy reduces token waste without weakening ScrumRun safety.

## Rules

1. Safety beats token economy. Never skip core, golden rules, config, or relevant history to save tokens.
2. Context is a snapshot, not truth. Use it to choose what to read, then verify against canonical files.
3. Prefer targeted reads over broad dumps.
4. Do not read or print vault values unless explicitly required for a local development credential workflow.
5. If uncertainty affects correctness or safety, read the source even if it costs more tokens.
`
    );
  }
  return policyFile;
}

function renderGuardrails(cwd) {
  const name = path.basename(cwd);
  const golden = readIfExists(path.join(cwd, ".scrumrun", "golden-rules.md")).trim();
  const config = readIfExists(path.join(cwd, ".scrumrun", "config.md")).trim();
  const tokenPolicy = readIfExists(path.join(cwd, ".scrumrun", "token-policy.md")).trim();
  const knowledge = readIfExists(path.join(cwd, ".scrumrun", "knowledge.md"));
  const approvedMatch = knowledge.match(/## Approved Knowledge\n+([\s\S]*?)(?=\n## |$)/);
  const approved = approvedMatch ? approvedMatch[1].trim() : "";
  const approvedEntries = approved
    .split(/(?=^### K-\d{3})/m)
    .map((s) => s.trim())
    .filter((s) => s.startsWith("### K-"));

  const goldenSection = golden
    ? golden.replace(/^# ScrumRun Golden Rules.*\n/m, "").trim()
    : "Pending: add rules with `/sc-rules golden --add <rule>`.";
  const configSection = config
    ? config
        .split("\n")
        .filter((line) => line.match(/^[A-Z][\w -]*:/))
        .map((line) => `- ${line}`)
        .join("\n") || "Pending: configure with `/sc-config config --lang|--interaction|--approval|--quick-tasks`."
    : "Pending: configure with `/sc-config config --lang|--interaction|--approval|--quick-tasks`.";
  const tokenSection = tokenPolicy
    ? tokenPolicy.replace(/^# ScrumRun Token Policy.*\n/m, "").trim()
    : "Pending: token policy not initialized.";
  const approvedSection = approvedEntries.length
    ? approvedEntries.map((entry) => {
        const id = (entry.match(/^### (K-\d{3})/) || [])[1];
        const title = (entry.match(/^### K-\d{3} - (.+)$/m) || [])[1] || "untitled";
        const fact = (entry.match(/#### Verified Facts\n+([\s\S]*?)(?=\n#### |$)/m) || [])[1];
        const oneLine = fact ? fact.trim().split(/\r?\n/)[0].replace(/^[-*]\s*/, "") : "no verified fact summary";
        return `- **${id}** — ${title}: ${oneLine}`;
      }).join("\n")
    : "Pending: add with `/sc-knowledge know --add <topic>`, then `--approve <K-NNN>`.";

  return `# ScrumRun Guardrails - ${name}

Single-file view of rules, invariants, and configuration. Generated by \`scrumrun guardrails --build\`. The source files listed under \`Sources\` are canonical; this file is a pre-digested snapshot for token economy.

Last built: ${today()}
Built by: CLI

## Precedence

When guidance conflicts, apply in this strict order (SPEC §5):

1. Golden rules (active)
2. Open decisions linked to current work
3. Approved knowledge facts
4. Current sprint / feature plan
5. Backlog priority
6. Map and dossiers
7. \`state.md\` (never authoritative)

Higher precedence always wins. Lower precedence never silently overrides.

## Golden Rules

${goldenSection}

## Active Invariants

Numbered for stable reference. Full list in \`SPEC.md\` §6.

- **I-01** No sprint moves from \`proposed\` to \`running\` without explicit owner approval.
- **I-02** No code changes outside a \`running\` sprint, \`running\` fix, or explicitly authorized quick task.
- **I-03** Active golden rule cannot be bypassed; retirement is the only path.
- **I-04** Intake is read-only.
- **I-05** Main goal history and feature lane history are physically separate.
- **I-06** Approval is synchronous and explicit; ambiguous acknowledgements are not approval.
- **I-07** Every state transition writes exactly one history entry. History is append-only.
- **I-08** Golden rules are checked before planning/execution; a fire moves a running sprint to \`blocked\`.
- **I-09** \`state.md\` and \`context.md\` are never authoritative.
- **I-10** Only \`approved\` knowledge informs planning.
- **I-11** Vault values never appear in history, knowledge, backlog, reviews, commits, or logs.
- **I-12** Every artifact carries \`id\`, \`kind\`, \`status\`, \`created\`, \`updated\`, \`method\` frontmatter.
- **I-13** Dossier updates record the source commit hash for drift detection.
- **I-14** Quick tasks may execute with \`Quick Tasks: allow\`, never bypassing golden rules.
- **I-15** Rejected knowledge is preserved in \`rejected\` state to prevent re-proposing.

## Configuration

${configSection}

## Token Policy

${tokenSection}

## Approved Knowledge

${approvedSection}

## Sources

- Golden rules: \`.scrumrun/golden-rules.md\`
- Config: \`.scrumrun/config.md\`
- Token policy: \`.scrumrun/token-policy.md\`
- Knowledge: \`.scrumrun/knowledge.md\` (Approved section only)
- State: \`.scrumrun/state.md\`
`;
}

function renderState(cwd) {
  const name = path.basename(cwd);
  const project = readIfExists(path.join(cwd, ".scrumrun", "project.md")).trim();
  const sprint = readIfExists(path.join(cwd, ".scrumrun", "goals", "main", "sprint.md"));
  const history = readIfExists(path.join(cwd, ".scrumrun", "goals", "main", "history.md"));
  const decisions = readIfExists(path.join(cwd, ".scrumrun", "goals", "main", "decisions.md"));
  const backlog = readIfExists(path.join(cwd, ".scrumrun", "backlog.md")).trim();

  const projectSection = project
    ? project.replace(/^# .*\n/m, "").trim()
    : "Pending: set with `/sc-plan goal --set <goal>`.";
  const goalSection = sprint
    ? sprint.split("\n").slice(0, 8).join("\n").trim() || "Pending: define with `/sc-plan goal --set <goal>`."
    : "Pending: define with `/sc-plan goal --set <goal>`.";
  const historyEntries = [
    ...[...history.matchAll(/^## (\d{4}-\d{2}-\d{2}[^\n]* · [^\n]+)$/gm)].map((m) => ({ index: m.index, label: m[1] })),
    ...[...history.matchAll(/^### ([^\n]+)\n(?:(?!^### |^## )[\s\S])*?^Status:\s*[a-z]+/gim)].map((m) => ({ index: m.index, label: m[1] }))
  ].sort((a, b) => a.index - b.index);
  const recentHistory = historyEntries
    .slice(-5)
    .reverse()
    .map((entry) => `- ${entry.label}`)
    .join("\n") || "- None.";
  const parsedDecisions = parseDecisions(cwd);
  const openList = parsedDecisions.open.length
    ? parsedDecisions.open
        .map((decision) => `- ${decision.id ? `${decision.id} — ` : ""}${decision.title}`)
        .join("\n")
    : "- None.";
  const backlogSection = backlog && backlog.includes("- [")
    ? backlog
        .split("\n")
        .filter((line) => line.match(/^- \[[ xX]\]/))
        .map((line) => `- ${line.replace(/^- \[[ xX]\]\s*/, "")}`)
        .join("\n") || "- None."
    : "- None.";

  return `# ScrumRun State - ${name}

Single-file view of project state. Generated by \`scrumrun guardrails --build\`. The source files listed under \`Sources\` are canonical; this file is a pre-digested snapshot for token economy.

Last built: ${today()}
Built by: CLI

## Project

${projectSection}

## Main Goal

${goalSection}

## Active Sprint

- Pending: confirm with /sc-plan sprint --status.

## Open Decisions

${openList}

## Backlog

${backlogSection}

## Recent History

${recentHistory}

## Sources

- Project: \`.scrumrun/project.md\`
- Sprint: \`.scrumrun/goals/main/sprint.md\`
- History: \`.scrumrun/goals/main/history.md\`
- Decisions: \`.scrumrun/goals/main/decisions.md\`
- Backlog: \`.scrumrun/backlog.md\`
- Knowledge: \`.scrumrun/knowledge.md\`
`;
}

function runGuardrails(parts) {
  const cwd = process.cwd();
  const action = parts[0];
  if (!action || action === "build" || action === "--build" || action === "-b") {
    const guardrailsFile = path.join(cwd, ".scrumrun", "guardrails.md");
    const stateFile = path.join(cwd, ".scrumrun", "state.md");
    if (!fs.existsSync(path.join(cwd, ".scrumrun"))) {
      console.error("Not a ScrumRun project. Run `scrumrun init` first.");
      process.exitCode = 1;
      return;
    }
    const existingGuardrails = readIfExists(guardrailsFile);
    const canonicalGuardrails = /^# ScrumRun Project Guardrails\b/m.test(existingGuardrails);
    if (!canonicalGuardrails) writeFile(guardrailsFile, renderGuardrails(cwd));
    writeFile(stateFile, renderState(cwd));
    if (canonicalGuardrails) {
      console.log(`Preserved canonical ${path.relative(cwd, guardrailsFile)} and built ${path.relative(cwd, stateFile)}.`);
    } else {
      console.log(`Built ${path.relative(cwd, guardrailsFile)} and ${path.relative(cwd, stateFile)}.`);
      console.log("Sources remain canonical. Re-run after edits to golden-rules, config, knowledge, or sprint/history.");
    }
  } else if (action === "show" || action === "--show" || action === "-s") {
    const file = path.join(cwd, ".scrumrun", "guardrails.md");
    console.log(readIfExists(file) || "guardrails.md not built. Run `scrumrun guardrails --build`.");
  } else {
    console.error("Usage: scrumrun guardrails [--build|--show]");
    process.exitCode = 1;
  }
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
  if (containsSecret(label)) {
    console.error("Secret-like content is forbidden outside the local vault.");
    process.exitCode = 1;
    return;
  }
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
  if (containsSecret(topic)) {
    console.error("Secret-like content is forbidden outside the local vault.");
    process.exitCode = 1;
    return;
  }
  const file = ensureKnowledgeFile(process.cwd());
  const current = readIfExists(file);
  const id = nextKnowledgeId(current);
  const block = `### ${id} - ${stripQuotes(topic)}\nStatus: pending\nDate: ${today()}\nSource: CLI\nApprover: pending\n\n#### User Insight\n\n${stripQuotes(topic)}\n\n#### Verified Facts\n\n- Pending: requires agent verification with /sc-know.\n\n#### Assumptions and Uncertainty\n\n- This entry was created from CLI input and has not been verified by an agent.\n\n#### Risks If Wrong\n\n- Future sprint planning could be based on an incorrect assumption if approved without review.\n\n#### Affected Modules\n\n- Pending: unknown.\n\n#### Suggested Future Use\n\n- Use as context only after approval.\n`;
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
  console.log(`${renderCommandHelp()}

CLI helpers:
  scrumrun status
  scrumrun commands
  scrumrun sc knowledge decision --list
  scrumrun vault add "NAME" "local-dev-value"
  scrumrun context show
  scrumrun backlog add "Sprint 01"
  scrumrun know add "Topic"
  scrumrun prompt challenge "..."
  scrumrun core
`);
}

function printRouteHelp(route) {
  if (route.level === "root") {
    commandList();
  } else if (route.level === "noun") {
    console.log(`# /sc ${route.noun}`);
    console.log(route.spec.description);
    for (const [subject, actions] of Object.entries(route.spec.subjects)) {
      console.log(`- ${subject}: ${actions.join(", ")}`);
    }
  } else {
    console.log(`# /sc ${route.noun} ${route.subject}`);
    console.log(route.actions.join("\n"));
  }
}

function agentWorkflowRequired(noun, subject, args) {
  const suffix = args.length ? ` ${args.join(" ")}` : "";
  console.log(`Agent workflow: /sc ${noun} ${subject}${suffix}`);
  console.log("Run this through an installed ScrumRun AI client; the CLI parser validated the route but this workflow requires repository reasoning.");
}

function v2Project(cwd = process.cwd()) {
  const marker = path.join(cwd, ".scrumrun", "method.json");
  if (!fs.existsSync(marker)) return false;
  try {
    return JSON.parse(fs.readFileSync(marker, "utf8")).method === "2.0.0";
  } catch {
    return false;
  }
}

function optionValues(args, flag) {
  const values = [];
  for (let index = 0; index < args.length; index++) {
    if (args[index] === flag && args[index + 1] && !args[index + 1].startsWith("--")) values.push(args[index + 1]);
  }
  return values;
}

function optionValue(args, flag, fallback = null) {
  const values = optionValues(args, flag);
  return values.length ? values[values.length - 1] : fallback;
}

function positionalValues(args, start = 1) {
  const values = [];
  const valued = new Set(["--title", "--content", "--evidence", "--relation", "--subject", "--source", "--source-id", "--confidence", "--valid-from", "--valid-until", "--review-trigger", "--note", "--limit"]);
  for (let index = start; index < args.length; index++) {
    if (valued.has(args[index])) {
      index++;
      continue;
    }
    if (!args[index].startsWith("--")) values.push(args[index]);
  }
  return values;
}

function memoryOptions(args) {
  const positional = positionalValues(args).join(" ").trim();
  const subject = optionValue(args, "--subject");
  const separator = subject ? subject.indexOf(":") : -1;
  return {
    title: optionValue(args, "--title") || positional,
    content: optionValue(args, "--content") || positional || optionValue(args, "--title"),
    evidence: optionValues(args, "--evidence"),
    relations: optionValues(args, "--relation"),
    subjectType: separator > 0 ? subject.slice(0, separator) : null,
    subjectId: separator > 0 ? subject.slice(separator + 1) : subject,
    sourceType: optionValue(args, "--source", "human"),
    sourceId: optionValue(args, "--source-id"),
    confidence: optionValue(args, "--confidence"),
    validFrom: optionValue(args, "--valid-from"),
    validUntil: optionValue(args, "--valid-until"),
    reviewTrigger: optionValue(args, "--review-trigger")
  };
}

function printMemoryArtifact(artifact) {
  if (!artifact) return false;
  console.log(readIfExists(artifact.file));
  return true;
}

function runV2Memory(subject, args) {
  const kind = subject === "fact" ? "knowledge" : subject;
  const action = args[0];
  const createAction = kind === "insight" ? "--propose" : "--add";
  if (action === createAction) {
    const artifact = createMemory(process.cwd(), kind, memoryOptions(args));
    console.log(`Created ${artifact.record.status} ${artifact.record.id}: ${path.relative(process.cwd(), artifact.file)}`);
    return;
  }
  if (action === "--list") {
    const artifacts = listMemory(process.cwd(), kind, { includeInactive: args.includes("--include-inactive") });
    console.log(artifacts.length
      ? artifacts.map((artifact) => `${artifact.record.id} | ${artifact.record.status} | ${((artifact.body || "").match(/^# ([^\r\n]+)/m) || [])[1] || artifact.record.id}`).join("\n")
      : `No ${kind} artifacts.`);
    return;
  }
  if (action === "--show") {
    if (!printMemoryArtifact(showMemory(process.cwd(), kind, args[1]))) {
      console.error(`${kind} not found: ${args[1]}`);
      process.exitCode = 1;
    }
    return;
  }
  const actionMap = {
    "--approve": "approve",
    "--reject": "reject",
    "--invalidate": "invalidate",
    "--resolve": "resolve",
    "--confirm": "confirm",
    "--refresh": "refresh",
    "--archive": "archive",
    "--stale": "stale",
    "--deprecate": "deprecate"
  };
  if (actionMap[action]) {
    const artifact = transitionMemory(process.cwd(), kind, args[1], actionMap[action], {
      evidence: optionValues(args.slice(2), "--evidence"),
      note: optionValue(args.slice(2), "--note")
    });
    console.log(`${artifact.record.id}: ${artifact.record.status}.`);
    return;
  }
  throw new Error(`Unsupported ${kind} command: ${action || "missing action"}`);
}

function runSemanticContext(subject, args) {
  const action = args[0];
  if (subject === "study") {
    const result = queryIndex(process.cwd(), args.join(" "));
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (subject === "map") {
    if (action === "--build") {
      const built = rebuildIndex(process.cwd());
      const map = writeMap(process.cwd());
      console.log(`Built ${path.relative(process.cwd(), built.file)} and ${path.relative(process.cwd(), map.file)}: ${map.nodes} nodes, ${map.edges} edges.`);
      return;
    }
    const mapFile = path.join(process.cwd(), ".scrumrun", "map.md");
    if (!fs.existsSync(mapFile)) throw new Error("Generated map.md is missing; run /sc knowledge map --build.");
    const status = indexStatus(process.cwd());
    if (status.stale) console.warn("WARNING: map.md is stale; rebuild it before relying on the view.");
    console.log(fs.readFileSync(mapFile, "utf8"));
    return;
  }
  if (action === "--build" || action === "--update") {
    const built = rebuildIndex(process.cwd());
    console.log(`Built ${path.relative(process.cwd(), built.file)} from ${built.artifacts} canonical artifacts.`);
    return;
  }
  if (action === "--clear") {
    const file = indexPath(process.cwd());
    if (fs.existsSync(file)) fs.rmSync(file, { force: true });
    console.log("Cleared the disposable semantic index; canonical Markdown was not changed.");
    return;
  }
  if (action === "--show") {
    const query = args.slice(1).join(" ").trim();
    console.log(JSON.stringify(query ? queryIndex(process.cwd(), query) : indexStatus(process.cwd()), null, 2));
    return;
  }
  throw new Error(`Unsupported knowledge ${subject} command: ${action || "missing action"}`);
}

function executeRootRoute(route) {
  const { noun, subject, args: routeArgs } = route;
  if (noun === "plan" && subject === "intake") {
    if (routeArgs[0] === "--approve") {
      const result = approveRequest(process.cwd(), routeArgs[1]);
      console.log(`${result.status === "already-approved" ? "Already approved" : "Approved"}: ${result.task.id} → ${result.run.id}`);
      return;
    }
    const request = routeArgs[0] === "--request" ? routeArgs.slice(1).join(" ") : routeArgs.join(" ");
    const plan = planRequest(process.cwd(), request);
    console.log(`# ScrumRun Intake`);
    console.log(`State: ${plan.state}`);
    console.log(`Classification: ${plan.classification.type} (${plan.classification.reason})`);
    console.log(`Risk: ${plan.risk.level} — ${plan.risk.reasons.join("; ")}`);
    console.log(`Policy: ${plan.policy.status}`);
    for (const violation of plan.policy.violations) console.log(`BLOCKED: ${violation}`);
    for (const warning of plan.context.warnings) console.log(`WARNING: ${warning}`);
    if (plan.approvalToken) {
      console.log(`Approval: scrumrun sc plan intake --approve ${plan.approvalToken}`);
    }
    return;
  }
  if (noun === "plan" && subject === "task" && routeArgs[0] === "--retry") {
    const result = retryTask(process.cwd(), routeArgs[1]);
    console.log(`Created retry ${result.run.id} for ${result.task.id} (attempt ${result.run.attempt}).`);
    return;
  }
  if (noun === "plan" && ["task", "run"].includes(subject) && ["--list", "--show"].includes(routeArgs[0])) {
    const repository = new ArtifactRepository(projectFile());
    if (routeArgs[0] === "--list") {
      const artifacts = repository.list(subject).map((artifact) => `${artifact.record.id} | ${artifact.record.status} | ${((artifact.body || "").match(/^# ([^\r\n]+)/m) || [])[1] || artifact.record.id}`);
      console.log(artifacts.length ? artifacts.join("\n") : `No ${subject} artifacts.`);
    } else {
      const artifact = repository.read(subject, routeArgs[1]);
      if (!artifact) {
        console.error(`${subject} not found: ${routeArgs[1]}`);
        process.exitCode = 1;
      } else {
        console.log(readIfExists(artifact.file));
      }
    }
    return;
  }
  if (noun === "plan" && subject === "run") {
    const transitions = {
      "--validate": "validating",
      "--learn": "learning",
      "--complete": "completed",
      "--resume": "executing",
      "--fail": "failed",
      "--block": "blocked"
    };
    if (transitions[routeArgs[0]]) {
      const result = transitionRun(process.cwd(), routeArgs[1], transitions[routeArgs[0]], { note: routeArgs.slice(2).join(" ") || null });
      console.log(`${result.run.id}: ${result.run.status}; ${result.task.id}: ${result.task.status}.`);
      if (result.learning) {
        if (result.learning.created.length) console.log(`Learning candidates: ${result.learning.created.join(", ")}.`);
        for (const warning of result.learning.warnings) console.warn(`WARNING: ${warning}`);
      }
      return;
    }
  }
  if (noun === "knowledge" && ["fact", "decision", "insight", "dossier"].includes(subject) && v2Project()) return runV2Memory(subject, routeArgs);
  if (noun === "knowledge" && ["context", "map", "study"].includes(subject) && v2Project()) return runSemanticContext(subject, routeArgs);
  if (noun === "knowledge" && subject === "decision") return runDecisions(routeArgs);
  if (noun === "knowledge" && subject === "fact") return runKnow(routeArgs);
  if (noun === "knowledge" && subject === "vault") return runVault(routeArgs);
  if (noun === "knowledge" && subject === "context") return runContext(routeArgs);
  if (noun === "review" && subject === "artifact" && routeArgs[0] === "--run") {
    const audit = auditProject(process.cwd());
    console.log(JSON.stringify(audit, null, 2));
    if (!audit.passed) process.exitCode = 1;
    return;
  }
  if (noun === "config" && subject === "migrate") return runMigration(routeArgs);
  if (noun === "config" && subject === "doctor") {
    const target = ["all", "codex", "opencode", "claude"].includes(routeArgs[0]) ? routeArgs[0] : "all";
    return doctor(target);
  }
  if (noun === "config" && subject === "update") {
    const target = ["all", "codex", "opencode", "claude"].includes(routeArgs[0]) ? routeArgs[0] : "all";
    return updateInstallation(target, { migrate: routeArgs.includes("--migrate") });
  }
  if (noun === "config" && subject === "init") {
    const localMode = routeArgs.includes("--local");
    const sharedMode = routeArgs.includes("--shared");
    if (localMode && sharedMode) {
      console.error("Use either --local or --shared, not both.");
      process.exitCode = 1;
      return;
    }
    return initProject({
      force: routeArgs.includes("--force"),
      mode: sharedMode ? "shared" : "local",
      agentHint: sharedMode || !routeArgs.includes("--no-agent-hint"),
      lean: routeArgs.includes("--lean")
    });
  }
  if (noun === "config" && subject === "uninstall") return uninstallProject(routeArgs.includes("--force"));
  if (noun === "config" && subject === "help") return commandList();
  if (noun === "config" && subject === "project" && routeArgs[0] === "--show") {
    console.log(readIfExists(projectFile("config.md")) || "Project config is missing.");
    return;
  }
  agentWorkflowRequired(noun, subject, routeArgs);
}

function runRoot(parts) {
  const route = resolveRoute(parts);
  if (route.type === "help") return printRouteHelp(route);
  if (route.type === "error") {
    console.error(route.message);
    process.exitCode = 1;
    return;
  }
  return executeRootRoute(route);
}

function runCompatibilityAlias(alias, parts) {
  const route = resolveAlias(alias, parts);
  console.warn(`Deprecated: ${alias} now executes /sc ${route.noun} ${route.subject}.`);
  if (route.note) console.warn(route.note);
  if (alias === "sc-backlog") return runBacklog(parts);
  return executeRootRoute({ type: "route", noun: route.noun, subject: route.subject, args: route.args });
}

function printCore({ pathOnly = false, promptOnly = false } = {}) {
  const coreFile = path.join(root, "CORE.md");
  if (pathOnly) {
    console.log(coreFile);
    return;
  }
  if (promptOnly) {
    console.log(`Read AGENTS.md, .scrumrun/guardrails.md, and .scrumrun/state.md first.
Follow ScrumRun 2.0 and load only the canonical ids/evidence relevant to the request.
If /sc is unavailable, execute the equivalent /sc <noun> <subject> <action> workflow from .scrumrun/core.md manually.
Keep intake read-only; do not create a Task or Run until explicit approval.`);
    return;
  }
  console.log(readIfExists(coreFile));
}

function runContext(parts) {
  const action = parts[0];
  const cwd = process.cwd();
  if (!action || action === "show" || action === "--show" || action === "-s") {
    console.log(readIfExists(ensureContextFile(cwd)));
  } else if (action === "build" || action === "--build" || action === "-b") {
    ensureTokenPolicyFile(cwd);
    writeFile(projectFile("context.md"), contextTemplate(cwd, { reason: "CLI build" }));
    console.log("Built .scrumrun/context.md placeholder.");
    console.log("For a verified snapshot, run `/sc-context --build` in your AI client.");
  } else if (action === "update" || action === "--update" || action === "-u") {
    const reason = joinArgs(parts.slice(1)) || "CLI update";
    const file = ensureContextFile(cwd);
    const current = readIfExists(file);
    const note = `\n## CLI Update Note - ${today()}\n\n- Reason: ${reason}\n- This note is not verified project truth. Run \`/sc-context --update ${reason}\` for an agent-verified snapshot update.\n`;
    writeFile(file, `${current.trim()}\n${note}`);
    console.log("Added context update note to .scrumrun/context.md.");
  } else if (action === "clear" || action === "--clear" || action === "-c") {
    writeFile(projectFile("context.md"), contextTemplate(cwd, { stale: true, reason: "CLI clear" }));
    console.log("Reset .scrumrun/context.md to a stale placeholder.");
  } else if (action === "policy" || action === "--policy" || action === "-p") {
    console.log(readIfExists(ensureTokenPolicyFile(cwd)));
  } else if (action === "path") {
    console.log(ensureContextFile(cwd));
  } else {
    console.error("Usage: scrumrun context [build|update|show|clear|policy|path]");
    process.exitCode = 1;
  }
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

function decisionsFile(cwd) {
  return path.join(cwd, ".scrumrun", "goals", "main", "decisions.md");
}

function extractFieldBody(body, label) {
  const re = new RegExp(`^${label}\\s*\\n([\\s\\S]*?)(?=^\\w[\\w ]*:|^### |^## |$)`, "m");
  const m = body.match(re);
  return m ? m[1] : "";
}

function parseListField(text) {
  if (!text) return [];
  return text
    .split(/\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function markdownSection(content, title) {
  const heading = new RegExp(`^## ${escapeRegExp(title)}[ \\t]*$`, "m");
  const match = heading.exec(content);
  if (!match) return null;
  const bodyStart = match.index + match[0].length;
  const tail = content.slice(bodyStart);
  const next = /^## [^\n]+$/m.exec(tail);
  const end = next ? bodyStart + next.index : content.length;
  return {
    headingStart: match.index,
    bodyStart,
    end,
    body: content.slice(bodyStart, end)
  };
}

function decisionBlocks(section) {
  const headings = [...section.body.matchAll(/^### (D-\d{3}) - ([^\r\n]+)[ \t]*$/gm)];
  return headings.map((heading, index) => {
    const localStart = heading.index;
    const localEnd = index + 1 < headings.length ? headings[index + 1].index : section.body.length;
    const rawWithSpacing = section.body.slice(localStart, localEnd);
    const raw = rawWithSpacing.trimEnd();
    return {
      id: heading[1],
      title: heading[2].trim(),
      body: raw.slice(heading[0].length),
      raw,
      start: section.bodyStart + localStart,
      end: section.bodyStart + localStart + raw.length,
      maskStart: localStart,
      maskEnd: localEnd
    };
  });
}

function parseDecisionsContent(content, file = null) {
  const result = { open: [], resolved: [], file };
  for (const [title, target] of [["Open Decisions", "open"], ["Resolved Decisions", "resolved"]]) {
    const section = markdownSection(content, title);
    if (!section) continue;
    const blocks = decisionBlocks(section);
    for (const block of blocks) {
      const { id, title: decisionTitle, body } = block;
      const statusMatch = body.match(/^Status:\s*(.+)$/m);
      const dateMatch = body.match(/^Date:\s*(.+)$/m);
      const sourceMatch = body.match(/^Source:\s*(.+)$/m);
      const extendsMatch = body.match(/^Extends:\s*(D-\d{3})/m);
      const supersedesMatch = body.match(/^Supersedes:\s*(D-\d{3})/m);
      const validWhileText = extractFieldBody(body, "Valid while:");
      const reviewWhenText = extractFieldBody(body, "Review when:");
      const expiredMatch = body.match(/^Expired:\s*(.+)$/m);
      result[target].push({
        id,
        title: decisionTitle,
        status: (statusMatch ? statusMatch[1].trim() : "open").toLowerCase(),
        date: dateMatch ? dateMatch[1].trim() : null,
        source: sourceMatch ? sourceMatch[1].trim() : null,
        extendsId: extendsMatch ? extendsMatch[1] : null,
        supersedesId: supersedesMatch ? supersedesMatch[1] : null,
        validWhile: parseListField(validWhileText),
        reviewWhen: parseListField(reviewWhenText),
        expired: expiredMatch ? expiredMatch[1].trim() : null,
        raw: block.raw,
        start: block.start,
        end: block.end
      });
    }

    const withoutStructuredBlocks = [...section.body];
    for (const block of blocks) {
      for (let i = block.maskStart; i < block.maskEnd; i++) {
        if (withoutStructuredBlocks[i] !== "\n" && withoutStructuredBlocks[i] !== "\r") {
          withoutStructuredBlocks[i] = " ";
        }
      }
    }
    const bullets = [...withoutStructuredBlocks.join("").matchAll(/^- (.+)$/gm)]
      .map((match) => match[1].trim())
      .filter((text) => text !== "Pending: none.");
    for (const bullet of bullets) {
      result[target].push({
        id: null,
        title: bullet,
        status: target === "resolved" ? "resolved" : "open",
        date: null,
        source: null,
        extendsId: null,
        supersedesId: null,
        validWhile: [],
        reviewWhen: [],
        expired: null,
        raw: null,
        start: null,
        end: null
      });
    }
  }
  return result;
}

function parseDecisions(cwd) {
  const file = decisionsFile(cwd);
  return parseDecisionsContent(readIfExists(file), file);
}

function nextDecisionId(cwd) {
  const { open, resolved } = parseDecisions(cwd);
  const all = [...open, ...resolved];
  const max = all.reduce((acc, d) => {
    if (!d.id) return acc;
    const n = Number(d.id.slice(2));
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `D-${String(max + 1).padStart(3, "0")}`;
}

function tokenize(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3);
}

function decisionSimilarity(a, b) {
  const aTokens = new Set(tokenize(a));
  const bTokens = new Set(tokenize(b));
  if (!aTokens.size || !bTokens.size) return 0;
  let inter = 0;
  for (const t of aTokens) if (bTokens.has(t)) inter++;
  const union = new Set([...aTokens, ...bTokens]).size;
  return union ? inter / union : 0;
}

function findSimilarDecisions(text, decisions, { threshold = 0.3, limit = 5 } = {}) {
  const matches = [];
  for (const list of [decisions.open, decisions.resolved]) {
    for (const d of list) {
      const score = decisionSimilarity(text, d.title);
      if (score >= threshold) {
        matches.push({ ...d, score });
      }
    }
  }
  matches.sort((a, b) => b.score - a.score);
  return matches.slice(0, limit);
}

function serializeDecision(d) {
  const lines = [`### ${d.id} - ${d.title}`, `Status: ${d.status}`];
  if (d.date) lines.push(`Date: ${d.date}`);
  if (d.source) lines.push(`Source: ${d.source}`);
  if (d.extendsId) lines.push(`Extends: ${d.extendsId}`);
  if (d.supersedesId) lines.push(`Supersedes: ${d.supersedesId}`);
  if (d.validWhile && d.validWhile.length) {
    lines.push("Valid while:", ...d.validWhile.map((v) => `- ${v}`));
  }
  if (d.reviewWhen && d.reviewWhen.length) {
    lines.push("Review when:", ...d.reviewWhen.map((v) => `- ${v}`));
  }
  if (d.expired) lines.push(`Expired: ${d.expired}`);
  return lines.join("\n");
}

function decisionDocument(content) {
  if (content.trim()) return content;
  return "# Main Goal Decisions\n\n## Open Decisions\n\n- Pending: none.\n\n## Resolved Decisions\n\n- Pending: none.\n";
}

function prependDecisionBlock(content, sectionTitle, block) {
  const section = markdownSection(content, sectionTitle);
  if (!section) {
    return `${content.trimEnd()}\n\n## ${sectionTitle}\n\n${block.trim()}\n`;
  }
  const withoutPlaceholder = section.body.replace(/^[ \t]*- Pending: none\.[ \t]*(?:\r?\n)?/m, "");
  const remainder = withoutPlaceholder.replace(/^(?:\r?\n)+/, "");
  const body = `\n\n${block.trim()}\n${remainder.trim() ? `\n${remainder}` : ""}`;
  return `${content.slice(0, section.bodyStart)}${body}${content.slice(section.end)}`;
}

function ensureDecisionSectionPlaceholder(content, sectionTitle) {
  const section = markdownSection(content, sectionTitle);
  if (!section || section.body.trim()) return content;
  return `${content.slice(0, section.bodyStart)}\n\n- Pending: none.\n\n${content.slice(section.end)}`;
}

function updateDecisionStatus(block, status) {
  if (/^Status:\s*.+$/m.test(block)) {
    return block.replace(/^Status:\s*.+$/m, `Status: ${status}`);
  }
  const newline = block.indexOf("\n");
  if (newline === -1) return `${block}\nStatus: ${status}`;
  return `${block.slice(0, newline + 1)}Status: ${status}\n${block.slice(newline + 1)}`;
}

function appendDecisionHistory(cwd, id) {
  const file = path.join(cwd, ".scrumrun", "goals", "main", "history.md");
  const marker = `${id} · open-to-resolved`;
  const current = readIfExists(file) || "# Main Goal History\n";
  if (current.includes(marker)) return;
  const event = `## ${today()} · ${marker}\n\nOwner: ScrumRun CLI\nReason: Decision resolved through \`scrumrun decisions --resolve\`.\nStatus: completed.\n`;
  writeFile(file, `${current.trimEnd()}\n\n${event}`, { backup: true });
}

function addDecision(cwd, title, { date = today(), source = null, validWhile = [], reviewWhen = [], extendsId = null, supersedesId = null } = {}) {
  if (containsSecret([title, source, ...validWhile, ...reviewWhen].filter(Boolean).join("\n"))) {
    throw new Error("Secret-like content is forbidden outside the local vault.");
  }
  const file = decisionsFile(cwd);
  const id = nextDecisionId(cwd);
  const block = serializeDecision({
    id,
    title: title.trim(),
    status: "open",
    date,
    source,
    extendsId,
    supersedesId,
    validWhile,
    reviewWhen,
    expired: null
  });
  const current = decisionDocument(readIfExists(file));
  const next = prependDecisionBlock(current, "Open Decisions", block);
  const parsed = parseDecisionsContent(next, file);
  if (parsed.open.filter((decision) => decision.id === id).length !== 1) {
    throw new Error(`Decision write validation failed for ${id}.`);
  }
  writeFile(file, next, { backup: true });
  return id;
}

function resolveDecision(cwd, id) {
  const file = decisionsFile(cwd);
  const current = readIfExists(file);
  const decisions = parseDecisionsContent(current, file);
  const moved = decisions.open.find((decision) => decision.id === id && decision.raw);
  if (!moved) return false;

  let next = `${current.slice(0, moved.start)}${current.slice(moved.end)}`;
  next = ensureDecisionSectionPlaceholder(next, "Open Decisions");
  next = prependDecisionBlock(next, "Resolved Decisions", updateDecisionStatus(moved.raw, "resolved"));

  const parsed = parseDecisionsContent(next, file);
  const stillOpen = parsed.open.some((decision) => decision.id === id);
  const resolvedCount = parsed.resolved.filter((decision) => decision.id === id).length;
  if (stillOpen || resolvedCount !== 1) {
    throw new Error(`Decision transition validation failed for ${id}.`);
  }
  writeFile(file, next, { backup: true });
  appendDecisionHistory(cwd, id);
  return true;
}

function runDecisions(parts) {
  const cwd = process.cwd();
  const action = parts[0];

  if (!action || action === "list" || action === "--list" || action === "-l") {
    const decisions = parseDecisions(cwd);
    const format = (d) => `${d.id || "no-id"} | ${d.status} | ${d.title}${d.expired ? ` (expired: ${d.expired})` : ""}`;
    console.log("# Open");
    console.log(decisions.open.length ? decisions.open.map(format).join("\n") : "  - none");
    console.log("\n# Resolved");
    console.log(decisions.resolved.length ? decisions.resolved.map(format).join("\n") : "  - none");
    return;
  }

  if (action === "similar" || action === "--similar" || action === "-s") {
    const text = joinArgs(parts.slice(1));
    if (!text) {
      console.error("Usage: scrumrun decisions --similar <text>");
      process.exitCode = 1;
      return;
    }
    const decisions = parseDecisions(cwd);
    const matches = findSimilarDecisions(text, decisions);
    if (!matches.length) {
      console.log("No similar decisions found.");
      return;
    }
    for (const m of matches) {
      const pct = Math.round(m.score * 100);
      const valid = m.expired ? `expired (${m.expired})` : m.status;
      console.log(`${m.id || "no-id"} | ${valid} | ${pct}% similar | ${m.title}`);
    }
    return;
  }

  if (action === "add" || action === "--add" || action === "-a") {
    const sourceIdx = parts.findIndex((p) => p === "--source" || p === "-s");
    const source = sourceIdx > 0 ? parts[sourceIdx + 1] : null;
    const title = joinArgs(parts.slice(1).filter((p, i, arr) => {
      if (p === "--source" || p === "-s") return false;
      if (i > 0 && (arr[i - 1] === "--source" || arr[i - 1] === "-s")) return false;
      return true;
    }));
    if (!title) {
      console.error("Usage: scrumrun decisions --add <title> [--source <ref>]");
      process.exitCode = 1;
      return;
    }
    const decisions = parseDecisions(cwd);
    const similar = findSimilarDecisions(title, decisions);
    const id = addDecision(cwd, title, source ? { source } : {});
    console.log(`Added decision: ${id}`);
    if (similar.length) {
      console.log("\nSimilar decisions found — review before relying on this new one:");
      for (const m of similar) {
        const pct = Math.round(m.score * 100);
        console.log(`  ${m.id || "no-id"} | ${m.status} | ${pct}% similar | ${m.title}`);
      }
      console.log("\nIf the new decision reuses an existing one, edit and add Extends: D-NNN.");
      console.log("If it supersedes, add Supersedes: D-NNN.");
      console.log("If it's genuinely new, ignore this list.");
    }
    return;
  }

  if (action === "resolve" || action === "--resolve" || action === "-r") {
    const id = parts[1];
    if (!id) {
      console.error("Usage: scrumrun decisions --resolve <D-NNN>");
      process.exitCode = 1;
      return;
    }
    if (resolveDecision(cwd, id)) {
      console.log(`Resolved decision: ${id}`);
    } else {
      console.error(`Open decision not found: ${id}`);
      process.exitCode = 1;
    }
    return;
  }

  if (action === "check" || action === "--check" || action === "-c") {
    const id = parts[1];
    if (!id) {
      console.error("Usage: scrumrun decisions --check <D-NNN>");
      process.exitCode = 1;
      return;
    }
    const decisions = parseDecisions(cwd);
    const all = [...decisions.open, ...decisions.resolved];
    const d = all.find((x) => x.id === id);
    if (!d) {
      console.error(`Decision not found: ${id}`);
      process.exitCode = 1;
      return;
    }
    console.log(`# ${d.id} - ${d.title}`);
    console.log(`Status: ${d.status}${d.expired ? ` (expired: ${d.expired})` : ""}`);
    if (d.date) console.log(`Date: ${d.date}`);
    if (d.source) console.log(`Source: ${d.source}`);
    if (d.extendsId) console.log(`Extends: ${d.extendsId}`);
    if (d.supersedesId) console.log(`Supersedes: ${d.supersedesId}`);
    if (d.validWhile.length) {
      console.log(`\nValid while:`);
      for (const v of d.validWhile) console.log(`  - ${v}`);
    }
    if (d.reviewWhen.length) {
      console.log(`\nReview when:`);
      for (const v of d.reviewWhen) console.log(`  - ${v}`);
    }
    if (d.expired) {
      console.log(`\nThis decision is marked as expired. Review and either:`);
      console.log(`  - Add Extends: D-NNN to a new decision that supersedes it, or`);
      console.log(`  - Edit and remove the Expired line if it is still valid.`);
    }
    return;
  }

  console.error("Usage: scrumrun decisions [--list|--similar|--add|--resolve|--check]");
  process.exitCode = 1;
}

function statusProject() {
  const cwd = process.cwd();
  const scrumDir = path.join(cwd, ".scrumrun");
  const methodMarker = readIfExists(path.join(scrumDir, "method.json"));
  let method = null;
  try {
    method = methodMarker ? JSON.parse(methodMarker).method : null;
  } catch {
    method = "invalid";
  }
  if (method === "2.0.0") {
    const repository = new ArtifactRepository(scrumDir);
    console.log(`# ScrumRun Status - ${path.basename(cwd)}`);
    console.log("");
    console.log("Method: 2.0.0");
    console.log(`Guardrails: ${fs.existsSync(path.join(scrumDir, "guardrails.md")) ? "present" : "missing"}`);
    console.log(`Generated state: ${fs.existsSync(path.join(scrumDir, "state.md")) ? "present" : "missing"}`);
    console.log("");
    console.log("## Artifacts");
    for (const kind of Object.keys(ARTIFACT_TYPES)) {
      const artifacts = repository.list(kind);
      const active = artifacts.filter((artifact) => artifact.record && !["completed", "resolved", "rejected", "deprecated", "invalidated", "archived", "cancelled", "passed"].includes(artifact.record.status));
      console.log(`- ${kind}: ${artifacts.length} total, ${active.length} active`);
    }
    console.log("");
    console.log(`Migration record: ${fs.existsSync(path.join(scrumDir, ".migration", "v1-to-v2", "manifest.json")) ? "v1-to-v2 applied" : "not applicable / native v2"}`);
    console.log(`Canonical command: /sc`);
    return;
  }
  const required = [
    "core.md",
    "config.md",
    "golden-rules.md",
    "token-policy.md",
    "context.md",
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
    intake: `/sc plan intake ${text}`.trim(),
    study: `/sc knowledge study${text ? ` ${text}` : ""}`,
    challenge: `/sc plan challenge ${text}`.trim(),
    know: `/sc knowledge fact --add ${text}`.trim(),
    "context-build": `/sc knowledge context --build${text ? ` ${text}` : ""}`,
    "context-update": `/sc knowledge context --update${text ? ` ${text}` : ""}`,
    "context-show": `/sc knowledge context --show${text ? ` ${text}` : ""}`,
    context: `/sc knowledge context ${text}`.trim(),
    vault: `/sc knowledge vault ${text}`.trim(),
    "goal-set": `/sc plan feature --add ${text}`.trim(),
    "goal-new": `/sc plan feature --add ${text}`.trim(),
    goal: `/sc plan feature --add ${text}`.trim(),
    "sprint-add": `/sc plan sprint --add ${text}`.trim(),
    "sprint-new": `/sc plan sprint --add ${text}`.trim(),
    "sprint-run": `/sc plan task --run ${text}`.trim(),
    "backlog-add": `/sc plan task --add ${text} --status backlog`.trim(),
    backlog: `/sc plan task --add ${text} --status backlog`.trim(),
    status: `/sc plan sprint --show${text ? ` ${text}` : ""}`
  };
  if (!kind || !prompts[kind]) {
    console.error("Usage: scrumrun prompt <intake|study|challenge|know|context-build|context-update|vault|goal-set|sprint-add|sprint-run|backlog-add|status> [text]");
    process.exitCode = 1;
    return;
  }
  console.log(prompts[kind]);
}

function initProject({ force, mode, agentHint, lean }) {
  const cwd = process.cwd();
  const vars = {
    PROJECT_NAME: path.basename(cwd),
    DATE: new Date().toISOString().slice(0, 10)
  };
  const projectTemplate = path.join(templates, "project");
  const agentTemplate = path.join(templates, lean ? "project-lean" : "project", "AGENTS.md");
  const results = [];

  results.push(...copyDir(path.join(projectTemplate, ".scrumrun"), path.join(cwd, ".scrumrun"), { force, vars }));
  results.push(copyFile(path.join(root, "CORE.md"), path.join(cwd, ".scrumrun", "core.md"), { force, vars }));
  results.push(ensureProjectIgnore(cwd));

  if (mode === "shared" || agentHint) {
    results.push(copyFile(agentTemplate, path.join(cwd, "AGENTS.md"), { force, vars }));
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
  if (v2Project(cwd)) refreshState(path.join(cwd, ".scrumrun"));

  const title = lean
    ? `Initialized ScrumRun 2.0 project (lean read policy)`
    : mode === "local"
    ? "Initialized local ScrumRun project"
    : "Initialized shared ScrumRun project";
  printResults(title, results);
  if (mode === "local" && hasGitRepo(cwd)) {
    console.log("\nLocal mode keeps ScrumRun out of commits by writing .scrumrun/ to .git/info/exclude.");
  }
  if (lean) {
    console.log("\nLean mode stores complete v2 truth but tells agents to read only guardrails, state, and relevant ids by default.");
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

function migrateLegacyProject() {
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
  if (!fs.existsSync(path.join(cwd, ".scrumrun", "config.md"))) {
    results.push(copyFile(path.join(templates, "project", ".scrumrun", "config.md"), path.join(cwd, ".scrumrun", "config.md"), {
      vars: { PROJECT_NAME: path.basename(cwd) }
    }));
  }
  const interactionConfig = ensureInteractionPreferences(cwd);
  if (interactionConfig) results.push(interactionConfig);
  results.push(copyFile(path.join(root, "CORE.md"), path.join(cwd, ".scrumrun", "core.md"), {
    force: true,
    vars: { PROJECT_NAME: path.basename(cwd), DATE: today() }
  }));
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
      `# Project - ${path.basename(cwd)}\n\n## Purpose\n\nPending: review migrated ScrumRun files and update with /sc-goal --set.\n\n## Active Lanes\n\n- Main goal: .scrumrun/goals/main/\n- Features: .scrumrun/features/\n`
    );
    results.push({ status: "written", dest: path.join(cwd, ".scrumrun", "project.md") });
  }
  if (!fs.existsSync(path.join(cwd, ".scrumrun", "context.md"))) {
    ensureContextFile(cwd);
    results.push({ status: "written", dest: path.join(cwd, ".scrumrun", "context.md") });
  }
  if (!fs.existsSync(path.join(cwd, ".scrumrun", "token-policy.md"))) {
    ensureTokenPolicyFile(cwd);
    results.push({ status: "written", dest: path.join(cwd, ".scrumrun", "token-policy.md") });
  }
  if (!fs.existsSync(path.join(cwd, ".scrumrun", "backlog.md"))) {
    ensureBacklogFile(cwd);
    results.push({ status: "written", dest: path.join(cwd, ".scrumrun", "backlog.md") });
  }
  if (!fs.existsSync(path.join(cwd, ".scrumrun", "knowledge.md"))) {
    fs.writeFileSync(
      path.join(cwd, ".scrumrun", "knowledge.md"),
      `# Knowledge Base - ${path.basename(cwd)}\n\nOnly approved knowledge should be used as planning context for /sc-challenge, /sc-sprint --add, /sc-sprint --run, and feature planning.\n\n## Approved Knowledge\n\n- Pending: none.\n\n## Pending Proposals\n\n- Pending: none.\n\n## Rejected Proposals\n\n- Pending: none.\n`
    );
    results.push({ status: "written", dest: path.join(cwd, ".scrumrun", "knowledge.md") });
  }
  printResults("Migrated project", results.filter((result) => result.status !== "missing"));
}

function runMigration(parts) {
  if (parts.includes("--legacy-layout")) {
    console.warn("Deprecated: --legacy-layout only migrates pre-.scrumrun files into the v1 layout.");
    migrateLegacyProject();
    return;
  }
  const toIndex = parts.indexOf("--to");
  const target = toIndex >= 0 ? parts[toIndex + 1] : null;
  const actions = ["--dry-run", "--apply", "--rollback"].filter((action) => parts.includes(action));
  if (target !== "2" || actions.length !== 1) {
    console.error("Usage: scrumrun migrate --to 2 [--dry-run|--apply|--rollback]");
    process.exitCode = 1;
    return;
  }
  try {
    if (actions[0] === "--dry-run") {
      const result = dryRunMigration(process.cwd());
      console.log(result.output.trimEnd());
      if (result.status === "blocked") {
        for (const error of result.plan.errors) console.error(`BLOCKED: ${error}`);
        process.exitCode = 1;
      }
    } else if (actions[0] === "--apply") {
      const result = applyMigration(process.cwd());
      if (result.status === "already-applied") {
        console.log("ScrumRun project is already migrated to method 2.0.0; no files changed.");
      } else {
        console.log("Applied ScrumRun v1 to v2 migration.");
        console.log(`Source fingerprint: ${result.manifest.sourceInventory.rootSha256}`);
        console.log(`Generated artifacts: ${result.manifest.generated.length}`);
        console.log("Rollback remains available with: scrumrun migrate --to 2 --rollback");
      }
    } else {
      const result = rollbackMigration(process.cwd());
      console.log("Rolled back ScrumRun v2 migration and restored the exact v1 fingerprint.");
      console.log(`Restored fingerprint: ${result.rootSha256}`);
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}

function doctor(target = "all", { compatibility = false, strict = false } = {}) {
  const home = os.homedir();
  const checks = [];
  const commands = compatibility ? [...COMMANDS, ...COMPATIBILITY_COMMANDS] : COMMANDS;
  const skillContent = fs.readFileSync(path.join(templates, "shared", "skills", "scrumrun", "SKILL.md"), "utf8");

  function commandContent(command) {
    return command === "sc" ? renderRootPrompt() : renderCompatibilityPrompt(command);
  }

  if (target === "all" || target === "codex") {
    for (const command of commands) {
      checks.push([`Codex prompt ${command}`, path.join(home, ".codex", "prompts", `${command}.md`), commandContent(command)]);
    }
    checks.push(["Codex skill scrumrun", path.join(home, ".codex", "skills", "scrumrun", "SKILL.md"), skillContent]);
  }

  if (target === "all" || target === "claude") {
    for (const command of commands) {
      checks.push([`Claude command ${command}`, path.join(home, ".claude", "commands", `${command}.md`), commandContent(command)]);
    }
    checks.push(["Claude skill scrumrun", path.join(home, ".claude", "skills", "scrumrun", "SKILL.md"), skillContent]);
  }

  if (target === "all" || target === "opencode") {
    for (const command of commands) {
      checks.push([`OpenCode command ${command}`, path.join(home, ".config", "opencode", "commands", `${command}.md`), commandContent(command)]);
    }
    checks.push(["OpenCode skill scrumrun", path.join(home, ".config", "opencode", "skills", "scrumrun", "SKILL.md"), skillContent]);
  }

  const [nodeMajor, nodeMinor] = process.versions.node.split(".").map(Number);
  const nodeOk = nodeMajor > 22 || (nodeMajor === 22 && nodeMinor >= 13);
  console.log(`${nodeOk ? "ok " : "miss"} Node.js >=22.13.0: ${process.versions.node}`);
  let ok = nodeOk;
  for (const [label, file, expected] of checks) {
    const safeFile = fs.existsSync(file) && fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink();
    const current = safeFile ? fs.readFileSync(file, "utf8") : null;
    const matches = safeFile && current === expected;
    ok = ok && matches;
    const state = !safeFile ? "miss" : matches ? "ok " : "stale";
    const hashes = safeFile && !matches
      ? ` (expected ${crypto.createHash("sha256").update(expected).digest("hex").slice(0, 12)}, found ${crypto.createHash("sha256").update(current).digest("hex").slice(0, 12)})`
      : "";
    console.log(`${state} ${label}: ${file}${hashes}`);
  }
  if (strict) {
    const scrumDir = path.join(process.cwd(), ".scrumrun");
    if (!fs.existsSync(scrumDir)) {
      ok = false;
      console.log(`miss ScrumRun project audit: ${scrumDir}`);
    } else {
      const audit = auditProject(process.cwd());
      ok = ok && audit.passed && audit.findings.length === 0;
      console.log(`${audit.passed && audit.findings.length === 0 ? "ok " : "fail"} ScrumRun project audit: ${audit.findings.length} finding(s)`);
      for (const item of audit.findings) console.log(`  ${item.severity} ${item.code}: ${item.message}`);
    }
  }
  process.exitCode = ok ? 0 : 1;
}

const args = process.argv.slice(2);
const command = args[0];
const force = args.includes("--force") || args.includes("-f");
const local = args.includes("--local") || args.includes("-l");
const shared = args.includes("--shared") || args.includes("-s");
const noAgentHint = args.includes("--no-agent-hint") || args.includes("-n");
const lean = args.includes("--lean");

if (!command || command === "--help" || command === "-h") {
  usage();
} else if (command === "--version" || command === "-v") {
  console.log(`ScrumRun ${version}`);
} else if (command === "install" || command === "update") {
  const target = ["all", "codex", "opencode", "claude"].includes(args[1]) ? args[1] : "all";
  if (command === "update") updateInstallation(target, { migrate: args.includes("--migrate") });
  else install(target, true, { compatibility: false });
} else if (command === "sc") {
  runRoot(args.slice(1));
} else if (COMMAND_ALIASES[command]) {
  runCompatibilityAlias(command, args.slice(1));
} else if (command === "init") {
  if (local && shared) {
    console.error("Use either --local or --shared, not both.");
    process.exitCode = 1;
  } else {
    initProject({ force, mode: shared ? "shared" : "local", agentHint: shared || !noAgentHint, lean });
  }
} else if (command === "uninstall") {
  uninstallProject(force);
} else if (command === "status") {
  statusProject();
} else if (command === "core") {
  printCore({ pathOnly: args.includes("--path"), promptOnly: args.includes("--prompt") });
} else if (command === "commands") {
  commandList();
} else if (command === "guardrails") {
  runGuardrails(args.slice(1));
} else if (command === "decisions") {
  runDecisions(args.slice(1));
} else if (command === "context") {
  runContext(args.slice(1));
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
  runMigration(args.slice(1));
} else if (command === "doctor") {
  const target = ["all", "codex", "opencode", "claude"].includes(args[1]) ? args[1] : "all";
  doctor(target, { compatibility: args.includes("--compat"), strict: args.includes("--strict") });
} else if (command === "claude") {
  const sub = args[1];
  if (sub === "install" || sub === "update") {
    installClaude(true, { compatibility: sub === "update" });
  } else if (sub === "doctor") {
    doctor("claude", { compatibility: args.includes("--compat"), strict: args.includes("--strict") });
  } else {
    console.error("Usage: scrumrun claude [install|update|doctor]");
    process.exitCode = 1;
  }
} else if (command === "codex") {
  const sub = args[1];
  if (sub === "install" || sub === "update") {
    installCodex(true, { compatibility: sub === "update" });
  } else if (sub === "doctor") {
    doctor("codex", { compatibility: args.includes("--compat"), strict: args.includes("--strict") });
  } else {
    console.error("Usage: scrumrun codex [install|update|doctor]");
    process.exitCode = 1;
  }
} else if (command === "opencode") {
  const sub = args[1];
  if (sub === "install" || sub === "update") {
    installOpenCode(true, { compatibility: sub === "update" });
  } else if (sub === "doctor") {
    doctor("opencode", { compatibility: args.includes("--compat"), strict: args.includes("--strict") });
  } else {
    console.error("Usage: scrumrun opencode [install|update|doctor]");
    process.exitCode = 1;
  }
} else {
  console.error(`Unknown command: ${command}`);
  usage();
  process.exitCode = 1;
}
