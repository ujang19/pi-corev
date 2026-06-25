/**
 * Layer 4: Test Gate
 *
 * Runs existing tests and generates missing tests for changed code.
 * Coverage check on changed files.
 * Blocks if tests fail or coverage is insufficient.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GateLayer, type GateState, type LayerResult, Severity, resolveModel } from "./state";
import { TEST_PASS, TEST_FAIL } from "./settings";

const TEST_GATE_PROMPT = `## 🧪 Test Gate

Validate that all tests pass and coverage is adequate for the changed code.

### Step 1: Run Tests
Run the project test suite. Report results:
- Tests passed / total
- Any failures with details
- Exit code

### Step 2: Coverage Check
For changed files, check test coverage:
- New code without tests → flag as critical
- Changed code with <80% coverage → flag as warn

### Step 3: Missing Test Generation (if needed)
If there are gaps, generate the missing tests.

### Output Format
\`\`\`
[SEVERITY: critical|warn|info] [FILE: path:line] TEST RESULT
\`\`\`

### Verdict
- \`TESTS: PASS\` — all tests pass, coverage adequate
- \`TESTS: FAIL\` — test failures or coverage gaps`;

export function injectTestGatePrompt(
  pi: ExtensionAPI,
  gate: GateState
): void {
  pi.queueMessage?.({
    role: "user",
    content: [{ type: "text", text: TEST_GATE_PROMPT }],
  });
}

export function analyzeTestGateResponse(response: string): {
  passed: boolean;
  findings: Array<{
    severity: Severity;
    message: string;
    file?: string;
    line?: number;
  }>;
} {
  const passed =
    TEST_PASS.some((p) => p.test(response)) &&
    !TEST_FAIL.some((p) => p.test(response));

  const findings: Array<{
    severity: Severity;
    message: string;
    file?: string;
    line?: number;
  }> = [];

  const findingRegex =
    /\[SEVERITY:\s*(critical|warn|info)\]\s*(?:\[FILE:\s*([^\]]+)\])?\s*(.+?)(?:\n|$)/gi;

  let match;
  while ((match = findingRegex.exec(response)) !== null) {
    const severity = match[1].toLowerCase() as Severity;
    const filePath = match[2]?.trim();
    const message = match[3].trim();

    let file: string | undefined;
    let line: number | undefined;
    if (filePath) {
      const parts = filePath.split(":");
      file = parts[0];
      line = parts[1] ? parseInt(parts[1], 10) : undefined;
    }

    findings.push({ severity, message, file, line });
  }

  return { passed, findings };
}

export function generateTestLayerResult(
  passed: boolean,
  findings: LayerResult["findings"]
): LayerResult {
  return {
    layer: GateLayer.TEST,
    passed,
    findings,
    durationMs: 0,
    summary: passed
      ? "Test gate passed — all tests green, coverage adequate"
      : `Test gate FAILED — ${findings.length} issues`,
  };
}