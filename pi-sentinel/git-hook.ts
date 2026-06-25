/**
 * Git hook manager — install, uninstall, marker file.
 */
import type { GateConfig, GateState } from "./state";
import * as fs from "node:fs";
import * as path from "node:path";

const HOOK_PATH = path.join(".git", "hooks", "pre-push");

const HOOK_TEMPLATE = `#!/bin/sh
# ═══════════════════════════════════════════════════════════════
# pi-sentinel — Auto-generated pre-push hook
# Blocks 'git push' until /gate review pipeline passes.
# Installed by: /gate hook install
# ═══════════════════════════════════════════════════════════════

MARKER=".git/GATE_MARKER"
HOOK_MODE="{hookMode}"

echo ""
echo "🛡  Pre-Push Gate — pi-sentinel"
echo "─────────────────────────────────────"

if [ ! -f "$MARKER" ]; then
  echo ""
  echo "⛔  No review marker found."
  echo "    Run '/gate' in pi to start the review pipeline."
  echo "    Or bypass with: git push --no-verify"
  echo ""
  exit 1
fi

# Check if marker is recent (< 30 minutes old)
if find "$MARKER" -mmin +30 2>/dev/null | grep -q .; then
  echo ""
  echo "⚠️   Review marker expired (>30 minutes old)."
  echo "    Run '/gate' again to re-validate."
  echo "    Or bypass with: git push --no-verify"
  echo ""
  exit 1
fi

RESULT=\$(cat "$MARKER" 2>/dev/null || echo "FAIL")

if [ "\$RESULT" = "PASS" ]; then
  echo ""
  echo "✅  Pre-Push Gate: PASSED"
  echo "    Review report: pi-review-report.md"
  echo ""
  rm -f "$MARKER"
  exit 0
else
  echo ""
  echo "⛔  Pre-Push Gate: BLOCKED"
  echo "    Fix issues listed in pi-review-report.md"
  echo "    Then run '/gate' again."
  echo "    Or bypass with: git push --no-verify"
  echo ""
  exit 1
fi
`;

export function installGitHook(config: GateConfig): void {
  const hookContent = HOOK_TEMPLATE.replace(/\{hookMode\}/g, config.hookMode);

  // Ensure .git/hooks exists
  const hooksDir = path.dirname(HOOK_PATH);
  if (!fs.existsSync(hooksDir)) {
    fs.mkdirSync(hooksDir, { recursive: true });
  }

  // Backup existing hook if present
  if (fs.existsSync(HOOK_PATH)) {
    const backup = `${HOOK_PATH}.backup-${Date.now()}`;
    fs.copyFileSync(HOOK_PATH, backup);
  }

  fs.writeFileSync(HOOK_PATH, hookContent, { mode: 0o755 });
}

export function uninstallGitHook(): void {
  if (fs.existsSync(HOOK_PATH)) {
    fs.unlinkSync(HOOK_PATH);
  }
}

export function isHookInstalled(): boolean {
  return fs.existsSync(HOOK_PATH);
}

export function setGateMarker(gate: GateState): void {
  const dir = path.dirname(gate.markerPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(gate.markerPath, "PASS", { mode: 0o644 });
}

export function clearGateMarker(gate: GateState): void {
  if (fs.existsSync(gate.markerPath)) {
    fs.unlinkSync(gate.markerPath);
  }
}

export function readGateMarker(): { valid: boolean; pass: boolean } {
  const markerPath = path.join(".git", "GATE_MARKER");

  if (!fs.existsSync(markerPath)) {
    return { valid: false, pass: false };
  }

  // Check age
  const stats = fs.statSync(markerPath);
  const ageMs = Date.now() - stats.mtimeMs;
  if (ageMs > 30 * 60 * 1000) {
    return { valid: false, pass: false };
  }

  const content = fs.readFileSync(markerPath, "utf-8").trim();
  return { valid: true, pass: content === "PASS" };
}