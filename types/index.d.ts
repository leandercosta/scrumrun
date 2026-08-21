// Type declarations for ScrumRun public library API.
//
// These types cover the modules that library consumers import
// directly from `lib/`. CLI-only helpers in `bin/scrumrun.js` are
// not typed here; they are an internal entry point.

// ---------------------------------------------------------------------------
// lib/v2/schema
// ---------------------------------------------------------------------------

export type ArtifactKind =
  | "feature"
  | "task"
  | "sprint"
  | "run"
  | "review"
  | "knowledge"
  | "decision"
  | "insight"
  | "dossier";

export type ArtifactStatus =
  | "backlog" | "proposed" | "active" | "completed" | "paused" | "cancelled"
  | "running" | "validating" | "learning" | "partial" | "failed" | "blocked"
  | "candidate" | "approved" | "rejected" | "deprecated" | "invalidated"
  | "open" | "resolved" | "confirmed" | "stale" | "archived" | "executing" | "passed";

export interface ArtifactTypeDef {
  prefix: string;
  directory: string;
  initial: string[];
  statuses: string[];
}

export type ArtifactTypeMap = Record<ArtifactKind, ArtifactTypeDef>;

export interface StructuralRelation {
  targetKind: ArtifactKind;
  cardinality: string;
  requiredFor?: ArtifactKind[];
  meaning: string;
}

export interface ScalarFieldDef {
  kinds: ArtifactKind[];
  required: boolean;
  type: string;
  meaning: string;
}

export interface TruthOwnershipDef {
  question: string;
  truth: string;
}

export interface AuthorityDef {
  source: string;
  scope: string;
}

export const METHOD_VERSION: "2.0.0";
export const RUN_LEDGER_VERSION: 1;
export const RUN_EVENT_TYPES: readonly string[];
export const RUN_EVIDENCE_KINDS: readonly string[];
export const GUARDRAIL_RESULTS: readonly string[];
export const ARTIFACT_TYPES: ArtifactTypeMap;
export const ARTIFACT_TRANSITIONS: Readonly<Record<ArtifactKind, Readonly<Record<string, readonly string[]>>>>;
export const STRUCTURAL_RELATIONS: Readonly<Record<string, StructuralRelation>>;
export const SCALAR_FIELDS: Readonly<Record<string, ScalarFieldDef>>;
export const TRUTH_OWNERSHIP: Readonly<Record<ArtifactKind, TruthOwnershipDef>>;
export const AUTHORITY: Readonly<Record<string, AuthorityDef>>;
export function deepFreeze<T>(value: T): T;

// ---------------------------------------------------------------------------
// lib/v2/artifacts
// ---------------------------------------------------------------------------

export interface ArtifactRecord {
  id: string;
  kind: ArtifactKind;
  status: string;
  created: string;
  updated: string;
  method: string;
  type?: string;
  feature?: string | null;
  sprint?: string | null;
  task?: string | null;
  attempt?: number;
  ledger?: number;
  guardrails?: number;
  workspace?: number;
  approval_id?: string | null;
  context_fingerprint?: string;
  risk?: string;
  assignee?: string | null;
  [key: string]: unknown;
}

export interface ParsedArtifact {
  record: ArtifactRecord | null;
  body: string;
  errors: string[];
}

export interface WriteResult {
  status: "written" | "unchanged";
  file: string;
  hash: string;
}

export interface GraphNode {
  id: string;
  kind: ArtifactKind;
  status: string;
}

export interface GraphEdge {
  from: string;
  relation: string;
  to: string;
}

export interface ArtifactGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export class ArtifactRepository {
  constructor(scrumDir: string);
  readonly scrumDir: string;
  pathFor(record: { kind: ArtifactKind; id: string }): string;
  write(record: ArtifactRecord, body?: string, options?: { overwrite?: boolean }): WriteResult;
  read(kind: ArtifactKind, id: string): (ParsedArtifact & { file: string }) | null;
  transition(kind: ArtifactKind, id: string, nextStatus: string, updated: string): WriteResult & { record: ArtifactRecord };
  list(kind: ArtifactKind): Array<ParsedArtifact & { file: string }>;
  graph(): ArtifactGraph;
}

export function sha256(content: string | Buffer): string;
export function serializeArtifact(record: ArtifactRecord, body?: string): string;
export function parseArtifact(content: string): ParsedArtifact;
export function validateArtifact(record: ArtifactRecord | null, expectedKind?: ArtifactKind | null): string[];
export function transitionArtifact(record: ArtifactRecord, nextStatus: string, updated: string): ArtifactRecord;
export function relativeArtifactPath(record: { kind: ArtifactKind; id: string }): string;
export function safePath(root: string, relative: string): string;
export function assertNoSymlinkPath(root: string, target: string): string;
export function atomicWrite(file: string, content: string): void;
export function graphFromRecords(records: ArtifactRecord[]): ArtifactGraph;
export function withArtifactLock<T>(scrumDir: string, name: string, operation: () => T, options?: { timeoutMs?: number; staleMs?: number }): T;

// ---------------------------------------------------------------------------
// lib/v2/conformance
// ---------------------------------------------------------------------------

export type FindingSeverity = "critical" | "high" | "warning";

export interface Finding {
  severity: FindingSeverity;
  code: string;
  message: string;
  file?: string;
}

export interface InvariantDef {
  id: string;
  summary: string;
  tests: string[];
}

export interface AuditResult {
  method: string;
  passed: boolean;
  findings: Finding[];
  counts: Record<string, number>;
  invariants: number;
}

export const INVARIANTS: readonly InvariantDef[];
export function auditProject(projectRoot: string): AuditResult;

// ---------------------------------------------------------------------------
// lib/v2/paths
// ---------------------------------------------------------------------------

export const PATHS_SCHEMA_VERSION: 1;
export const CANONICAL_PATHS: Record<string, unknown>;
export function canonicalPaths(): Record<string, unknown>;
export function flattenPaths(paths?: Record<string, unknown>): Array<{ path: string; key: string }>;
export function renderMethodJson(options?: { method?: string; schemas?: Record<string, number>; paths?: Record<string, unknown> }): string;

// ---------------------------------------------------------------------------
// lib/v2/transaction
// ---------------------------------------------------------------------------

export const TRANSACTION_SCHEMA: 1;

export interface TransactionFileChange {
  relative: string;
  from: string;
  to: string;
}

export interface PendingTransaction {
  id: string;
  status: string;
  action: string;
  name?: string;
  warnings: string[];
  files: TransactionFileChange[];
}

export interface PendingTransactionStatus {
  error: string | null;
  pending: Array<{ id: string; name: string; status: string }>;
}

export interface RecoveryResult {
  id: string;
  action: string;
}

export interface FileOperation {
  file: string;
  previous: string | null;
  next: string;
}

export function runKernelTransaction(
  scrumDir: string,
  name: string,
  operations: FileOperation[],
  options?: { failurePoint?: string | null; interruptPoint?: string | null }
): void;
export function recoverPendingTransactions(scrumDir: string): RecoveryResult[];
export function recoverPendingTransactionsUnlocked(scrumDir: string): RecoveryResult[];
export function previewPendingRecovery(scrumDir: string): { plans: PendingTransaction[]; errors: string[] };
export function pendingTransactionStatus(scrumDir: string): PendingTransactionStatus;
export function writeKernelTransactionUnlocked(
  scrumDir: string,
  name: string,
  operations: FileOperation[],
  options?: { failurePoint?: string | null; interruptPoint?: string | null }
): void;

// ---------------------------------------------------------------------------
// lib/v2/migration
// ---------------------------------------------------------------------------

export interface MigrationPlan {
  errors: string[];
  [key: string]: unknown;
}

export interface DryRunResult {
  status: string;
  output: string;
  plan: MigrationPlan;
}

export interface ApplyResult {
  status: string;
  manifest: {
    sourceInventory: { rootSha256: string };
    generated: unknown[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RollbackResult {
  rootSha256: string;
  [key: string]: unknown;
}

export function dryRunMigration(projectRoot: string): DryRunResult;
export function applyMigration(projectRoot: string, options?: { plan?: MigrationPlan }): ApplyResult;
export function rollbackMigration(projectRoot: string): RollbackResult;
export function migrationPlan(projectRoot: string): MigrationPlan;
export function inventoryTree(projectRoot: string): unknown;

// ---------------------------------------------------------------------------
// lib/runtime/request-engine
// ---------------------------------------------------------------------------

export interface RiskAssessment {
  level: "low" | "medium" | "high";
  reasons: string[];
}

export interface Classification {
  type: string;
  taskType: string;
  reason: string;
}

export interface GuardrailEvaluation {
  guardrail: string;
  status: "passed" | "blocked" | "deferred";
  code: string;
  message: string;
  enforcement: string;
  scope: string[];
  evidence: string[];
}

export interface PolicyResult {
  status: "passed" | "blocked";
  checked: string[];
  deferred: string[];
  obligations: Array<{
    guardrail: string;
    code: string;
    enforcement: string;
    scope: string[];
    gate: string;
  }>;
  evaluations: GuardrailEvaluation[];
  violations: string[];
}

export interface ContextPackage {
  fingerprint: string;
  request: string;
  warnings: string[];
  guardrails: unknown[];
  config: string;
  layout: string;
  [key: string]: unknown;
}

export interface IntakePlan {
  state: "awaiting_approval" | "blocked";
  pipeline: string[];
  request: string;
  context: ContextPackage;
  workspaceFingerprint: string;
  policy: PolicyResult;
  risk: RiskAssessment;
  classification: Classification;
  preview: string | null;
  proposal: {
    create: string[];
    sprint: string | null;
    validation: string;
  };
  issuedAt: string;
  approvalToken: string | null;
}

export function planRequest(projectRoot: string, request: string, options?: { typeOverride?: string | null; preview?: string | null }): IntakePlan;
export function assessRisk(request: string): RiskAssessment;
export function classifyRequest(request: string): Classification;
export function applyPolicy(context: ContextPackage): PolicyResult;
export function encodeApproval(plan: IntakePlan): string;
export function decodeApproval(token: string): {
  schema: 1;
  method: string;
  request: string;
  fingerprint: string;
  classification: Classification;
  risk: RiskAssessment;
  policy: PolicyResult;
  workspaceFingerprint: string;
  preview: string | null;
  issuedAt: string;
};
export function stableJson(value: unknown): string;

// ---------------------------------------------------------------------------
// lib/runtime/orchestrator
// ---------------------------------------------------------------------------

export interface StateProjection {
  content: string;
  sourceFingerprint: string;
  watchFingerprint: string;
  sourceFiles: unknown[];
}

export function approveRequest(projectRoot: string, token: string, options?: { failurePoint?: string | null; interruptPoint?: string | null }): { status: string; task: ArtifactRecord; run: ArtifactRecord };
export function transitionRun(projectRoot: string, runId: string, nextStatus: string, options?: {
  note?: string | null;
  evidence?: Array<{ kind: string; ref?: string; summary?: string }>;
  actor?: string;
  occurredAt?: string | null;
  summary?: string | null;
  failurePoint?: string | null;
  interruptPoint?: string | null;
}): { run: ArtifactRecord; task: ArtifactRecord; learning: { created: string[]; warnings: string[] } | null; recovered?: unknown[] };
export function retryTask(projectRoot: string, taskId: string, options?: { note?: string; failurePoint?: string | null; interruptPoint?: string | null }): { run: ArtifactRecord; task: ArtifactRecord; content: string; recovered?: unknown[] };
export function startBacklogTask(projectRoot: string, taskId: string, options?: { note?: string; failurePoint?: string | null; interruptPoint?: string | null }): { run: ArtifactRecord; task: ArtifactRecord; content: string; recovered?: unknown[] };
export function nextBacklogTask(repository: ArtifactRepository): ArtifactRecord | null;
export function refreshState(scrumDir: string): StateProjection;
export function renderState(repository: ArtifactRepository): string;
export function stateFingerprint(repository: ArtifactRepository): string;
export function stateIsStale(scrumDir: string): boolean;
export function nextId(repository: ArtifactRepository, kind: ArtifactKind): string;

// ---------------------------------------------------------------------------
// lib/runtime/mutation-gateway
// ---------------------------------------------------------------------------

export const PERMIT_SCHEMA: 1;

export interface MutationPermit {
  schema: 1;
  id: string;
  run: string;
  created_at: string;
  expires_at: string;
  policy_fingerprint: string;
  workspace_before: unknown;
  allowed_paths: string[];
  integrity: string;
}

export interface MutationResult {
  run: ArtifactRecord;
  mutation: string;
  changes: unknown[];
}

export interface PolicyState {
  file: string;
  content: string;
  config: string;
  fingerprint: string;
  guardrails: unknown[];
}

export interface WorkspaceState {
  mode: string;
  head: string | null;
  fingerprint: string;
  files: Array<{ path: string; sha256: string; kind: string; mode: number; scan: string }>;
}

export function authorizeMutation(projectRoot: string, runId: string, paths: string[], options?: { ttlMs?: number }): { permit: string; run: string; expiresAt: string; paths: string[] };
export function recordMutation(projectRoot: string, runId: string, permitId: string, options?: {
  note?: string | null;
  evidence?: Array<{ kind: string; ref?: string; summary?: string }>;
  actor?: string;
  occurredAt?: string | null;
}): MutationResult;
export function satisfyGuardrail(projectRoot: string, runId: string, guardrailId: string, options?: {
  note?: string | null;
  evidence?: Array<{ kind: string; ref?: string; summary?: string }>;
  actor?: string;
  occurredAt?: string | null;
}): { run: ArtifactRecord; guardrail: string; status: string };
export function policyState(projectRoot: string): PolicyState;
export function workspaceState(projectRoot: string): WorkspaceState;
export function publicWorkspace(value: WorkspaceState): unknown;
export function verifyWorkspaceIntegrity(projectRoot: string, runArtifact: { record: ArtifactRecord; body: string }): { status: string; fingerprint: string | null; policy?: string };
export function assertCompletionAllowed(projectRoot: string, runArtifact: { record: ArtifactRecord; body: string }): { status: string; policy?: string };
export function prepareCompletion(projectRoot: string, runArtifact: { record: ArtifactRecord; body: string }, options?: { occurredAt?: string | null }): { record: ArtifactRecord; body: string; resolved: string[]; status: string };
export function auditActiveWorkspace(projectRoot: string, runArtifact: { record: ArtifactRecord; body: string }): string | null;
export function assertCanonicalWrite(projectRoot: string, operation: string, contents?: string[]): { operation: string; policy: string };
export function expectedWorkspace(runArtifact: { record: ArtifactRecord; body: string }): unknown;

// ---------------------------------------------------------------------------
// lib/runtime/policy-engine
// ---------------------------------------------------------------------------

export interface GuardrailRecord {
  id: string;
  title: string;
  rule: string;
  status: string;
  enforcement: string;
  scope: string[];
  source: string | null;
  explicit: { status: boolean; enforcement: boolean; scope: boolean; rule: boolean };
}

export function parseGuardrails(content: string): GuardrailRecord[];
export function validateGuardrailDocument(content: string): { records: GuardrailRecord[]; errors: string[] };
export function evaluatePolicy(context: ContextPackage): PolicyResult;
export function normalizeGuardrailDocument(content: string): string;
export function configWeakeningAttempts(content: string): string[];
export function readOnlyPaths(content: string): string[];
export function obligationGate(evaluation: { scope?: string[]; enforcement: string }): string;
export function inferEnforcement(title: string, rule: string): string;
export function normalized(value: string): string;
export function agentIdentity(scrumDir: string): string | null;

// ---------------------------------------------------------------------------
// lib/runtime/run-ledger
// ---------------------------------------------------------------------------

export interface RunEvent {
  id: string;
  type: "transition" | "snapshot" | "guardrail" | "mutation";
  sequence: number;
  occurred_at: string;
  actor: string;
  from?: string;
  to?: string;
  reason?: string;
  evidence?: Array<{ kind: string; ref?: string; summary?: string }>;
  [key: string]: unknown;
}

export interface ParsedLedger {
  events: RunEvent[];
  errors: string[];
}

export interface GuardrailObligation {
  guardrail: string;
  status: string;
  enforcement: string;
  gate: string;
  scope: string[];
  code: string;
}

export function parseRunLedger(body: string): ParsedLedger;
export function validateRunLedger(record: ArtifactRecord, body: string): ParsedLedger;
export function appendRunEvent(record: ArtifactRecord, body: string, nextRecord: ArtifactRecord, options: {
  note?: string | null;
  evidence?: Array<{ kind: string; ref?: string; summary?: string }>;
  actor?: string;
  occurredAt?: string | null;
}): { record: ArtifactRecord; body: string; event: RunEvent };
export function createRunBody(run: ArtifactRecord, options: {
  approvalId?: string | null;
  obligations?: unknown[];
  policyFingerprint?: string;
  workspaceBaseline?: unknown;
  title?: string;
  actor?: string;
  reason?: string;
  evidence?: Array<{ kind: string; ref?: string; summary?: string }>;
}): { body: string; event: RunEvent };
export function appendGuardrailEvent(record: ArtifactRecord, body: string, obligation: GuardrailObligation, status: string, options: {
  note?: string | null;
  evidence?: Array<{ kind: string; ref?: string; summary?: string }>;
  actor?: string;
  occurredAt?: string | null;
}): { record: ArtifactRecord; body: string };
export function appendMutationEvent(record: ArtifactRecord, body: string, mutation: unknown, options: {
  note?: string | null;
  evidence?: Array<{ kind: string; ref?: string; summary?: string }>;
  actor?: string;
  occurredAt?: string | null;
}): { record: ArtifactRecord; body: string };
export function guardrailState(record: ArtifactRecord, body: string): GuardrailObligation[];
export function appendTechnicalSummary(record: ArtifactRecord, body: string, summary: string): string;
export function extractTechnicalSummary(body: string): string | null;
export function renderRunEvent(event: RunEvent): string;
export function instant(value?: string | null): string;
export function dateInstant(value?: string | null): string;
export function eventId(runId: string, sequence: number): string;

// ---------------------------------------------------------------------------
// lib/security/secrets
// ---------------------------------------------------------------------------

export const SECRET_PATTERNS: readonly RegExp[];

export function containsSecret(value: string): boolean;
export function assertNoSecret(values: string | string[], message?: string): void;
export function secretFingerprints(value: string): string[];
export function containsSecretWithAllowlist(value: string, relativePath: string, allowlist: Set<string>): boolean;
export function isSecretAllowed(relativePath: string, allowlist: Set<string>): boolean;
export function loadSecretAllowlist(scrumDir: string): Set<string>;
export function parseFrontmatter(text: string): { explicit: Record<string, unknown>; raw: string };

// ---------------------------------------------------------------------------
// lib/errors
// ---------------------------------------------------------------------------

export interface ErrorEntry {
  summary: string;
  remediation: string;
  retired?: boolean;
}

export const CATALOG: Readonly<Record<string, ErrorEntry>>;

export class ScrumRunError extends Error {
  readonly code: string;
  readonly summary: string;
  readonly remediation: string;
  readonly details?: unknown;
  constructor(code: string, message?: string, options?: { cause?: unknown; details?: unknown });
}

export function describe(code: string): ErrorEntry | null;
export function codes(): string[];

// ---------------------------------------------------------------------------
// lib/commands/manifest
// ---------------------------------------------------------------------------

export interface RouteSpec {
  description: string;
  subjects: Record<string, string[]>;
}

export interface ResolvedRoute {
  type: "route" | "help" | "error";
  noun?: string;
  subject?: string;
  args?: string[];
  spec?: RouteSpec;
  actions?: string[];
  level?: string;
  message?: string;
  note?: string;
}

export const nouns: Readonly<Record<string, RouteSpec>>;
export const aliases: Readonly<Record<string, string>>;
export function resolveRoute(parts: string[]): ResolvedRoute;
export function resolveAlias(alias: string, parts: string[]): ResolvedRoute;

// ---------------------------------------------------------------------------
// lib/commands/normalize-legacy
// ---------------------------------------------------------------------------

export interface NormalizePlan {
  malformed: boolean;
  runs: Array<{ id: string; errors: string[] }>;
  [key: string]: unknown;
}

export function normalizeLegacyRuns(scrumDir: string, options?: { dryRun?: boolean }): { plan: NormalizePlan; applied: string[] };
export function analyze(scrumDir: string): NormalizePlan;
export function apply(scrumDir: string, plan: NormalizePlan): string[];
export function renderReport(plan: NormalizePlan, applied: string[]): string;
export function buildNormalizedBody(runId: string, status: string, original: string): string;
export function needsNormalization(body: string): boolean;
export function scanRuns(scrumDir: string): Array<{ id: string; file: string; body: string; malformed: boolean; errors: string[] }>;

// ---------------------------------------------------------------------------
// lib/commands/run-render
// ---------------------------------------------------------------------------

export function renderRun(record: ArtifactRecord, body: string): string;
export function renderRunFromDisk(projectRoot: string, runId: string): string;
export function formatInstant(iso: string | null): string;
export function humanDuration(startIso: string | null, endIso: string | null): string | null;
export function summarizeEvidence(evidence: Array<{ kind: string; ref?: string; summary?: string }>): string;

// ---------------------------------------------------------------------------
// lib/commands/run-stats
// ---------------------------------------------------------------------------

export interface StatsFilters {
  task?: string;
  feature?: string;
  sprint?: string;
}

export interface RunStats {
  [key: string]: unknown;
}

export function computeStats(projectRoot: string, filters?: StatsFilters): RunStats;
export function renderStats(stats: RunStats, filters: StatsFilters): string;
export function loadRuns(cwd: string): Array<{ id: string; file: string; body: string; frontmatter: Record<string, unknown> }>;

// ---------------------------------------------------------------------------
// lib/commands/pretty-intake
// ---------------------------------------------------------------------------

export function canRenderPretty(stream?: { isTTY?: boolean }): boolean;
export function renderIntake(plan: IntakePlan): string;
export function renderIntakePlain(plan: IntakePlan): string;

// ---------------------------------------------------------------------------
// lib/memory/service
// ---------------------------------------------------------------------------

export interface MemoryArtifact {
  record: ArtifactRecord;
  body: string;
  file: string;
}

export interface MemoryOptions {
  title: string;
  content: string;
  evidence: string[];
  relations: string[];
  subjectType?: string | null;
  subjectId?: string | null;
  sourceType?: string;
  sourceId?: string | null;
  confidence?: string | null;
  validFrom?: string | null;
  validUntil?: string | null;
  reviewTrigger?: string | null;
}

export function createMemory(projectRoot: string, kind: string, options: MemoryOptions): MemoryArtifact;
export function listMemory(projectRoot: string, kind: string, options?: { includeInactive?: boolean }): MemoryArtifact[];
export function showMemory(projectRoot: string, kind: string, id: string): MemoryArtifact | null;
export function transitionMemory(projectRoot: string, kind: string, id: string, action: string, options?: { evidence?: string[]; note?: string | null }): MemoryArtifact;
export function resolveEvidence(projectRoot: string, repository: ArtifactRepository, reference: string): { resolved: boolean; reason?: string };

// ---------------------------------------------------------------------------
// lib/runtime/context
// ---------------------------------------------------------------------------

export function buildContextPackage(projectRoot: string, request: string): ContextPackage;
export function contextFingerprint(projectRoot: string, request: string): string;
export function artifactSnapshot(scrumDir: string): { hashes: Record<string, string>; records: Record<string, Array<{ id: string; status: string; title?: string }>> };
export function guardrailRecords(scrumDir: string): GuardrailRecord[];
export function projectScan(projectRoot: string): unknown;

// ---------------------------------------------------------------------------
// lib/runtime/canonical-snapshot
// ---------------------------------------------------------------------------

export function canonicalFingerprint(scrumDir: string, hashes: Record<string, string>): string;
export function canonicalWatchSnapshot(scrumDir: string): { fingerprint: string; files: unknown[] };
export function fileWatchSnapshot(projectRoot: string): { fingerprint: string; files: unknown[] };
export function statRow(entry: unknown): unknown;

// ---------------------------------------------------------------------------
// lib/code-intel/learning
// ---------------------------------------------------------------------------

export function extractLearningCandidates(projectRoot: string, runId: string): { created: string[]; warnings: string[] };
export function learningSection(candidates: unknown[]): string;
export function parseCandidate(text: string): unknown;
