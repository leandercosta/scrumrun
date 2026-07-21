"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { LanguageAdapter } = require("./adapter");
const { sha256 } = require("../v2/artifacts");

function posix(value) {
  return value.split(path.sep).join("/");
}

function maskSource(source) {
  const chars = [...source];
  let state = "code";
  let escaped = false;
  for (let index = 0; index < chars.length; index++) {
    const char = chars[index];
    const next = chars[index + 1];
    if (state === "line") {
      if (char === "\n") state = "code";
      else chars[index] = " ";
      continue;
    }
    if (state === "block") {
      if (char === "*" && next === "/") {
        chars[index] = chars[index + 1] = " ";
        index++;
        state = "code";
      } else if (char !== "\n") chars[index] = " ";
      continue;
    }
    if (["single", "double", "template"].includes(state)) {
      if (char !== "\n") chars[index] = " ";
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if ((state === "single" && char === "'") || (state === "double" && char === '"') || (state === "template" && char === "`")) {
        state = "code";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      chars[index] = chars[index + 1] = " ";
      index++;
      state = "line";
    } else if (char === "/" && next === "*") {
      chars[index] = chars[index + 1] = " ";
      index++;
      state = "block";
    } else if (char === "'") {
      chars[index] = " ";
      state = "single";
    } else if (char === '"') {
      chars[index] = " ";
      state = "double";
    } else if (char === "`") {
      chars[index] = " ";
      state = "template";
    }
  }
  return chars.join("");
}

function closingBrace(masked, open) {
  if (open < 0 || masked[open] !== "{") return -1;
  let depth = 0;
  for (let index = open; index < masked.length; index++) {
    if (masked[index] === "{") depth++;
    else if (masked[index] === "}" && --depth === 0) return index + 1;
  }
  return -1;
}

function declarationEnd(masked, start) {
  const open = masked.indexOf("{", start);
  const semicolon = masked.indexOf(";", start);
  if (open >= 0 && (semicolon < 0 || open < semicolon)) {
    const close = closingBrace(masked, open);
    if (close >= 0) return close;
  }
  const newline = masked.indexOf("\n", start);
  return semicolon >= 0 ? semicolon + 1 : newline >= 0 ? newline : masked.length;
}

function lineAt(source, index) {
  return source.slice(0, index).split("\n").length;
}

function declarations(source) {
  const masked = maskSource(source);
  const patterns = [
    { kind: "function", regex: /\b(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)\s*\(/g },
    { kind: "class", regex: /\b(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)\b/g },
    { kind: "interface", regex: /\b(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)\b/g },
    { kind: "type", regex: /\b(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*(?:<[^;=]+>)?\s*=/g },
    { kind: "enum", regex: /\b(?:export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)\b/g },
    { kind: "function", regex: /\b(?:export\s+(?:default\s+)?)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=;]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/g }
  ];
  const found = [];
  const seen = new Set();
  for (const pattern of patterns) {
    pattern.regex.lastIndex = 0;
    let match;
    while ((match = pattern.regex.exec(masked))) {
      const key = `${match.index}:${match[1]}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const end = declarationEnd(masked, match.index);
      const normalized = masked.slice(match.index, end).replace(/\s+/g, " ").trim();
      found.push({
        name: match[1],
        kind: pattern.kind,
        line: lineAt(source, match.index),
        start: match.index,
        end,
        exported: /^\s*export\b/.test(masked.slice(Math.max(0, match.index - 20), match.index + 20)) || /\bexport\b/.test(match[0]),
        fingerprint: sha256(`${pattern.kind}\0${normalized}`)
      });
    }
  }
  return { masked, declarations: found.sort((a, b) => a.start - b.start) };
}

function importSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /^\s*(?:import|export)\s+(?:[^"'\n]*?\s+from\s+)?["']([^"']+)["']/gm,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g
  ];
  for (const regex of patterns) {
    let match;
    while ((match = regex.exec(source))) specifiers.add(match[1]);
  }
  return [...specifiers].sort();
}

function resolveImport(projectRoot, sourceFile, specifier) {
  if (!specifier.startsWith(".")) return `package:${specifier}`;
  const base = path.resolve(path.dirname(sourceFile), specifier);
  const candidates = [
    base,
    ...[".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"].map((extension) => `${base}${extension}`),
    ...[".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"].map((extension) => path.join(base, `index${extension}`))
  ];
  const target = candidates.find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  if (!target) return `module:${posix(path.relative(projectRoot, base))}`;
  return `module:${posix(path.relative(projectRoot, target))}`;
}

class JavaScriptAdapter extends LanguageAdapter {
  constructor() {
    super({ id: "javascript-typescript", extensions: [".js", ".jsx", ".mjs", ".cjs", ".ts", ".tsx"] });
  }

  scan({ projectRoot, file, relative, commit }) {
    const source = fs.readFileSync(file, "utf8");
    const parsed = declarations(source);
    const moduleId = `module:${posix(relative)}`;
    const dependencies = importSpecifiers(source).map((specifier) => ({
      specifier,
      target: resolveImport(projectRoot, file, specifier)
    }));
    const symbols = parsed.declarations.map((declaration) => ({
      id: `symbol:${posix(relative)}#${declaration.kind}:${declaration.name}`,
      name: declaration.name,
      qualifiedName: `${posix(relative)}#${declaration.kind}:${declaration.name}`,
      kind: declaration.kind,
      path: posix(relative),
      line: declaration.line,
      fingerprint: declaration.fingerprint,
      commit,
      exported: declaration.exported,
      language: this.id,
      start: declaration.start,
      end: declaration.end
    }));
    return {
      module: {
        id: moduleId,
        name: posix(relative),
        qualifiedName: posix(relative),
        kind: "module",
        path: posix(relative),
        line: 1,
        fingerprint: sha256(source),
        commit,
        exported: true,
        language: this.id
      },
      symbols,
      dependencies,
      masked: parsed.masked
    };
  }
}

module.exports = { JavaScriptAdapter, declarations, importSpecifiers, maskSource, resolveImport };
