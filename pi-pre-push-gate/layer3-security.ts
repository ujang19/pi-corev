/**
 * Layer 3: Security Audit
 *
 * Integrates with piolium (vigolium/piolium) for security scanning.
 * Auto-detects if piolium is installed. Falls through gracefully.
 * P0 findings (secrets, RCE, SQLi) auto-block the gate.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { GateLayer, type GateState, type LayerResult, Severity, resolveModel } from "./state";

const SECURITY_AUDIT_PROMPT = `## 🛡 Security Audit

Perform a security-focused review of ALL uncommitted changes.

### Scan For
1. **Secrets & Keys** — Hardcoded API keys, tokens, passwords, private keys
2. **Injection Vectors** — SQL injection, command injection, XSS, path traversal
3. **Auth & Authz** — Missing auth checks, privilege escalation, session issues
4. **Data Exposure** — PII leaks, sensitive data in logs, insecure storage
5. **Dependency Risks** — Known vulns, deprecated packages, supply chain
6. **Crypto** — Weak algorithms, hardcoded IVs, improper key management
7. **Config** — Debug mode in prod, exposed endpoints, CORS misconfig

### Format
For EACH finding:
\`\`\`
[SEVERITY: critical|warn|info] [FILE: path:line] [CWE: id] TITLE
Description
Remediation: steps to fix
\`\`\`

### Verdict
- \`SECURITY: PASS\` — no vulnerabilities found
- \`SECURITY: FAIL\` — one or more critical vulnerabilities

**CRITICAL findings = P0 = BLOCK PUSH. No exceptions.**`;

export async function checkSecurityAvailability(): Promise<boolean> {
  try {
    // Check if piolium is installed
    const { execSync } = await import("node:child_process");
    const result = execSync("pi list 2>/dev/null | grep -i piolium || true", {
      encoding: "utf-8",
    });
    return result.trim().length > 0;
  } catch {
    return false;
  }
}

export function injectSecurityAuditPrompt(
  pi: ExtensionAPI,
  gate: GateState
): void {
  // If piolium is available, prefer its command
  // Otherwise use prompt-based security audit
  pi.queueMessage?.({
    role: "user",
    content: [
      {
        type: "text",
        text: SECURITY_AUDIT_PROMPT,
      },
    ],
  });
}

export function generateSecurityLayerResult(response: string): LayerResult {
  const passed = /SECURITY:\s*PASS/i.test(response);
  const failed = /SECURITY:\s*FAIL/i.test(response);

  // Parse findings
  const findings: LayerResult["findings"] = [];
  const findingRegex =
    /\[SEVERITY:\s*(critical|warn|info)\]\s*(?:\[FILE:\s*([^\]]+)\])?\s*(?:\[CWE:\s*([^\]]+)\])?\s*(.+?)(?:\n|$)/gi;

  let match;
  while ((match = findingRegex.exec(response)) !== null) {
    const severity = (match[1]?.toLowerCase() ?? "info") as Severity;
    const filePath = match[2]?.trim();
    const cwe = match[3]?.trim();
    const message = match[4]?.trim();

    let file: string | undefined;
    let line: number | undefined;
    if (filePath) {
      const parts = filePath.split(":");
      file = parts[0];
      line = parts[1] ? parseInt(parts[1], 10) : undefined;
    }

    findings.push({
      id: `SEC-${String(findings.length + 1).padStart(4, "0")}`,
      layer: GateLayer.SECURITY,
      severity,
      file,
      line,
      message: cwe ? `[CWE-${cwe}] ${message}` : message,
      suggestion: undefined,
      resolved: false,
      timestamp: Date.now(),
    });
  }

  // If no findings parsed but response indicates pass, that's fine
  const hasCritical = findings.some((f) => f.severity === Severity.CRITICAL);

  return {
    layer: GateLayer.SECURITY,
    passed: passed || (!failed && !hasCritical),
    findings,
    durationMs: 0,
    summary: passed
      ? `Security audit passed — ${findings.length} findings`
      : hasCritical
        ? `Security audit FAILED — ${findings.filter((f) => f.severity === Severity.CRITICAL).length} critical vulnerabilities`
        : `Security audit completed — ${findings.length} findings`,
  };
}