const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { LanguageAdapter } = require("../lib/code-intel/adapter");
const { scanProject } = require("../lib/code-intel/scanner");
const { graphIndex, queryIndex, rebuildIndex } = require("../lib/memory/index");
const { createMemory, transitionMemory } = require("../lib/memory/service");
const { ArtifactRepository, METHOD_VERSION } = require("../lib/v2/artifacts");
const { transitionRun } = require("../lib/runtime/orchestrator");
const { appendRunEvent, createRunBody } = require("../lib/runtime/run-ledger");

function write(root, relative, content) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "scrumrun-code-intel-"));
  write(root, ".scrumrun/method.json", `${JSON.stringify({ method: METHOD_VERSION })}\n`);
  write(root, "src/pricing/tax.ts", "export class TaxCalculator { calculate(value: number) { return value * 0.2; } }\n");
  write(root, "src/pricing/calculate-final-price.ts", `import { TaxCalculator } from "./tax";
export function calculateFinalPrice(value: number) {
  return value + new TaxCalculator().calculate(value);
}
`);
  write(root, "src/orders/order-service.ts", `import { calculateFinalPrice } from "../pricing/calculate-final-price";
export class OrderService { total(value: number) { return calculateFinalPrice(value); } }
`);
  write(root, "src/quotation/quotation-service.ts", `import { calculateFinalPrice } from "../pricing/calculate-final-price";
export function quote(value: number) { return calculateFinalPrice(value); }
`);
  write(root, "tests/price-calculation.spec.ts", `import { calculateFinalPrice } from "../src/pricing/calculate-final-price";
test("price", () => calculateFinalPrice(100));
`);
  return root;
}

test("language adapters are replaceable and the JS/TS adapter emits qualified identities", () => {
  const root = fixture();
  const scan = scanProject(root);
  const symbol = scan.nodes.find((node) => node.name === "calculateFinalPrice");
  assert.ok(symbol.id.startsWith("symbol:src/pricing/calculate-final-price.ts#function:"));
  assert.equal(symbol.path, "src/pricing/calculate-final-price.ts");
  assert.equal(symbol.kind, "function");
  assert.equal(symbol.line, 2);
  assert.equal(symbol.fingerprint.length, 64);
  assert.equal(symbol.language, "javascript-typescript");
  assert.ok(scan.edges.some((edge) => edge.from === symbol.id && edge.relation === "defined_in" && edge.to === "module:src/pricing/calculate-final-price.ts"));
  assert.ok(scan.edges.some((edge) => edge.from === symbol.id && edge.relation === "depends_on" && edge.to === "module:src/pricing/tax.ts"));
  assert.ok(scan.edges.some((edge) => edge.from === symbol.id && edge.relation === "used_by" && edge.to === "module:src/orders/order-service.ts"));
  assert.ok(scan.edges.some((edge) => edge.from === symbol.id && edge.relation === "protected_by" && edge.to === "test:tests/price-calculation.spec.ts"));

  class TextAdapter extends LanguageAdapter {
    constructor() { super({ id: "text-fixture", extensions: [".txt"] }); }
    scan({ relative }) {
      return { module: { id: `module:${relative}`, name: relative, qualifiedName: relative, kind: "module", path: relative, line: 1, fingerprint: "x", commit: null, exported: true, language: this.id }, symbols: [], dependencies: [], masked: "" };
    }
  }
  write(root, "custom.txt", "custom");
  const custom = scanProject(root, { adapters: [new TextAdapter()] });
  assert.deepEqual(custom.adapterIds, ["text-fixture"]);
  assert.ok(custom.nodes.some((node) => node.id === "module:custom.txt"));
});

test("semantic retrieval joins rationale, decisions, dependents, tests, and blast-radius evidence", () => {
  const root = fixture();
  const decision = createMemory(root, "decision", {
    title: "Commercial calculations stay in the backend",
    evidence: ["src/pricing/calculate-final-price.ts"],
    subjectType: "symbol",
    subjectId: "function:calculateFinalPrice"
  });
  transitionMemory(root, "decision", decision.record.id, "resolve");
  const insight = createMemory(root, "insight", {
    title: "Pricing placement rationale",
    content: "The function remains in pricing because orders and quotations consume it before checkout.",
    evidence: [decision.record.id, "src/orders/order-service.ts", "src/quotation/quotation-service.ts"],
    relations: [`constrained_by: ${decision.record.id}`],
    subjectType: "symbol",
    subjectId: "function:calculateFinalPrice"
  });
  transitionMemory(root, "insight", insight.record.id, "confirm");

  rebuildIndex(root);
  const result = queryIndex(root, "calculateFinalPrice", { limit: 20, rebuild: false });
  const code = result.results.find((item) => item.id.includes("calculate-final-price.ts#function"));
  const rationale = result.results.find((item) => item.id === insight.record.id);
  assert.ok(code);
  assert.ok(rationale);
  assert.equal(rationale.truth, "confirmed");
  assert.ok(rationale.relations.some((edge) => edge.relation === "constrained_by" && edge.to_id === decision.record.id));
  assert.ok(code.relations.some((edge) => edge.relation === "used_by" && edge.to_id.includes("order-service")));
  assert.ok(code.relations.some((edge) => edge.relation === "used_by" && edge.to_id.includes("quotation-service")));
  assert.ok(code.relations.some((edge) => edge.relation === "protected_by" && edge.to_id.includes("price-calculation.spec")));
});

test("moves remap by fingerprint while renames remain explicit orphan history", () => {
  const root = fixture();
  rebuildIndex(root);
  const oldId = "symbol:src/pricing/calculate-final-price.ts#function:calculateFinalPrice";
  const movedPath = path.join(root, "src", "domain", "calculate-final-price.ts");
  fs.mkdirSync(path.dirname(movedPath), { recursive: true });
  fs.renameSync(path.join(root, "src", "pricing", "calculate-final-price.ts"), movedPath);
  rebuildIndex(root);
  let graph = graphIndex(root, { rebuild: false });
  const moved = graph.nodes.find((node) => node.id === "symbol:src/domain/calculate-final-price.ts#function:calculateFinalPrice");
  assert.equal(moved.remapped_from, oldId);
  assert.equal(graph.nodes.some((node) => node.id === oldId && node.status === "orphaned"), false);

  const content = fs.readFileSync(movedPath, "utf8").replaceAll("calculateFinalPrice", "calculatePrice");
  fs.writeFileSync(movedPath, content);
  rebuildIndex(root);
  graph = graphIndex(root, { rebuild: false });
  assert.ok(graph.nodes.some((node) => node.id.endsWith("#function:calculatePrice") && node.status === "current"));
  assert.ok(graph.nodes.some((node) => node.id.endsWith("#function:calculateFinalPrice") && node.status === "orphaned"));
  rebuildIndex(root);
  graph = graphIndex(root, { rebuild: false });
  assert.ok(graph.nodes.some((node) => node.id.endsWith("#function:calculateFinalPrice") && node.status === "orphaned"), "orphan history survives another rebuild");
});

test("code and evidence changes make linked memory stale only in the projection", () => {
  const root = fixture();
  const insight = createMemory(root, "insight", {
    title: "Pricing behavior",
    evidence: ["src/pricing/calculate-final-price.ts"],
    subjectType: "symbol",
    subjectId: "function:calculateFinalPrice"
  });
  transitionMemory(root, "insight", insight.record.id, "confirm");
  rebuildIndex(root);
  const file = path.join(root, "src", "pricing", "calculate-final-price.ts");
  fs.writeFileSync(file, fs.readFileSync(file, "utf8").replace("return value +", "return Math.round(value) +"));
  rebuildIndex(root);

  const result = queryIndex(root, "Pricing behavior", { rebuild: false });
  assert.equal(result.results[0].truth, "stale");
  assert.ok(result.results[0].invalidations.some((item) => /Evidence changed/.test(item.reason)));
  assert.ok(result.results[0].invalidations.some((item) => /implementation changed/.test(item.reason)));
  const canonical = new ArtifactRepository(path.join(root, ".scrumrun")).read("insight", insight.record.id);
  assert.equal(canonical.record.status, "confirmed", "derived invalidation never silently rewrites Markdown");
});

test("post-validation extraction creates candidate insights and never blocks learning", () => {
  const root = fixture();
  const repository = new ArtifactRepository(path.join(root, ".scrumrun"));
  const common = { created: "2026-07-21", updated: "2026-07-21", method: METHOD_VERSION };
  repository.write({ ...common, id: "TASK-001", kind: "task", type: "feature", status: "validating" }, "# Validate pricing");
  const executing = { ...common, id: "RUN-001", kind: "run", status: "executing", task: "TASK-001", attempt: 1, ledger: 1 };
  const validating = { ...executing, status: "validating" };
  const initialBody = createRunBody(executing, { title: "Pricing run", occurredAt: "2026-07-21T08:00:00.000Z" }).body;
  const validatingBody = appendRunEvent(executing, initialBody, validating, {
    note: "Pricing validation passed.",
    occurredAt: "2026-07-21T09:00:00.000Z"
  }).body;
  repository.write(validating, `${validatingBody}

## Learning Candidates

- [placement_rationale] function:calculateFinalPrice | Keep pricing in the domain because quotations use it. | evidence: src/quotation/quotation-service.ts | relations: used_by=module:src/quotation/quotation-service.ts
- malformed candidate that must not block the Run
`);

  const result = transitionRun(root, "RUN-001", "learning", { note: "Candidate extraction reviewed." });
  assert.equal(result.run.status, "learning");
  assert.deepEqual(result.learning.created, ["INS-001"]);
  assert.equal(result.learning.warnings.length, 1);
  const candidate = repository.read("insight", "INS-001");
  assert.equal(candidate.record.status, "candidate");
  assert.equal(candidate.record.source_id, "RUN-001");
  assert.match(candidate.body, /RUN-001/);
});
