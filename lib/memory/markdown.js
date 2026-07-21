"use strict";

function cleanInline(value) {
  return String(value || "")
    .trim()
    .replace(/^`|`$/g, "")
    .replace(/^\[([^\]]+)\]\([^)]*\)$/, "$1")
    .trim();
}

function sectionItems(body, names) {
  const wanted = new Set(names.map((name) => name.toLowerCase()));
  const items = [];
  let active = false;
  for (const line of String(body || "").split(/\r?\n/)) {
    const heading = line.match(/^##\s+(.+?)\s*$/);
    if (heading) {
      const normalized = heading[1].toLowerCase();
      active = [...wanted].some((name) => normalized === name || normalized.startsWith(`${name} `));
      continue;
    }
    if (!active) continue;
    const bullet = line.match(/^\s*-\s+(.+?)\s*$/);
    if (bullet && !/^pending\b/i.test(bullet[1])) items.push(cleanInline(bullet[1]));
  }
  return items;
}

function extractEvidence(body) {
  const evidence = sectionItems(body, ["evidence", "migration provenance"])
    .map((item) => cleanInline(item.replace(/^(?:source|artifact|path):\s*/i, "")))
    .filter((item) => !/^anchor:/i.test(item) && !/^source block sha-256:/i.test(item));
  return [...new Set(evidence)];
}

function extractRelations(body) {
  const relations = [];
  for (const item of sectionItems(body, ["relations"])) {
    const match = item.match(/^([a-z][a-z0-9_]*)\s*(?::|→|->)\s*(.+)$/i);
    if (!match) continue;
    const targets = match[2].split(/\s*,\s*/).map(cleanInline).filter(Boolean);
    for (const target of targets) relations.push({ relation: match[1].toLowerCase(), target });
  }
  return relations;
}

function renderBullets(items, pending) {
  return items.length ? items.map((item) => `- ${item}`).join("\n") : `- Pending: ${pending}`;
}

module.exports = { cleanInline, extractEvidence, extractRelations, renderBullets, sectionItems };
