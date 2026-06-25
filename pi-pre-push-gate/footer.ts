/**
 * Footer status widget for the 5-layer gate pipeline.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { GateState } from "./state";
import { GateLayer } from "./state";
import { LAYER_FOOTER } from "./settings";

export function updateFooter(
  pi: ExtensionAPI,
  gate: GateState | null
): void {
  if (!gate) {
    pi.ui?.setStatus?.("gate", "");
    return;
  }

  const phase = gate.phase;
  const base = LAYER_FOOTER[phase] ?? `🛡 Gate · ${phase}`;

  let status = base;

  switch (phase) {
    case GateLayer.SELF_REVIEW:
      status = `🔍 Gate · Self-review ${gate.currentIteration + 1}/${gate.config.maxIterations}`;
      break;
    case GateLayer.PASSED:
      status = "✅ Gate PASSED · ready to push";
      break;
    case GateLayer.BLOCKED:
      status = "⛔ Gate BLOCKED · fix pi-review-report.md";
      break;
    case GateLayer.ABORTED:
      status = "🛑 Gate ABORTED";
      break;
  }

  pi.ui?.setStatus?.("gate", status);
}