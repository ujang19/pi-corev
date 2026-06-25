/**
 * Layer 1: Self-Review Loop
 *
 * Repeatedly prompts the agent to review its own work until clean.
 * Cross-model support: uses a different model than the implementor.
 * Inspired by: nicobailon/pi-review-loop
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GateLayer, type GateState, type LayerResult } from "./state";
import { SELF_REVIEW_EXIT, SELF_REVIEW_FIX } from "./settings";
import { resolveModel } from "./state";

const SELF_REVIEW_PROMPT = `## 🔍 Self-Review (Pass {iteration}/{maxIterations})

You just finished implementing changes. Now review your own work with **fresh eyes**.

### Review Checklist
1. **Correctness** — Does every code path behave correctly?
2. **Edge cases** — Null/undefined, empty inputs, boundary values?
3. **Error handling** — Are all errors caught and handled gracefully?
4. **Security** — Any injection vectors, exposed secrets, auth gaps?
5. **Performance** — Unnecessary loops, N+1 queries, memory leaks?
6. **Naming** — Clear, consistent, follows project conventions?

### Rules
- If you find issues: fix them, then say "Fixed N issue(s). Ready for another review."
- If you find NO issues: say "No issues found. Ready for next phase."
- Do NOT say "No issues found" if you fixed anything this pass.

### Current Iteration
This is pass **{iteration}** of **{maxIterations}**. Review the code carefully.`;

export function injectSelfReviewPrompt(
  pi: ExtensionAPI,
  gate: GateState
): void {
  const prompt = SELF_REVIEW_PROMPT
    .replace(/\{iteration\}/g, String(gate.currentIteration + 1))
    .replace(/\{maxIterations\}/g, String(gate.config.maxIterations));

  // Queue as next user message
  pi.queueMessage?.({
    role: "user",
    content: [{ type: "text", text: prompt }],
  });

  // Note: model switching per layer would be handled via
  // pi.setModel?.(resolveModel(gate.config, GateLayer.SELF_REVIEW))
  // if Pi exposes that API on the extension context.
}

export function analyzeSelfReviewResponse(response: string): {
  exit: boolean;
  issuesFixed: boolean;
} {
  const exit = SELF_REVIEW_EXIT.some((p) => p.test(response));
  const issuesFixed = SELF_REVIEW_FIX.some((p) => p.test(response));

  return { exit, issuesFixed };
}

export function generateSelfReviewLayerResult(
  gate: GateState
): LayerResult {
  const passed = gate.currentIteration < gate.config.maxIterations;

  return {
    layer: GateLayer.SELF_REVIEW,
    passed,
    findings: [],
    durationMs: 0,
    iterations: gate.currentIteration,
    model: resolveModel(gate.config, GateLayer.SELF_REVIEW),
    summary: passed
      ? `Self-review completed in ${gate.currentIteration} iterations — no issues remaining`
      : `Self-review reached max iterations (${gate.config.maxIterations})`,
  };
}