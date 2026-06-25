/**
 * Layer 2: Structured Review
 *
 * Multi-perspective deep review using pi-review (Earendil).
 * Runs: overall review → Linus-style blunt → staff engineer risk → synthesize.
 * Quality metrics gate from Maggy inspiration.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GateLayer, type GateState, type LayerResult, Severity, resolveModel } from "./state";
import { VERDICT_PASS, VERDICT_FAIL } from "./settings";

const STRUCTURED_REVIEW_PROMPT = `## 📋 Structured Code Review — Multi-Perspective

Review ALL uncommitted changes against **{baseBranch}**. Provide a structured verdict.

### Perspective 1: Overall Review
- Architecture & design patterns
- Code organization & modularity
- Integration with existing codebase
- Documentation & comments quality

### Perspective 2: Risk-Focused Review (Staff Engineer)
- What could fail in production?
- Are there race conditions, deadlocks, resource leaks?
- Does this scale? (large inputs, high concurrency)
- Data consistency & integrity

### Perspective 3: Quality Metrics
- Functions > {maxLines} lines? → flag
- Functions > {maxParams} parameters? → flag
- Nesting depth > {maxNesting}? → flag
- Cyclomatic complexity > 10? → flag

### Output Format
For each finding, use this exact format:

\`\`\`
[SEVERITY: critical|warn|info] [FILE: path:line] TITLE
Description of the issue
Suggestion: what to do about it
\`\`\`

### Verdict
End with exactly one of:
- \`VERDICT: PASS\` — no blocking issues
- \`VERDICT: FAIL\` — critical issues must be fixed before push

**Severity Guide:**
- **critical**: Security vulns, data loss, crashes, auth bypass — BLOCKS push
- **warn**: Architecture issues, perf problems, missing error handling, deprecated APIs
- **info**: Style, naming, minor improvements, suggestions`;

export function injectStructuredReviewPrompt(
  pi: ExtensionAPI,
  gate: GateState
): void {
  const prompt = STRUCTURED_REVIEW_PROMPT
    .replace(/\{baseBranch\}/g, gate.config.baseBranch)
    .replace(/\{maxLines\}/g, String(gate.config.qualityMetrics.maxLinesPerFunction))
    .replace(/\{maxParams\}/g, String(gate.config.qualityMetrics.maxParamsPerFunction))
    .replace(/\{maxNesting\}/g, String(gate.config.qualityMetrics.maxNestingDepth));

  pi.queueMessage?.({
    role: "user",
    content: [{ type: "text", text: prompt }],
  });
}

export function analyzeStructuredReviewResponse(response: string): {
  passed: boolean;
  findings: Array<{
    severity: Severity;
    message: string;
    file?: string;
    line?: number;
    suggestion?: string;
  }>;
} {
  const passed =
    VERDICT_PASS.some((p) => p.test(response)) &&
    !VERDICT_FAIL.some((p) => p.test(response));

  // Parse findings from structured format
  const findings: Array<{
    severity: Severity;
    message: string;
    file?: string;
    line?: number;
    suggestion?: string;
  }> = [];

  const findingRegex =
    /\[SEVERITY:\s*(critical|warn|info)\]\s*(?:\[FILE:\s*([^\]]+)\])?\s*(.+?)(?:\n|$)/gi;

  let match;
  while ((match = findingRegex.exec(response)) !== null) {
    const severity = match[1].toLowerCase() as Severity;
    const filePath = match[2]?.trim();
    const message = match[3].trim();

    // Try to parse file:line
    let file: string | undefined;
    let line: number | undefined;
    if (filePath) {
      const parts = filePath.split(":");
      file = parts[0];
      line = parts[1] ? parseInt(parts[1], 10) : undefined;
    }

    // Find suggestion after the finding
    const afterFinding = response.slice(match.index + match[0].length);
    const suggMatch = afterFinding.match(/Suggestion:\s*(.+?)(?:\n\n|\n\[|$)/is);
    const suggestion = suggMatch?.[1]?.trim();

    findings.push({ severity, message, file, line, suggestion });
  }

  return { passed, findings };
}

export function generateStructuredLayerResult(
  passed: boolean,
  findings: LayerResult["findings"]
): LayerResult {
  return {
    layer: GateLayer.STRUCTURED,
    passed,
    findings,
    durationMs: 0,
    summary: passed
      ? `Structured review passed — ${findings.length} findings (non-blocking)`
      : `Structured review FAILED — ${findings.filter((f) => f.severity === Severity.CRITICAL).length} critical issues`,
  };
}