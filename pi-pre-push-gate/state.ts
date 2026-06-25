/**
 * State machine for the 5-layer pre-push gate pipeline.
 *
 *   IDLE → COMPACTION → SELF_REVIEW → STRUCTURED → SECURITY → TEST → HUMAN → PASSED
 *                                                                          → BLOCKED
 */

// ── Layer enum ────────────────────────────────────────────────────────

export enum GateLayer {
  IDLE = "idle",
  COMPACTION = "compaction",
  SELF_REVIEW = "self_review",
  STRUCTURED = "structured",
  SECURITY = "security",
  TEST = "test",
  HUMAN = "human",
  PASSED = "passed",
  BLOCKED = "blocked",
  ABORTED = "aborted",
}

// ── Severity ──────────────────────────────────────────────────────────

export enum Severity {
  CRITICAL = "critical", // P0 — block merge
  WARN = "warn", // P1 — required review
  INFO = "info", // P2 — non-blocking
}

// ── Finding ───────────────────────────────────────────────────────────

export interface Finding {
  id: string;
  layer: GateLayer;
  severity: Severity;
  file?: string;
  line?: number;
  message: string;
  suggestion?: string;
  resolved: boolean;
  timestamp: number;
}

// ── Layer result ──────────────────────────────────────────────────────

export interface LayerResult {
  layer: GateLayer;
  passed: boolean;
  findings: Finding[];
  durationMs: number;
  iterations?: number; // for SELF_REVIEW
  model?: string; // model used for this layer
  summary: string;
}

// ── Gate config (runtime, merged from settings.json) ─────────────────

export interface GateConfig {
  // Layer toggle
  layers: {
    compaction: boolean;
    selfReview: boolean;
    structured: boolean;
    security: "on" | "off" | "auto"; // auto = detect piolium
    testGate: boolean;
    humanReview: "always" | "on-warn" | "never";
  };

  // Models — always explicit, never inherit from session
  models: {
    selfReview: string;
    structuredReview: string;
    securityAudit: string;
    testGate: string;
  };

  // Phase 1 self-review
  maxIterations: number; // default 5
  freshContext: boolean; // default true

  // Trigger
  autoTrigger: boolean; // default true

  // Git
  baseBranch: string; // default "origin/main"
  hookMode: "block" | "warn"; // default "block"
  autoPushOnPass: boolean; // default false

  // Severity gate
  minSeverity: Severity; // default WARN — findings below are P2 only

  // Quality metrics (from Maggy inspiration)
  qualityMetrics: {
    maxLinesPerFunction: number; // default 20
    maxParamsPerFunction: number; // default 3
    maxNestingDepth: number; // default 2
  };
}

// ── Gate state (persisted across turns) ──────────────────────────────

export interface GateState {
  phase: GateLayer;
  currentIteration: number;
  config: GateConfig;
  layers: LayerResult[];
  findings: Finding[];
  verdict: "pending" | "pass" | "fail";
  startedAt: number;
  finishedAt: number | null;
  reportPath: string;
  markerPath: string;
  // Track model used per layer
  layerModels: Map<GateLayer, string>;
  // Human review pending flag
  humanApproved: boolean | null;
}

// ── Factory ───────────────────────────────────────────────────────────

export function createGateState(config: GateConfig): GateState {
  return {
    phase: GateLayer.IDLE,
    currentIteration: 0,
    config,
    layers: [],
    findings: [],
    verdict: "pending",
    startedAt: 0,
    finishedAt: null,
    reportPath: "pi-review-report.md",
    markerPath: ".git/GATE_MARKER",
    layerModels: new Map(),
    humanApproved: null,
  };
}

// ── State transitions ─────────────────────────────────────────────────

/**
 * Ordered layer sequence (runtime, filtered by config).
 */
export function getActiveLayers(config: GateConfig): GateLayer[] {
  const layers: GateLayer[] = [];

  if (config.layers.compaction) layers.push(GateLayer.COMPACTION);
  if (config.layers.selfReview) layers.push(GateLayer.SELF_REVIEW);
  if (config.layers.structured) layers.push(GateLayer.STRUCTURED);
  if (config.layers.security !== "off") layers.push(GateLayer.SECURITY);
  if (config.layers.testGate) layers.push(GateLayer.TEST);
  if (config.layers.humanReview !== "never") layers.push(GateLayer.HUMAN);

  return layers;
}

/**
 * Get the next layer after current.
 */
export function nextLayer(
  current: GateLayer,
  config: GateConfig
): GateLayer | null {
  const active = getActiveLayers(config);
  const idx = active.indexOf(current);
  if (idx === -1 || idx >= active.length - 1) return null;
  return active[idx + 1];
}

/**
 * Determine if gate should advance automatically or stop.
 */
export function shouldAdvance(result: LayerResult, config: GateConfig): boolean {
  if (!result.passed) return false;

  // Layer 5 (HUMAN) requires explicit approval
  if (result.layer === GateLayer.HUMAN) return false;

  // Layer 3 (SECURITY): P0 findings always block
  const criticalFindings = result.findings.filter(
    (f) => f.severity === Severity.CRITICAL
  );
  if (criticalFindings.length > 0) return false;

  return true;
}

/**
 * Check if human review should be triggered.
 */
export function needsHumanReview(
  allFindings: Finding[],
  config: GateConfig
): boolean {
  if (config.layers.humanReview === "never") return false;
  if (config.layers.humanReview === "always") return true;

  // "on-warn": only if there are P1 or P2 findings
  return allFindings.some(
    (f) => f.severity === Severity.WARN || f.severity === Severity.INFO
  );
}

/**
 * Final verdict from all layer results.
 */
export function computeVerdict(
  layers: LayerResult[],
  config: GateConfig
): "pass" | "fail" {
  const allFindings = layers.flatMap((l) => l.findings);

  // Any P0 (CRITICAL) = auto fail
  const hasCritical = allFindings.some(
    (f) => f.severity === Severity.CRITICAL && !f.resolved
  );
  if (hasCritical) return "fail";

  // Any layer failed = fail
  const anyFailed = layers.some((l) => !l.passed);
  if (anyFailed) return "fail";

  return "pass";
}

// ── Finding helpers ───────────────────────────────────────────────────

let findingCounter = 0;

export function createFinding(
  layer: GateLayer,
  severity: Severity,
  message: string,
  opts?: { file?: string; line?: number; suggestion?: string }
): Finding {
  return {
    id: `F${String(++findingCounter).padStart(4, "0")}`,
    layer,
    severity,
    file: opts?.file,
    line: opts?.line,
    message,
    suggestion: opts?.suggestion,
    resolved: false,
    timestamp: Date.now(),
  };
}

// ── Trigger detection ─────────────────────────────────────────────────

export const TRIGGER_PATTERNS: RegExp[] = [
  /implement(?:ed)?\s+(?:the\s+)?plan/i,
  /plan\s+(?:is\s+)?(?:complete|done|finished)/i,
  /all\s+(?:tasks?|steps?)\s+(?:are\s+)?(?:complete|done)/i,
  /ready\s+(?:to|for)\s+(?:push|merge|deploy)/i,
  /feature\s+(?:is\s+)?(?:complete|done|finished|ready)/i,
  /semua\s+(?:task|step|langkah)\s+(?:selesai|beres|done)/i,
  /siap\s+(?:di[ -]?push|di[ -]?merge|di[ -]?deploy)/i,
];

export function detectTrigger(responseText: string): boolean {
  return TRIGGER_PATTERNS.some((p) => p.test(responseText));
}

// ── Model resolver ────────────────────────────────────────────────────

/**
 * Resolve which model to use for a layer.
 * Gate models are ALWAYS explicit — never inherit from session.
 */
export function resolveModel(
  config: GateConfig,
  layer: GateLayer
): string {
  switch (layer) {
    case GateLayer.SELF_REVIEW:
      return config.models.selfReview;
    case GateLayer.STRUCTURED:
      return config.models.structuredReview;
    case GateLayer.SECURITY:
      return config.models.securityAudit;
    case GateLayer.TEST:
      return config.models.testGate;
    default:
      return config.models.structuredReview; // fallback
  }
}