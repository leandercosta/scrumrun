"use strict";

const fs = require("node:fs");
const path = require("node:path");
const {
  ARTIFACT_TYPES,
  ArtifactRepository,
  METHOD_VERSION,
  assertNoSymlinkPath,
  atomicWrite,
  parseArtifact,
  transitionArtifact,
  validateArtifact,
  withArtifactLock
} = require("../v2/artifacts");
const { extractEvidence, renderBullets } = require("./markdown");
const { assertNoSecret } = require("../security/secrets");

const MEMORY_KINDS = new Set(["knowledge", "decision", "insight", "dossier"]);
const DEFAULT_STATUS = Object.freeze({ knowledge: "candidate", decision: "open", insight: "candidate", dossier: "active" });
const ACTIONS = Object.freeze({
  knowledge: { approve: "approved", reject: "rejected", deprecate: "deprecated", invalidate: "invalidated" },
  decision: { resolve: "resolved", deprecate: "deprecated", invalidate: "invalidated" },
  insight: { confirm: "confirmed", stale: "stale", reject: "invalidated", invalidate: "invalidated", deprecate: "deprecated" },
  dossier: { refresh: "active", stale: "stale", archive: "archived", deprecate: "deprecated" }
});
const CONFIRMED_STATUS = new Set(["approved", "confirmed", "resolved"]);
const ARTIFACT_PREFIX_KIND = Object.freeze(Object.fromEntries(
  Object.entries(ARTIFACT_TYPES).map(([kind, spec]) => [spec.prefix, kind])
));

function today() {
  return new Date().toISOString().slice(0, 10);
}

function oneLine(value, field) {
  const text = String(value || "").trim();
  if (!text) throw new Error(`${field} is required.`);
  if (/\r|\n/.test(text)) throw new Error(`${field} must be one line.`);
  return text;
}

function normalizedList(values, field) {
  if (values === undefined || values === null) return [];
  const list = Array.isArray(values) ? values : [values];
  return [...new Set(list.map((value) => oneLine(value, field)))];
}

function optionalDate(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const text = oneLine(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`${field} must be YYYY-MM-DD.`);
  return text;
}

function nextMemoryId(repository, kind) {
  const prefix = ARTIFACT_TYPES[kind].prefix;
  const highest = repository.list(kind).reduce((max, artifact) => {
    const match = artifact.record && artifact.record.id.match(/-(\d+)$/);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `${prefix}-${String(highest + 1).padStart(3, "0")}`;
}

function assertV2Project(projectRoot) {
  const marker = path.join(projectRoot, ".scrumrun", "method.json");
  if (!fs.existsSync(marker) || !fs.lstatSync(marker).isFile()) throw new Error("Canonical ScrumRun 2.0 method.json is missing.");
  let value;
  try {
    value = JSON.parse(fs.readFileSync(marker, "utf8"));
  } catch {
    throw new Error("Canonical ScrumRun method.json is malformed.");
  }
  if (value.method !== METHOD_VERSION) throw new Error(`Project method must be ${METHOD_VERSION}.`);
}

function currentCommit(projectRoot) {
  const gitDir = path.join(projectRoot, ".git");
  const headFile = path.join(gitDir, "HEAD");
  if (!fs.existsSync(headFile)) return null;
  const head = fs.readFileSync(headFile, "utf8").trim();
  if (/^[a-f0-9]{40,64}$/i.test(head)) return head;
  const ref = head.match(/^ref:\s+(.+)$/);
  if (!ref || ref[1].includes("..")) return null;
  const refFile = path.resolve(gitDir, ref[1]);
  if (!refFile.startsWith(`${path.resolve(gitDir)}${path.sep}`) || !fs.existsSync(refFile)) return null;
  const value = fs.readFileSync(refFile, "utf8").trim();
  return /^[a-f0-9]{40,64}$/i.test(value) ? value : null;
}

function kindForArtifactId(reference) {
  const match = String(reference).match(/^([A-Z]+)-\d{3,}$/);
  return match ? ARTIFACT_PREFIX_KIND[match[1]] || null : null;
}

function evidencePath(reference) {
  return String(reference)
    .replace(/^path:\s*/i, "")
    .replace(/#L\d+(?:-L\d+)?$/i, "")
    .replace(/:\d+(?::\d+)?$/, "");
}

function resolveEvidence(projectRoot, repository, reference) {
  const value = oneLine(reference, "evidence");
  const artifactKind = kindForArtifactId(value);
  if (artifactKind) {
    const artifact = repository.read(artifactKind, value);
    return artifact && !artifact.errors.length
      ? { reference: value, type: "artifact", resolved: true }
      : { reference: value, type: "artifact", resolved: false, reason: "artifact not found or invalid" };
  }

  const relative = evidencePath(value);
  if (path.isAbsolute(relative) || relative.split(/[\\/]+/).includes("..")) {
    return { reference: value, type: "path", resolved: false, reason: "unsafe path" };
  }
  if (/(^|[\\/])vault(?:\.local)?\.md$|(^|[\\/])vault([\\/]|$)/i.test(relative)) {
    return { reference: value, type: "path", resolved: false, reason: "vault evidence is forbidden" };
  }
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, relative);
  const inside = target === root || target.startsWith(`${root}${path.sep}`);
  if (inside) {
    try {
      assertNoSymlinkPath(root, target);
    } catch (error) {
      return { reference: value, type: "path", resolved: false, reason: error.message };
    }
  }
  return {
    reference: value,
    type: "path",
    resolved: inside && fs.existsSync(target),
    reason: inside ? (fs.existsSync(target) ? null : "path not found") : "path escapes project"
  };
}

function assertResolvableEvidence(projectRoot, repository, evidence) {
  if (!evidence.length) throw new Error("Confirmed memory requires at least one evidence reference.");
  const resolution = evidence.map((item) => resolveEvidence(projectRoot, repository, item));
  const unresolved = resolution.filter((item) => !item.resolved);
  if (unresolved.length) {
    throw new Error(`Unresolved evidence: ${unresolved.map((item) => `${item.reference} (${item.reason})`).join(", ")}`);
  }
  return resolution;
}

function createMemoryUnlocked(projectRoot, kind, options = {}) {
  if (!MEMORY_KINDS.has(kind)) throw new Error(`Unsupported memory kind: ${kind}`);
  const scrumDir = path.join(projectRoot, ".scrumrun");
  const repository = new ArtifactRepository(scrumDir);
  const created = today();
  const title = oneLine(options.title || options.content, "title");
  const content = String(options.content || title).trim();
  if (!content) throw new Error("content is required.");
  const evidence = normalizedList(options.evidence, "evidence");
  const relations = normalizedList(options.relations, "relation");
  assertNoSecret([title, content, ...evidence, ...relations]);
  const malformedRelation = relations.find((relation) => !/^[a-z][a-z0-9_]*\s*(?::|→|->)\s*\S/i.test(relation));
  if (malformedRelation) throw new Error(`Malformed relation: ${malformedRelation}. Use relation: target.`);
  const sourceType = oneLine(options.sourceType || "human", "sourceType").toLowerCase();
  const confidence = options.confidence === undefined || options.confidence === null
    ? null
    : Number(options.confidence);
  if (confidence !== null && (!Number.isFinite(confidence) || confidence < 0 || confidence > 1)) {
    throw new Error("confidence must be a number between 0 and 1.");
  }
  const record = {
    id: nextMemoryId(repository, kind),
    kind,
    status: DEFAULT_STATUS[kind],
    created,
    updated: created,
    method: METHOD_VERSION,
    subject_type: options.subjectType ? oneLine(options.subjectType, "subjectType") : null,
    subject_id: options.subjectId ? oneLine(options.subjectId, "subjectId") : null,
    source_type: sourceType,
    source_id: options.sourceId ? oneLine(options.sourceId, "sourceId") : null,
    confidence,
    valid_from: optionalDate(options.validFrom, "validFrom"),
    valid_until: optionalDate(options.validUntil, "validUntil"),
    last_verified_commit: null,
    review_trigger: options.reviewTrigger ? oneLine(options.reviewTrigger, "reviewTrigger") : null
  };
  if (kind === "insight" && sourceType === "ai") record.status = "candidate";
  if (kind === "dossier") assertResolvableEvidence(projectRoot, repository, evidence);
  const body = [
    `# ${title}`,
    "",
    kind === "decision" ? "## Decision" : kind === "dossier" ? "## Scope" : "## Statement",
    "",
    content,
    "",
    "## Evidence",
    "",
    renderBullets(evidence, "confirmation requires resolvable evidence."),
    "",
    "## Relations",
    "",
    renderBullets(relations, "no explicit relations."),
    "",
    "## Lifecycle",
    "",
    `- ${created}: ${record.status} — proposed by ${sourceType}.`
  ].join("\n");
  repository.write(record, body);
  return repository.read(kind, record.id);
}

function createMemory(projectRoot, kind, options = {}) {
  if (!MEMORY_KINDS.has(kind)) throw new Error(`Unsupported memory kind: ${kind}`);
  assertV2Project(projectRoot);
  const scrumDir = path.join(projectRoot, ".scrumrun");
  return withArtifactLock(scrumDir, `memory-${kind}`, () => createMemoryUnlocked(projectRoot, kind, options));
}

function setFrontmatter(content, updates) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/);
  if (!match) throw new Error("Memory artifact has malformed frontmatter.");
  let frontmatter = match[1];
  for (const [field, value] of Object.entries(updates)) {
    const rendered = value === null ? "null" : String(value);
    const line = new RegExp(`^${field}:\\s*.*$`, "m");
    frontmatter = line.test(frontmatter)
      ? frontmatter.replace(line, `${field}: ${rendered}`)
      : `${frontmatter}\n${field}: ${rendered}`;
  }
  return `---\n${frontmatter}\n---${match[2]}`;
}

function transitionMemoryUnlocked(projectRoot, kind, id, action, options = {}) {
  if (!MEMORY_KINDS.has(kind)) throw new Error(`Unsupported memory kind: ${kind}`);
  const nextStatus = ACTIONS[kind] && ACTIONS[kind][action];
  if (!nextStatus) throw new Error(`Unsupported ${kind} action: ${action}`);
  const repository = new ArtifactRepository(path.join(projectRoot, ".scrumrun"));
  const artifact = repository.read(kind, id);
  if (!artifact) throw new Error(`${id} not found.`);
  if (artifact.errors.length) throw new Error(`Invalid ${id}: ${artifact.errors.join("; ")}`);
  const addedEvidence = normalizedList(options.evidence, "evidence");
  assertNoSecret([options.note || "", ...addedEvidence]);
  const allEvidence = [...new Set([...extractEvidence(artifact.body), ...addedEvidence])];
  if (CONFIRMED_STATUS.has(nextStatus)) assertResolvableEvidence(projectRoot, repository, allEvidence);

  const date = today();
  const refreshInPlace = kind === "dossier" && action === "refresh" && artifact.record.status === "active";
  if (!refreshInPlace) transitionArtifact(artifact.record, nextStatus, date);
  const previous = fs.readFileSync(artifact.file, "utf8");
  const verified = CONFIRMED_STATUS.has(nextStatus) || action === "refresh";
  const commit = verified ? currentCommit(projectRoot) : artifact.record.last_verified_commit;
  let next = setFrontmatter(previous, {
    status: nextStatus,
    updated: date,
    ...(verified ? { last_verified_commit: commit || "unavailable" } : {})
  });
  const note = options.note ? oneLine(options.note, "note") : `${action} requested through ScrumRun.`;
  const review = [
    "",
    `## Memory Review ${date} · ${action}`,
    "",
    `- Transition: ${refreshInPlace ? `${nextStatus} (refreshed)` : `${artifact.record.status} → ${nextStatus}`}`,
    `- Note: ${note}`
  ].join("\n");
  const evidenceReview = addedEvidence.length
    ? `\n\n## Evidence ${date} · ${action}\n\n${renderBullets(addedEvidence, "none.")}`
    : "";
  next = `${next.trimEnd()}\n${review}${evidenceReview}\n`;
  const parsed = parseArtifact(next);
  const errors = [...parsed.errors, ...validateArtifact(parsed.record, kind)];
  if (errors.length) throw new Error(`Memory transition validation failed: ${errors.join("; ")}`);
  atomicWrite(artifact.file, next);
  return repository.read(kind, id);
}

function transitionMemory(projectRoot, kind, id, action, options = {}) {
  if (!MEMORY_KINDS.has(kind)) throw new Error(`Unsupported memory kind: ${kind}`);
  assertV2Project(projectRoot);
  return withArtifactLock(path.join(projectRoot, ".scrumrun"), `memory-${kind}`, () => transitionMemoryUnlocked(projectRoot, kind, id, action, options));
}

function listMemory(projectRoot, kind, { includeInactive = true } = {}) {
  if (!MEMORY_KINDS.has(kind)) throw new Error(`Unsupported memory kind: ${kind}`);
  const excluded = new Set(["rejected", "invalidated", "deprecated", "archived"]);
  return new ArtifactRepository(path.join(projectRoot, ".scrumrun")).list(kind)
    .filter((artifact) => includeInactive || !excluded.has(artifact.record.status));
}

function showMemory(projectRoot, kind, id) {
  if (!MEMORY_KINDS.has(kind)) throw new Error(`Unsupported memory kind: ${kind}`);
  return new ArtifactRepository(path.join(projectRoot, ".scrumrun")).read(kind, id);
}

module.exports = {
  ACTIONS,
  assertV2Project,
  createMemory,
  listMemory,
  resolveEvidence,
  showMemory,
  transitionMemory
};
