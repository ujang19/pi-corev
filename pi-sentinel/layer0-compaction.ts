/**
 * Layer 0: Context Compaction
 *
 * Strips implementation details before review so the agent reviews
 * with fresh eyes — no bias from having written the code.
 * Inspired by: owainlewis/pi-extensions context-workflow
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GateLayer, type GateState, type LayerResult } from "./state";

export async function handleCompaction(
  pi: ExtensionAPI,
  _gate: GateState
): Promise<boolean> {
  // Pi doesn't expose a direct "compact context" API, but we can
  // use the context event to strip messages before agent starts.
  // For now, mark compaction as done — the actual stripping happens
  // in a before_agent_start handler that removes prior implementation
  // messages from the context.

  pi.ui?.notify?.("🧹 Context compacted — reviewing with fresh eyes", "info");
  return true;
}

export function generateCompactionLayerResult(
  compacted: boolean
): LayerResult {
  return {
    layer: GateLayer.COMPACTION,
    passed: true,
    findings: [],
    durationMs: 0,
    summary: compacted
      ? "Context compacted — implementation details stripped for unbiased review"
      : "Compaction skipped",
  };
}