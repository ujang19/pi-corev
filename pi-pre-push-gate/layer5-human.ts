/**
 * Layer 5: Human Review
 *
 * Optional final gate — only triggered when warn/info findings remain.
 * Integrates with slopchop for interactive diff annotation.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GateLayer, type GateState } from "./state";
import { needsHumanReview } from "./state";

export function injectHumanReviewPrompt(
  pi: ExtensionAPI,
  gate: GateState
): void {
  const allFindings = gate.layers.flatMap((l) => l.findings);
  const unresolved = allFindings.filter((f) => !f.resolved);
  const warnFindings = unresolved.filter((f) => f.severity === "warn");
  const infoFindings = unresolved.filter((f) => f.severity === "info");

  const lines: string[] = [
    "## 👁 Human Review Required",
    "",
    `**${unresolved.length} unresolved findings** remain from automated review layers.`,
    `- ${warnFindings.length} warnings (P1)`,
    `- ${infoFindings.length} info (P2)`,
    "",
    "### Findings to Review",
    "",
  ];

  for (const f of unresolved) {
    const icon = f.severity === "warn" ? "⚠️" : "ℹ️";
    lines.push(
      `- ${icon} **${f.file ?? "unknown"}:${f.line ?? "?"}** — ${f.message}`
    );
    if (f.suggestion) {
      lines.push(`  → Suggestion: ${f.suggestion}`);
    }
  }

  lines.push("");
  lines.push("### Actions");
  lines.push("- Run `/gate approve` to accept and allow push");
  lines.push("- Run `/gate reject` to block and return to fixes");
  lines.push("- Or use `/slopchop` to annotate specific changes");

  pi.queueMessage?.({
    role: "user",
    content: [{ type: "text", text: lines.join("\n") }],
  });

  pi.ui?.notify?.(
    `👁 Human review needed — ${unresolved.length} findings to check`,
    "warn"
  );
}