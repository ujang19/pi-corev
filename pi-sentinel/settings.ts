/**
 * Default settings & pattern library for pre-push gate.
 * All values can be overridden in ~/.pi/agent/settings.json under "prePushGate".
 */
import { GateConfig, Severity } from "./state";

export const DEFAULT_CONFIG: GateConfig = {
  layers: {
    compaction: true,
    selfReview: true,
    structured: true,
    security: "auto", // auto-detect piolium installation
    testGate: true,
    humanReview: "on-warn", // only when P1/P2 findings remain
  },

  models: {
    // Explicit per layer — resolved via ModelRegistry (models.json). Use /gate model router for cf/*.
    selfReview: "cf/ministral-8b-latest",
    structuredReview: "cf/mistral-medium-latest",
    securityAudit: "cf/mistral-medium-latest",
    testGate: "cf/ministral-3b-latest",
  },

  maxIterations: 5,
  freshContext: true,
  autoTrigger: true,
  baseBranch: "origin/main",
  hookMode: "block",
  autoPushOnPass: false,
  minSeverity: Severity.WARN,

  qualityMetrics: {
    maxLinesPerFunction: 20,
    maxParamsPerFunction: 3,
    maxNestingDepth: 2,
  },
};

// ── Phase 1: Self-review loop patterns ──────────────────────────────

export const SELF_REVIEW_EXIT = [
  /no\s+(?:further\s+)?issues?\s+(?:found|remaining|to\s+report)/i,
  /no\s+(?:bugs?|problems?|concerns?)\s+(?:found|detected)/i,
  /code\s+(?:looks|is)\s+(?:good|clean|solid|fine)\s*$/im,
  /all\s+(?:looks|is)\s+(?:good|clean|correct)/i,
  /nothing\s+(?:to|else\s+to)\s+(?:fix|change|improve|report)/i,
  /ready\s+for\s+(?:next\s+phase|review|verdict)/i,
  /lgtm/i,
  /✅\s*(?:no\s+issues|all\s+clear|pass)/i,
];

export const SELF_REVIEW_FIX = [
  /fixed?\s+(?:the\s+)?(?:following|these)?\s*(?:issues?|bugs?|problems?)/i,
  /(?:issues?|bugs?|problems?)\s+(?:fixed|resolved|addressed)/i,
  /changes?\s+(?:made|applied|committed)/i,
  /ready\s+for\s+another\s+(?:review|pass|iteration)/i,
  /🔧\s*(?:fixed|resolved|addressed)/i,
];

// ── Phase 2: Structured review verdict patterns ─────────────────────

export const VERDICT_PASS = [
  /verdict\s*:\s*pass/i,
  /verdict\s*:\s*approve/i,
  /no\s+blocking\s+(?:issues?|findings?|problems?)/i,
  /all\s+(?:issues?|findings?)\s+(?:are\s+)?(?:resolved|fixed|addressed)/i,
  /ready\s+(?:to|for)\s+(?:push|merge|deploy|release)/i,
  /✅.*(?:pass|approve|ready|good)/i,
];

export const VERDICT_FAIL = [
  /verdict\s*:\s*(?:fail|reject|block)/i,
  /blocking\s+(?:issues?|findings?|problems?)/i,
  /must\s+(?:fix|address|resolve)\s+before\s+(?:push|merge)/i,
  /do\s+not\s+(?:push|merge|deploy)/i,
  /⛔.*(?:fail|reject|block)/i,
];

// ── Phase 4: Test gate patterns ─────────────────────────────────────

export const TEST_PASS = [
  /all\s+(?:tests?|specs?)\s+(?:pass|green|ok)/i,
  /(?:tests?|specs?)\s+(?:passed|succeeded)/i,
  /✅.*(?:tests?|pass)/i,
  /coverage\s+(?:is\s+)?(?:sufficient|ok|good)/i,
];

export const TEST_FAIL = [
  /(?:tests?|specs?)\s+(?:failed|failing|red)/i,
  /❌.*(?:tests?|fail)/i,
  /coverage\s+(?:is\s+)?(?:insufficient|below|low)/i,
];

// ── User-facing labels ───────────────────────────────────────────────

export const LAYER_LABELS: Record<string, string> = {
  compaction: "Context Compaction",
  self_review: "Self-Review Loop",
  structured: "Structured Review",
  security: "Security Audit",
  test: "Test Gate",
  human: "Human Review",
};

export const LAYER_ICONS: Record<string, string> = {
  compaction: "🧹",
  self_review: "🔍",
  structured: "📋",
  security: "🛡",
  test: "🧪",
  human: "👁",
};

export const LAYER_FOOTER: Record<string, string> = {
  compaction: "🧹 Gate · Compacting",
  self_review: "🔍 Gate · Self-review",
  structured: "📋 Gate · Structured",
  security: "🛡 Gate · Security",
  test: "🧪 Gate · Tests",
  human: "👁 Gate · Human",
};

export const SEVERITY_ICONS: Record<string, string> = {
  critical: "🔴",
  warn: "⚠️",
  info: "ℹ️",
};

export const SEVERITY_LABELS: Record<string, string> = {
  critical: "P0 · Critical",
  warn: "P1 · Warn",
  info: "P2 · Info",
};