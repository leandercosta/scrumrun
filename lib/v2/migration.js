"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { extractEvidence } = require("../memory/markdown");
const { containsSecret } = require("../security/secrets");
const {
  ARTIFACT_TYPES,
  ArtifactRepository,
  METHOD_VERSION,
  assertNoSymlinkPath,
  atomicWrite,
  parseArtifact,
  relativeArtifactPath,
  serializeArtifact,
  sha256,
  validateArtifact
} = require("./artifacts");

const MIGRATION_NAME = "v1-to-v2";
const MANIFEST_PATH = path.join(".migration", MIGRATION_NAME, "manifest.json");
const REPORT_PATH = path.join(".migration", MIGRATION_NAME, "report.md");
const BACKUP_PATH = path.join(".migration", MIGRATION_NAME, "backup");
const PACKAGE_ROOT = path.resolve(__dirname, "..", "..");
const LEGACY_ROOT_FILES = new Set([
  ".DS_Store",
  "agents.md",
  "backlog.md",
  "context.md",
  "fixes.md",
  "golden-rules.md",
  "knowledge.md",
  "runbook.md",
  "token-policy.md"
]);

function posix(relative) {
  return relative.split(path.sep).join("/");
}

function backupRelative(relative) {
  return posix(path.join(BACKUP_PATH, relative));
}

function isLegacyActivePath(relative) {
  const normalized = posix(relative);
  if (LEGACY_ROOT_FILES.has(normalized) || normalized.startsWith("goals/") || normalized.startsWith("knowledge/")) return true;
  if (/^features\/[^/]+\//.test(normalized)) return true;
  if (/^reviews\/(?!REV-\d{3,}\.md$).+\.md$/i.test(normalized)) return true;
  return false;
}

function removeLegacyActivePaths(stage, archivedPaths) {
  for (const relative of [...archivedPaths].sort((a, b) => b.length - a.length)) {
    const target = path.join(stage, relative);
    if (fs.existsSync(target) && fs.lstatSync(target).isFile()) fs.rmSync(target, { force: true });
  }
  for (const relative of ["goals", "knowledge"]) {
    const target = path.join(stage, relative);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
  }
  for (const directory of ["features", "reviews"]) {
    const target = path.join(stage, directory);
    if (!fs.existsSync(target)) continue;
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (directory === "features" && entry.isDirectory()) fs.rmSync(path.join(target, entry.name), { recursive: true, force: true });
      if (directory === "reviews" && entry.isFile() && !/^REV-\d{3,}\.md$/.test(entry.name)) fs.rmSync(path.join(target, entry.name), { force: true });
    }
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function walkTree(root) {
  const files = [];
  const directories = [];
  const symlinks = [];
  if (!fs.existsSync(root)) return { files, directories, symlinks };

  function visit(directory, relative = "") {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = relative ? path.join(relative, entry.name) : entry.name;
      const full = path.join(directory, entry.name);
      const stat = fs.lstatSync(full);
      if (stat.isSymbolicLink()) {
        symlinks.push({ path: posix(rel), target: fs.readlinkSync(full) });
      } else if (stat.isDirectory()) {
        directories.push({ path: posix(rel), mode: stat.mode & 0o777 });
        visit(full, rel);
      } else if (stat.isFile()) {
        const content = fs.readFileSync(full);
        files.push({
          path: posix(rel),
          size: content.length,
          mode: stat.mode & 0o777,
          sha256: sha256(content)
        });
      }
    }
  }

  visit(root);
  return { files, directories, symlinks };
}

function inventoryTree(root) {
  const tree = walkTree(root);
  const fingerprintInput = [
    ...tree.directories.map((entry) => `d\0${entry.path}\0${entry.mode}`),
    ...tree.files.map((entry) => `f\0${entry.path}\0${entry.size}\0${entry.mode}\0${entry.sha256}`),
    ...tree.symlinks.map((entry) => `l\0${entry.path}\0${entry.target}`)
  ].sort().join("\n");
  return { ...tree, rootSha256: sha256(fingerprintInput) };
}

function readText(scrumDir, relative) {
  const file = path.join(scrumDir, relative);
  return fs.existsSync(file) && fs.lstatSync(file).isFile() ? fs.readFileSync(file, "utf8") : "";
}

function packagedFile(relative, variables = {}) {
  let content = fs.readFileSync(path.join(PACKAGE_ROOT, relative), "utf8");
  for (const [name, value] of Object.entries(variables)) content = content.split(`{{${name}}}`).join(value);
  return content.endsWith("\n") ? content : `${content}\n`;
}

function v2Config(content, projectName) {
  if (!content.trim()) {
    return packagedFile(path.join("templates", "project", ".scrumrun", "config.md"), { PROJECT_NAME: projectName });
  }
  let next = content.trimEnd();
  const values = [
    ["Method Version", METHOD_VERSION],
    ["CLI Target", METHOD_VERSION],
    ["Language", "English"],
    ["Interaction Mode", "guided"],
    ["Execution Approval", "always"],
    ["Quick Tasks", "ask"]
  ];
  for (const [field, fallback] of values) {
    const matcher = new RegExp(`^${field}:\\s*.*$`, "m");
    if (field === "Method Version" || field === "CLI Target") {
      next = matcher.test(next) ? next.replace(matcher, `${field}: ${METHOD_VERSION}`) : `${next}\n${field}: ${METHOD_VERSION}`;
    } else if (!matcher.test(next)) {
      next = `${next}\n${field}: ${fallback}`;
    }
  }
  if (!/cannot weaken .*guardrails\.md/i.test(next)) {
    next += "\n\nThese are operating preferences. They can never weaken `.scrumrun/guardrails.md`.";
  }
  return `${next}\n`;
}

function section(content, title) {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^## ${escaped}[ \\t]*$`, "m").exec(content);
  if (!match) return null;
  const bodyStart = match.index + match[0].length;
  const tail = content.slice(bodyStart);
  const next = /^## [^\n]+$/m.exec(tail);
  const end = next ? bodyStart + next.index : content.length;
  return { body: content.slice(bodyStart, end), bodyStart, end };
}

function headingBlocks(content, level) {
  const headings = [...content.matchAll(/^(#{1,6})[ \t]+([^\r\n]+)[ \t]*$/gm)];
  const blocks = [];
  for (let index = 0; index < headings.length; index++) {
    const heading = headings[index];
    if (heading[1].length !== level) continue;
    let end = content.length;
    for (let next = index + 1; next < headings.length; next++) {
      if (headings[next][1].length <= level) {
        end = headings[next].index;
        break;
      }
    }
    blocks.push({
      heading: heading[2].trim(),
      raw: content.slice(heading.index, end).trimEnd(),
      start: heading.index,
      end
    });
  }
  return blocks;
}

function titleFromDocument(content, fallback) {
  const match = content.match(/^# ([^\r\n]+)$/m);
  return match ? match[1].replace(/^(Feature|Project|Review)\s*[-:]\s*/i, "").trim() : fallback;
}

function legacyStatus(raw, fallback = "backlog") {
  const match = raw.match(/^(?:\*\*)?Status(?:\*\*)?:\s*\**([a-z_-]+)/im);
  return match ? match[1].toLowerCase().replace(/[._-]+$/, "") : fallback;
}

function taskStatus(raw) {
  const status = legacyStatus(raw);
  return ["backlog", "proposed", "running", "validating", "learning", "partial", "completed", "failed", "blocked", "cancelled"].includes(status)
    ? status
    : "backlog";
}

function runStatus(raw) {
  const status = legacyStatus(raw, "partial");
  if (status === "running") return "executing";
  if (["completed", "failed", "blocked", "partial"].includes(status)) return status;
  return "partial";
}

function sprintStatus(raw) {
  const status = legacyStatus(raw, "proposed");
  if (["proposed", "running", "partial", "completed", "blocked", "cancelled"].includes(status)) return status;
  return status === "failed" ? "blocked" : "proposed";
}

function slugTitle(value) {
  return value.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).trim();
}

function sourceBody(title, source, anchor, raw) {
  const indented = raw.split(/\r?\n/).map((line) => `    ${line}`).join("\n");
  return `# ${title}\n\n## Migration Provenance\n\n- Source: \`.scrumrun/${backupRelative(source)}\`\n- Anchor: ${anchor}\n- Source block SHA-256: \`${sha256(raw)}\`\n\n## Imported v1 Content\n\n${indented}`;
}

class IdAllocator {
  constructor(scrumDir) {
    this.used = new Map();
    for (const [kind, type] of Object.entries(ARTIFACT_TYPES)) {
      const ids = new Set();
      const directory = path.join(scrumDir, type.directory);
      if (fs.existsSync(directory) && fs.lstatSync(directory).isDirectory() && !fs.lstatSync(directory).isSymbolicLink()) {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const match = entry.isFile() && entry.name.match(new RegExp(`^(${type.prefix}-\\d{3,})\\.md$`));
          if (match) ids.add(match[1]);
        }
      }
      this.used.set(kind, ids);
    }
  }

  claim(kind, preferred = null) {
    const type = ARTIFACT_TYPES[kind];
    const used = this.used.get(kind);
    if (preferred && new RegExp(`^${type.prefix}-\\d{3,}$`).test(preferred) && !used.has(preferred)) {
      used.add(preferred);
      return preferred;
    }
    let number = 1;
    while (used.has(`${type.prefix}-${String(number).padStart(3, "0")}`)) number++;
    const id = `${type.prefix}-${String(number).padStart(3, "0")}`;
    used.add(id);
    return id;
  }
}

function migrationPlan(projectRoot) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  if (!fs.existsSync(scrumDir) || !fs.lstatSync(scrumDir).isDirectory()) {
    throw new Error("Not a ScrumRun project: .scrumrun/ is missing.");
  }

  const appliedManifest = path.join(scrumDir, MANIFEST_PATH);
  if (fs.existsSync(appliedManifest)) {
    const manifest = JSON.parse(fs.readFileSync(appliedManifest, "utf8"));
    return { alreadyApplied: true, manifest, scrumDir };
  }
  const methodFile = path.join(scrumDir, "method.json");
  if (fs.existsSync(methodFile)) {
    try {
      const marker = JSON.parse(fs.readFileSync(methodFile, "utf8"));
      if (marker.method === METHOD_VERSION) {
        return { alreadyApplied: true, manifest: { to: METHOD_VERSION, sourceInventory: null }, scrumDir };
      }
    } catch {
      throw new Error("Existing .scrumrun/method.json is malformed; migration refused.");
    }
    throw new Error("Existing .scrumrun/method.json is not a recognized ScrumRun 2.0 marker; migration refused.");
  }

  const inventory = inventoryTree(scrumDir);
  const generated = new Map();
  const artifacts = [];
  const archivedPaths = inventory.files.filter((entry) => isLegacyActivePath(entry.path)).map((entry) => entry.path);
  const archivedSet = new Set(archivedPaths);
  const mappings = inventory.files.map((entry) => ({
    source: entry.path,
    sourceSha256: entry.sha256,
    outcome: archivedSet.has(entry.path) ? "archived-in-backup" : "preserved",
    destination: archivedSet.has(entry.path) ? backupRelative(entry.path) : entry.path
  }));
  const warnings = [];
  const errors = inventory.symlinks.map((entry) => `Symbolic link is not migrated automatically: ${entry.path}`);
  for (const entry of inventory.files) {
    if (/(^|\/)vault(?:\.local)?\.md$/i.test(entry.path) || !/\.(?:md|json|txt)$/i.test(entry.path)) continue;
    const content = fs.readFileSync(path.join(scrumDir, entry.path), "utf8");
    if (containsSecret(content)) errors.push(`Secret-like content detected outside the local vault: ${entry.path}`);
  }
  const allocator = new IdAllocator(scrumDir);
  const existingArtifacts = Object.fromEntries(Object.keys(ARTIFACT_TYPES).map((kind) => [kind, []]));
  const existingIds = new Set();
  try {
    const repository = new ArtifactRepository(scrumDir);
    for (const kind of Object.keys(ARTIFACT_TYPES)) {
      for (const artifact of repository.list(kind)) {
        if (!artifact.record) {
          errors.push(`${path.relative(scrumDir, artifact.file)}: ${artifact.errors.join("; ")}`);
          continue;
        }
        existingArtifacts[kind].push(artifact);
        existingIds.add(artifact.record.id);
      }
    }
  } catch (error) {
    errors.push(`Existing canonical artifact scan failed: ${error.message}`);
  }
  const taskIndex = new Map();
  const runAttempts = new Map();
  const created = today();

  function addArtifact(record, body, source = null) {
    const validation = validateArtifact(record);
    if (validation.length) {
      errors.push(`${record.id || "unknown"}: ${validation.join("; ")}`);
      return null;
    }
    const relative = posix(relativeArtifactPath(record));
    const content = serializeArtifact(record, body);
    if (generated.has(relative) && generated.get(relative) !== content) {
      errors.push(`Generated artifact collision: ${relative}`);
      return null;
    }
    generated.set(relative, content);
    artifacts.push({ id: record.id, kind: record.kind, status: record.status, relative, record });
    if (source) {
      mappings.push({
        source: source.path,
        anchor: source.anchor,
        sourceSha256: sha256(source.raw),
        outcome: "transformed",
        destination: relative,
        id: record.id
      });
    }
    return { record, relative };
  }

  function normalizeExistingArtifacts() {
    const aliases = {
      decision: { confirmed: "resolved" },
      knowledge: { confirmed: "approved" }
    };
    const activeTruth = new Set(["approved", "confirmed", "resolved", "active"]);
    for (const [kind, entries] of Object.entries(existingArtifacts)) {
      for (const artifact of entries) {
        const permittedErrors = artifact.errors.filter((error) => {
          const alias = aliases[kind] && aliases[kind][artifact.record.status];
          return alias && error === `invalid ${kind} status: ${artifact.record.status}`;
        });
        if (artifact.errors.length !== permittedErrors.length) {
          errors.push(`${path.relative(scrumDir, artifact.file)}: ${artifact.errors.join("; ")}`);
          continue;
        }
        const record = { ...artifact.record };
        let body = artifact.body;
        let changed = false;
        const alias = aliases[kind] && aliases[kind][record.status];
        if (alias) {
          record.status = alias;
          changed = true;
          warnings.push(`${record.id}: normalized legacy ${kind} status ${artifact.record.status} → ${alias}.`);
        }
        if (["knowledge", "decision", "insight", "dossier"].includes(kind)
          && activeTruth.has(record.status)
          && !extractEvidence(body).length) {
          const sourceId = [record.source_id, record.source].find((value) => typeof value === "string" && existingIds.has(value));
          const legacySource = typeof record.legacy_source === "string" && fs.existsSync(path.join(scrumDir, record.legacy_source))
            ? `.scrumrun/${backupRelative(record.legacy_source)}`
            : null;
          const evidence = sourceId || legacySource;
          if (!evidence) {
            errors.push(`${record.id}: active memory has no resolvable evidence and cannot be normalized safely.`);
          } else {
            body = `${body.trimEnd()}\n\n## Evidence · normalized by migration\n\n- ${evidence}\n`;
            changed = true;
            warnings.push(`${record.id}: promoted its existing source ${evidence} to structured evidence.`);
          }
        }
        const validation = validateArtifact(record, kind);
        if (validation.length) {
          errors.push(`${record.id}: ${validation.join("; ")}`);
          continue;
        }
        artifact.record = record;
        if (!changed) continue;
        const relative = posix(path.relative(scrumDir, artifact.file));
        generated.set(relative, serializeArtifact(record, body));
        const mapping = mappings.find((item) => item.source === relative && !item.anchor);
        if (mapping) {
          mapping.outcome = "normalized-v2-artifact";
          mapping.destination = relative;
        }
      }
    }
  }

  normalizeExistingArtifacts();

  function migrateSprintPlan(relative, { feature = null, lane = "main" } = {}) {
    const content = readText(scrumDir, relative);
    if (!content) return;
    for (const block of headingBlocks(content, 2)) {
      const sprint = block.heading.match(/^Sprint\s+([0-9]+(?:\.[0-9]+)?)\s*(?:[-—:]\s*)?(.*)$/i);
      if (!sprint) continue;
      const legacyId = `Sprint ${sprint[1]}`;
      const title = sprint[2] ? `${legacyId} - ${sprint[2]}` : legacyId;
      const canonicalSprintId = /^\d+$/.test(sprint[1]) ? `SPRINT-${String(Number(sprint[1])).padStart(3, "0")}` : null;
      const existingSprint = canonicalSprintId
        ? existingArtifacts.sprint.find((artifact) => artifact.record.id === canonicalSprintId)
        : null;
      const linkedTasks = existingSprint
        ? existingArtifacts.task.filter((artifact) => artifact.record.sprint === canonicalSprintId)
        : [];
      if (existingSprint && linkedTasks.length) {
        const primary = linkedTasks.length === 1 ? linkedTasks[0].record : null;
        mappings.push({
          source: relative,
          anchor: block.heading,
          sourceSha256: sha256(block.raw),
          outcome: "represented-by-existing-v2",
          destination: primary ? posix(relativeArtifactPath(primary)) : posix(relativeArtifactPath(existingSprint.record)),
          id: primary ? primary.id : existingSprint.record.id
        });
        if (primary) {
          taskIndex.set(`${lane}:${legacyId.toLowerCase()}`, primary);
          taskIndex.set(`${lane}:${title.toLowerCase()}`, primary);
        } else {
          warnings.push(`${relative}#${block.heading}: ${canonicalSprintId} already groups multiple Tasks; no duplicate Task was invented.`);
        }
        continue;
      }
      const taskId = allocator.claim("task");
      const task = {
        id: taskId,
        kind: "task",
        type: "task",
        status: taskStatus(block.raw),
        created,
        updated: created,
        method: METHOD_VERSION,
        feature,
        sprint: existingSprint ? canonicalSprintId : null,
        legacy_ref: legacyId,
        legacy_source: relative
      };

      const hasTimebox = /^Timebox:\s*.+$/im.test(block.raw)
        || (/^Start:\s*.+$/im.test(block.raw) && /^End:\s*.+$/im.test(block.raw));
      if (hasTimebox && !existingSprint) {
        const sprintId = allocator.claim("sprint");
        task.sprint = sprintId;
        addArtifact({
          id: sprintId,
          kind: "sprint",
          status: sprintStatus(block.raw),
          created,
          updated: created,
          method: METHOD_VERSION,
          legacy_ref: legacyId,
          legacy_source: relative
        }, `${sourceBody(title, relative, block.heading, block.raw)}\n\n## Tasks\n\n- ${taskId}`, { path: relative, anchor: block.heading, raw: block.raw });
      }
      addArtifact(task, sourceBody(title, relative, block.heading, block.raw), { path: relative, anchor: block.heading, raw: block.raw });
      taskIndex.set(`${lane}:${legacyId.toLowerCase()}`, task);
      taskIndex.set(`${lane}:${title.toLowerCase()}`, task);
    }
  }

  function findHistoryTask(lane, heading) {
    const lowered = heading.toLowerCase();
    const candidates = [...taskIndex.entries()]
      .filter(([key]) => key.startsWith(`${lane}:`) && lowered.includes(key.slice(lane.length + 1)))
      .sort((a, b) => b[0].length - a[0].length);
    return candidates.length ? candidates[0][1] : null;
  }

  function migrateHistory(relative, { lane = "main" } = {}) {
    const content = readText(scrumDir, relative);
    if (!content) return;
    const blocks = headingBlocks(content, 3);
    for (const block of blocks) {
      const task = findHistoryTask(lane, block.heading);
      if (!task) {
        warnings.push(`${relative}#${block.heading}: preserved but no Task link was inferred.`);
        continue;
      }
      const attempt = (runAttempts.get(task.id) || 0) + 1;
      runAttempts.set(task.id, attempt);
      const existingRun = existingArtifacts.run.find((artifact) => artifact.record.task === task.id && artifact.record.attempt === attempt);
      if (existingRun) {
        mappings.push({
          source: relative,
          anchor: block.heading,
          sourceSha256: sha256(block.raw),
          outcome: "represented-by-existing-v2",
          destination: posix(relativeArtifactPath(existingRun.record)),
          id: existingRun.record.id
        });
        continue;
      }
      const id = allocator.claim("run");
      addArtifact({
        id,
        kind: "run",
        status: runStatus(block.raw),
        created,
        updated: created,
        method: METHOD_VERSION,
        task: task.id,
        sprint: task.sprint,
        attempt,
        legacy_source: relative
      }, sourceBody(block.heading, relative, block.heading, block.raw), { path: relative, anchor: block.heading, raw: block.raw });
    }
  }

  function migrateFeatures() {
    const featuresDir = path.join(scrumDir, "features");
    if (!fs.existsSync(featuresDir)) return;
    for (const entry of fs.readdirSync(featuresDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isDirectory()) continue;
      const base = path.join("features", entry.name);
      const featureSource = path.join(base, "feature.md");
      const featureContent = readText(scrumDir, featureSource);
      const title = titleFromDocument(featureContent, slugTitle(entry.name));
      const id = allocator.claim("feature");
      addArtifact({
        id,
        kind: "feature",
        status: "active",
        created,
        updated: created,
        method: METHOD_VERSION,
        legacy_ref: entry.name,
        legacy_source: featureSource
      }, sourceBody(title, featureSource, title, featureContent || `Feature lane: ${entry.name}`), {
        path: featureSource,
        anchor: title,
        raw: featureContent || `Feature lane: ${entry.name}`
      });
      migrateSprintPlan(path.join(base, "sprint.md"), { feature: id, lane: `feature:${entry.name}` });
      migrateHistory(path.join(base, "history.md"), { lane: `feature:${entry.name}` });
      migrateDecisionFile(path.join(base, "decisions.md"), { feature: id });
    }
  }

  function migrateBacklog() {
    const relative = "backlog.md";
    const content = readText(scrumDir, relative);
    if (!content) return;
    for (const match of content.matchAll(/^- \[([ xX])\]\s+(.+)$/gm)) {
      const raw = match[0];
      const title = match[2].trim();
      const id = allocator.claim("task");
      addArtifact({
        id,
        kind: "task",
        type: "task",
        status: match[1].toLowerCase() === "x" ? "completed" : "backlog",
        created,
        updated: created,
        method: METHOD_VERSION,
        feature: null,
        sprint: null,
        legacy_source: relative
      }, sourceBody(title, relative, title, raw), { path: relative, anchor: title, raw });
    }
  }

  function migrateFixes() {
    const relative = "fixes.md";
    const content = readText(scrumDir, relative);
    if (!content) return;
    let blocks = headingBlocks(content, 2);
    if (!blocks.length) blocks = headingBlocks(content, 3);
    for (const block of blocks) {
      if (!/\b(?:F-\d{3}|fix)\b/i.test(block.heading)) continue;
      const taskId = allocator.claim("task");
      const status = taskStatus(block.raw);
      addArtifact({
        id: taskId,
        kind: "task",
        type: "fix",
        status,
        created,
        updated: created,
        method: METHOD_VERSION,
        feature: null,
        sprint: null,
        legacy_ref: (block.heading.match(/F-\d{3}/i) || [])[0] || null,
        legacy_source: relative
      }, sourceBody(block.heading, relative, block.heading, block.raw), { path: relative, anchor: block.heading, raw: block.raw });
      if (status !== "backlog" && status !== "proposed") {
        const runId = allocator.claim("run");
        addArtifact({
          id: runId,
          kind: "run",
          status: runStatus(block.raw),
          created,
          updated: created,
          method: METHOD_VERSION,
          task: taskId,
          sprint: null,
          attempt: 1,
          legacy_source: relative
        }, sourceBody(block.heading, relative, block.heading, block.raw), { path: relative, anchor: block.heading, raw: block.raw });
      }
    }
  }

  function migrateKnowledge() {
    const relative = "knowledge.md";
    const content = readText(scrumDir, relative);
    if (!content) return;
    const sectionStatuses = [
      ["Approved Knowledge", "approved"],
      ["Pending Proposals", "candidate"],
      ["Rejected Proposals", "rejected"]
    ];
    for (const [sectionTitle, status] of sectionStatuses) {
      const bounds = section(content, sectionTitle);
      if (!bounds) continue;
      for (const block of headingBlocks(bounds.body, 3)) {
        const match = block.heading.match(/^(K-\d{3,})\s*[-—:]\s*(.+)$/i);
        if (!match) continue;
        const preferred = match[1].toUpperCase();
        const id = allocator.claim("knowledge", preferred);
        const source = { path: relative, anchor: block.heading, raw: block.raw };
        addArtifact({
          id,
          kind: "knowledge",
          status,
          created,
          updated: created,
          method: METHOD_VERSION,
          legacy_ref: preferred,
          legacy_source: relative
        }, sourceBody(match[2], relative, block.heading, block.raw), source);

        const insightSection = block.raw.match(/^#### Reusable Insights[ \t]*\r?\n([\s\S]*?)(?=^#### |^### |(?![\s\S]))/m);
        if (insightSection) {
          for (const insight of insightSection[1].matchAll(/^- (.+)$/gm)) {
            const insightId = allocator.claim("insight");
            addArtifact({
              id: insightId,
              kind: "insight",
              status: "candidate",
              created,
              updated: created,
              method: METHOD_VERSION,
              subject: id,
              source_type: "knowledge",
              source_id: id,
              legacy_source: relative
            }, sourceBody(insight[1], relative, block.heading, insight[0]), { path: relative, anchor: `${block.heading} / Reusable Insights`, raw: insight[0] });
          }
        }
      }
    }
  }

  function migrateDecisionFile(relative, { feature = null } = {}) {
    const content = readText(scrumDir, relative);
    if (!content) return;
    for (const [sectionTitle, status] of [["Open Decisions", "open"], ["Resolved Decisions", "resolved"]]) {
      const bounds = section(content, sectionTitle);
      if (!bounds) continue;
      const structured = headingBlocks(bounds.body, 3);
      const masked = [...bounds.body];
      for (const block of structured) {
        for (let index = block.start; index < block.end; index++) {
          if (masked[index] !== "\n" && masked[index] !== "\r") masked[index] = " ";
        }
        const match = block.heading.match(/^(D-\d{3,})\s*[-—:]\s*(.+)$/i);
        if (!match) continue;
        const id = allocator.claim("decision");
        addArtifact({
          id,
          kind: "decision",
          status,
          created,
          updated: created,
          method: METHOD_VERSION,
          feature,
          legacy_ref: match[1].toUpperCase(),
          legacy_source: relative
        }, sourceBody(match[2], relative, block.heading, block.raw), { path: relative, anchor: block.heading, raw: block.raw });
      }
      for (const bullet of masked.join("").matchAll(/^- (?!Pending: none\.)(.+)$/gm)) {
        const title = bullet[1].trim();
        const id = allocator.claim("decision");
        addArtifact({
          id,
          kind: "decision",
          status,
          created,
          updated: created,
          method: METHOD_VERSION,
          feature,
          legacy_ref: null,
          legacy_source: relative
        }, sourceBody(title, relative, title, bullet[0]), { path: relative, anchor: title, raw: bullet[0] });
      }
    }
  }

  function migrateDossiers() {
    const legacyDir = path.join(scrumDir, "knowledge", "dossiers");
    if (!fs.existsSync(legacyDir)) return;
    for (const entry of fs.readdirSync(legacyDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const relative = path.join("knowledge", "dossiers", entry.name);
      const content = readText(scrumDir, relative);
      const title = titleFromDocument(content, slugTitle(path.basename(entry.name, ".md")));
      const id = allocator.claim("dossier");
      addArtifact({
        id,
        kind: "dossier",
        status: legacyStatus(content, "active") === "stale" ? "stale" : "active",
        created,
        updated: created,
        method: METHOD_VERSION,
        legacy_source: relative
      }, sourceBody(title, relative, title, content), { path: relative, anchor: title, raw: content });
    }
  }

  function migrateReviews() {
    const reviewsDir = path.join(scrumDir, "reviews");
    if (!fs.existsSync(reviewsDir)) return;
    for (const entry of fs.readdirSync(reviewsDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (!entry.isFile() || !entry.name.endsWith(".md") || /^REV-\d{3,}\.md$/.test(entry.name)) continue;
      const relative = path.join("reviews", entry.name);
      const content = readText(scrumDir, relative);
      const title = titleFromDocument(content, slugTitle(path.basename(entry.name, ".md")));
      const id = allocator.claim("review");
      addArtifact({
        id,
        kind: "review",
        status: "archived",
        created,
        updated: created,
        method: METHOD_VERSION,
        legacy_source: relative
      }, sourceBody(title, relative, title, content), { path: relative, anchor: title, raw: content });
    }
  }

  function migrateGuardrails() {
    const golden = readText(scrumDir, "golden-rules.md");
    const current = readText(scrumDir, "guardrails.md");
    if (/^# ScrumRun Project Guardrails\b/m.test(current) && /^#{2,6} GR-\d{3,}\b/m.test(current)) {
      const canonical = current.replace(/^#{3,6}(?= GR-\d{3,}\b)/gm, "##");
      if (canonical !== current) {
        generated.set("guardrails.md", canonical.endsWith("\n") ? canonical : `${canonical}\n`);
        const mapping = mappings.find((item) => item.source === "guardrails.md" && !item.anchor);
        if (mapping) {
          mapping.outcome = "normalized-v2-artifact";
          mapping.destination = "guardrails.md";
        }
        warnings.push("guardrails.md: normalized stable GR headings to canonical level 2 without changing rule content.");
      }
      return;
    }
    const goldenRules = [...golden.matchAll(/^\s*(\d+)\.\s+(.+)$/gm)].map((match) => match[2].trim());
    const currentRules = [...current.matchAll(/^Rule:\s+(.+)$/gm)].map((match) => match[1].trim());
    const defaults = [
      "Never commit or print real secrets.",
      "Never overwrite unrelated or pre-existing owner changes.",
      "Never modify a path marked read-only by the owner or project configuration.",
      "Intake remains read-only; execution requires explicit valid approval."
    ];
    const canonicalRules = goldenRules.length ? goldenRules : currentRules.length ? currentRules : defaults;
    const source = goldenRules.length ? "golden-rules.md" : currentRules.length ? "guardrails.md" : "ScrumRun v2 safe defaults";
    const body = [
      "# ScrumRun Project Guardrails",
      "",
      "Canonical project policy for ScrumRun method 2.0.0. Universal invariants remain in `core.md`.",
      "",
      ...canonicalRules.flatMap((rule, index) => [
        `## GR-${String(index + 1).padStart(3, "0")} - ${rule}`,
        "",
        "Status: active",
        `Source: \`${source}\``,
        ""
      ]),
      "## Migration",
      "",
      "The byte-exact v1 policy remains in `golden-rules.md` and in the migration backup."
    ].join("\n");
    generated.set("guardrails.md", `${body.trim()}\n`);
    if (current) {
      mappings.push({
        source: "guardrails.md",
        anchor: "complete document",
        sourceSha256: sha256(current),
        outcome: "superseded-and-backed-up",
        destination: "guardrails.md"
      });
    }
    if (golden) {
      mappings.push({
        source: "golden-rules.md",
        anchor: "complete document",
        sourceSha256: sha256(golden),
        outcome: "transformed-and-preserved",
        destination: "guardrails.md"
      });
    }
  }

  migrateSprintPlan(path.join("goals", "main", "sprint.md"));
  migrateHistory(path.join("goals", "main", "history.md"));
  migrateFeatures();
  migrateBacklog();
  migrateFixes();
  migrateKnowledge();
  migrateDecisionFile(path.join("goals", "main", "decisions.md"));
  migrateDossiers();
  migrateReviews();
  migrateGuardrails();

  function generateInfrastructure(relative, content) {
    const current = readText(scrumDir, relative);
    generated.set(relative, content);
    if (current && current !== content) {
      const mapping = mappings.find((item) => item.source === relative && !item.anchor);
      if (mapping) {
        mapping.outcome = "superseded-and-backed-up";
        mapping.destination = relative;
      }
    }
  }

  const projectName = path.basename(projectRoot);
  generateInfrastructure("core.md", packagedFile("CORE.md"));
  generateInfrastructure("config.md", v2Config(readText(scrumDir, "config.md"), projectName));
  if (!readText(scrumDir, "project.md")) {
    generateInfrastructure("project.md", packagedFile(path.join("templates", "project", ".scrumrun", "project.md"), {
      PROJECT_NAME: projectName,
      DATE: created
    }));
  }

  const existingIgnore = readText(scrumDir, ".gitignore");
  const ignoreLines = existingIgnore.split(/\r?\n/).filter(Boolean);
  for (const ignored of [".cache/", ".backup/", ".migration/", "vault.local.md"]) {
    if (!ignoreLines.includes(ignored)) ignoreLines.push(ignored);
  }
  generated.set(".gitignore", `${ignoreLines.join("\n")}\n`);
  const ignoreMapping = mappings.find((mapping) => mapping.source === ".gitignore" && !mapping.anchor);
  if (ignoreMapping) {
    ignoreMapping.outcome = "intentionally-merged";
    ignoreMapping.destination = ".gitignore";
  }

  const sourceLayout = existingIds.size ? "hybrid-v1-v2" : "1.x";
  generated.set("method.json", `${JSON.stringify({ method: METHOD_VERSION, layout: "v2", migrated_from: sourceLayout, migration: MIGRATION_NAME }, null, 2)}\n`);

  const counts = {};
  for (const artifact of artifacts) counts[artifact.kind] = (counts[artifact.kind] || 0) + 1;
  return {
    alreadyApplied: false,
    projectRoot,
    scrumDir,
    inventory,
    artifacts,
    generated,
    mappings,
    warnings,
    errors,
    counts,
    created,
    sourceLayout,
    archivedPaths
  };
}

function reportFor(plan, status = "dry-run") {
  const countLines = Object.entries(plan.counts).sort().map(([kind, count]) => `- ${kind}: ${count}`);
  const warningLines = plan.warnings.length ? plan.warnings.map((warning) => `- ${warning}`) : ["- None."];
  const transformed = plan.mappings.filter((mapping) => mapping.outcome !== "preserved");
  const mappingLines = transformed.length
    ? transformed.map((mapping) => `- \`${mapping.source}\`${mapping.anchor ? ` → ${mapping.anchor}` : ""} => \`${mapping.destination}\`${mapping.id ? ` (${mapping.id})` : ""} [${mapping.outcome}]`)
    : ["- No semantic records were inferred; all source files remain preserved."];
  return `# ScrumRun v1 to v2 Migration Report\n\nStatus: ${status}\nSource layout: ${plan.sourceLayout}\nSource fingerprint: \`${plan.inventory.rootSha256}\`\nSource files: ${plan.inventory.files.length}\nGenerated artifacts: ${plan.artifacts.length}\nArchived legacy paths: ${plan.archivedPaths.length}\n\n## Artifact Counts\n\n${countLines.length ? countLines.join("\n") : "- None."}\n\n## Preservation\n\n- ${plan.inventory.files.length} original files are covered by the hashed backup inventory.\n- Active project paths contain only the v2 kernel after apply; legacy-only paths remain byte-exact under the ignored migration backup.\n- Files superseded or normalized by a v2 canonical artifact remain byte-exact in the local migration backup.\n- Vault contents are preserved locally and are never rendered in this report.\n- Generated relations carry the SHA-256 of their source block.\n\n## Source-to-Destination Mapping\n\n${mappingLines.join("\n")}\n\n## Warnings\n\n${warningLines.join("\n")}\n`;
}

function manifestFor(plan) {
  const generated = [...plan.generated.entries()].map(([relative, content]) => ({
    path: relative,
    size: Buffer.byteLength(content),
    sha256: sha256(content)
  }));
  return {
    schema: 1,
    migration: MIGRATION_NAME,
    status: "applied",
    from: plan.sourceLayout,
    to: METHOD_VERSION,
    created: plan.created,
    sourceInventory: plan.inventory,
    generated,
    archivedPaths: plan.archivedPaths,
    mappings: plan.mappings,
    warnings: plan.warnings
  };
}

function validateStage(stage, plan) {
  const errors = [];
  const records = new Map();
  const allArtifacts = [];
  const repository = new ArtifactRepository(stage);
  for (const kind of Object.keys(ARTIFACT_TYPES)) {
    for (const artifact of repository.list(kind)) {
      allArtifacts.push(artifact);
      errors.push(...artifact.errors.map((error) => `${path.relative(stage, artifact.file)}: ${error}`));
      if (!artifact.record || artifact.errors.length) continue;
      if (records.has(artifact.record.id)) errors.push(`Duplicate artifact id: ${artifact.record.id}`);
      records.set(artifact.record.id, artifact.record);
    }
  }
  for (const artifact of plan.artifacts) {
    const file = path.join(stage, artifact.relative);
    if (!fs.existsSync(file)) {
      errors.push(`Missing staged artifact: ${artifact.relative}`);
      continue;
    }
    const parsed = parseArtifact(fs.readFileSync(file, "utf8"));
    errors.push(...parsed.errors.map((error) => `${artifact.relative}: ${error}`));
    errors.push(...validateArtifact(parsed.record, artifact.kind).map((error) => `${artifact.relative}: ${error}`));
  }
  for (const artifact of allArtifacts) {
    if (!artifact.record || artifact.errors.length) continue;
    const record = artifact.record;
    const requiredRelations = record.kind === "run"
      ? [["task", "task"], ["sprint", "sprint"]]
      : record.kind === "task"
        ? [["feature", "feature"], ["sprint", "sprint"]]
        : [];
    for (const [field, expectedKind] of requiredRelations) {
      if (!record[field]) continue;
      const target = records.get(record[field]);
      if (!target || target.kind !== expectedKind) {
        errors.push(`${record.id}.${field} has unresolved ${expectedKind} reference: ${record[field]}`);
      }
    }
  }
  const activeTruth = new Set(["approved", "confirmed", "resolved", "active"]);
  for (const artifact of allArtifacts) {
    const record = artifact.record;
    if (!record || !["knowledge", "decision", "insight", "dossier"].includes(record.kind) || !activeTruth.has(record.status)) continue;
    const evidence = extractEvidence(artifact.body);
    if (!evidence.length) {
      errors.push(`${record.id}: active memory has no structured evidence.`);
      continue;
    }
    for (const reference of evidence) {
      if (records.has(reference)) continue;
      const relative = String(reference).replace(/^path:\s*/i, "").replace(/^\.scrumrun\//, "");
      if (path.isAbsolute(relative) || relative.split(/[\\/]+/).includes("..")) {
        errors.push(`${record.id}: unsafe evidence reference ${reference}`);
        continue;
      }
      const target = String(reference).startsWith(".scrumrun/")
        ? path.join(stage, relative)
        : path.join(path.dirname(stage), relative);
      if (!fs.existsSync(target)) {
        errors.push(`${record.id}: unresolved evidence reference ${reference}`);
        continue;
      }
      try {
        const evidenceRoot = String(reference).startsWith(".scrumrun/") ? stage : path.dirname(stage);
        assertNoSymlinkPath(evidenceRoot, target);
      } catch (error) {
        errors.push(`${record.id}: unsafe evidence reference ${reference}: ${error.message}`);
      }
    }
  }
  const backupInventory = inventoryTree(path.join(stage, BACKUP_PATH));
  if (backupInventory.rootSha256 !== plan.inventory.rootSha256) errors.push("Staged backup fingerprint differs from source inventory.");
  return errors;
}

function ensureCanonicalDirectories(stage) {
  const directories = new Set(Object.values(ARTIFACT_TYPES).map((type) => type.directory));
  for (const directory of directories) fs.mkdirSync(path.join(stage, directory), { recursive: true });
}

function copyTree(source, destination) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.cpSync(source, destination, { recursive: true, force: false, preserveTimestamps: true, errorOnExist: true });
}

function cleanup(target) {
  if (target && fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}

function atomicDirectorySwap(current, staged, failurePoint = null) {
  const parent = path.dirname(current);
  const previous = path.join(parent, `.scrumrun-v1-swap-${process.pid}-${Date.now()}`);
  let state = "ready";
  try {
    fs.renameSync(current, previous);
    state = "previous-moved";
    if (failurePoint === "after-source-move") throw new Error("Injected migration failure after source move.");
    fs.renameSync(staged, current);
    state = "new-active";
    if (failurePoint === "after-target-move") throw new Error("Injected migration failure after target move.");
    cleanup(previous);
    state = "complete";
  } catch (error) {
    if (state === "new-active" && fs.existsSync(current)) fs.renameSync(current, staged);
    if ((state === "new-active" || state === "previous-moved") && fs.existsSync(previous)) fs.renameSync(previous, current);
    throw error;
  } finally {
    if (state === "complete") cleanup(staged);
  }
}

function applyMigration(projectRoot, { failurePoint = null, plan: verifiedPlan = null } = {}) {
  const plan = verifiedPlan || migrationPlan(projectRoot);
  if (path.resolve(plan.projectRoot || projectRoot) !== path.resolve(projectRoot)) {
    throw new Error("Verified migration plan belongs to a different project.");
  }
  if (plan.alreadyApplied) return { status: "already-applied", manifest: plan.manifest };
  if (plan.errors.length) throw new Error(`Migration blocked:\n- ${plan.errors.join("\n- ")}`);

  const parent = path.dirname(plan.scrumDir);
  const stage = fs.mkdtempSync(path.join(parent, ".scrumrun-v2-stage-"));
  try {
    copyTree(plan.scrumDir, stage);
    copyTree(plan.scrumDir, path.join(stage, BACKUP_PATH));
    removeLegacyActivePaths(stage, plan.archivedPaths);
    ensureCanonicalDirectories(stage);
    for (const [relative, content] of plan.generated) {
      atomicWrite(path.join(stage, relative), content);
    }
    atomicWrite(path.join(stage, ".migration", ".gitignore"), "*\n!.gitignore\n");
    require("../runtime/orchestrator").refreshState(stage);
    const report = reportFor(plan, "applied");
    const manifest = manifestFor(plan);
    atomicWrite(path.join(stage, REPORT_PATH), report);
    atomicWrite(path.join(stage, MANIFEST_PATH), `${JSON.stringify(manifest, null, 2)}\n`);
    const validation = validateStage(stage, plan);
    if (validation.length) throw new Error(`Migration validation failed:\n- ${validation.join("\n- ")}`);
    const currentInventory = inventoryTree(plan.scrumDir);
    if (currentInventory.rootSha256 !== plan.inventory.rootSha256) {
      throw new Error("ScrumRun source changed while migration was being staged; no files were applied.");
    }
    if (failurePoint === "after-staging") throw new Error("Injected migration failure after staging.");
    atomicDirectorySwap(plan.scrumDir, stage, failurePoint);
    return { status: "applied", manifest, report, warnings: plan.warnings };
  } catch (error) {
    cleanup(stage);
    throw error;
  }
}

function rollbackSafetyErrors(scrumDir, manifest) {
  const errors = [];
  const source = new Map(manifest.sourceInventory.files.map((entry) => [entry.path, entry]));
  const generated = new Map(manifest.generated.map((entry) => [entry.path, entry]));
  const archived = new Set(manifest.archivedPaths || []);
  const current = inventoryTree(scrumDir);
  const currentFiles = new Map(current.files.map((entry) => [entry.path, entry]));

  for (const [relative, expected] of source) {
    if (archived.has(relative)) {
      if (currentFiles.has(relative)) errors.push(`archived legacy path was recreated after migration: ${relative}`);
      continue;
    }
    if (generated.has(relative) || relative === ".DS_Store" || relative === "state.md" || relative === "map.md" || relative.startsWith(".cache/")) continue;
    const actual = currentFiles.get(relative);
    if (!actual) {
      errors.push(`legacy source was removed after migration: ${relative}`);
    } else if (actual.sha256 !== expected.sha256 || actual.mode !== expected.mode) {
      errors.push(`legacy source changed after migration: ${relative}`);
    }
  }
  for (const [relative, expected] of generated) {
    const actual = currentFiles.get(relative);
    if (!actual) {
      errors.push(`generated v2 artifact was removed after migration: ${relative}`);
    } else if (actual.sha256 !== expected.sha256) {
      errors.push(`generated v2 artifact changed after migration: ${relative}`);
    }
  }
  for (const relative of currentFiles.keys()) {
    if (relative.startsWith(".migration/") || relative.startsWith(".cache/")) continue;
    if (["map.md", "state.md"].includes(relative) && !source.has(relative) && !generated.has(relative)) continue;
    if (!source.has(relative) && !generated.has(relative)) errors.push(`new post-migration file would be lost: ${relative}`);
  }
  return errors;
}

function rollbackMigration(projectRoot, { failurePoint = null } = {}) {
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const manifestFile = path.join(scrumDir, MANIFEST_PATH);
  if (!fs.existsSync(manifestFile)) throw new Error("No applied v1-to-v2 migration was found.");
  const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
  const backup = path.join(scrumDir, BACKUP_PATH);
  if (!fs.existsSync(backup)) throw new Error("Migration backup is missing; rollback refused.");
  const backupInventory = inventoryTree(backup);
  if (backupInventory.rootSha256 !== manifest.sourceInventory.rootSha256) {
    throw new Error("Migration backup hash mismatch; rollback refused.");
  }
  if (backupInventory.symlinks.length) throw new Error("Migration backup contains unsupported symbolic links; rollback refused.");
  const unsafe = rollbackSafetyErrors(scrumDir, manifest);
  if (unsafe.length) throw new Error(`Rollback refused to avoid losing post-migration changes:\n- ${unsafe.join("\n- ")}`);

  const parent = path.dirname(scrumDir);
  const stage = fs.mkdtempSync(path.join(parent, ".scrumrun-v1-restore-"));
  try {
    cleanup(stage);
    copyTree(backup, stage);
    if (failurePoint === "after-staging") throw new Error("Injected rollback failure after staging.");
    atomicDirectorySwap(scrumDir, stage, failurePoint);
    const restored = inventoryTree(scrumDir);
    if (restored.rootSha256 !== manifest.sourceInventory.rootSha256) {
      throw new Error("Rollback completed but restored fingerprint does not match the source inventory.");
    }
    return { status: "rolled-back", rootSha256: restored.rootSha256 };
  } catch (error) {
    cleanup(stage);
    throw error;
  }
}

function dryRunMigration(projectRoot) {
  const plan = migrationPlan(projectRoot);
  if (plan.alreadyApplied) return { status: "already-applied", manifest: plan.manifest, output: "ScrumRun project is already migrated to method 2.0.0.\n" };
  const output = reportFor(plan, "dry-run");
  return { status: plan.errors.length ? "blocked" : "ready", plan, output };
}

module.exports = {
  BACKUP_PATH,
  MANIFEST_PATH,
  MIGRATION_NAME,
  REPORT_PATH,
  applyMigration,
  dryRunMigration,
  inventoryTree,
  migrationPlan,
  rollbackMigration
};
