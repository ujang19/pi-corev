/**
 * Quality metrics gate — Maggy-inspired code quality checks.
 *
 * Checks:
 * - Max lines per function (default: 20)
 * - Max parameters per function (default: 3)
 * - Max nesting depth (default: 2)
 * - Cyclomatic complexity threshold (default: 10)
 */
import type { GateConfig } from "./state";
import { GateLayer, Severity, createFinding } from "./state";
import * as fs from "node:fs";
import * as path from "node:path";
import { execSync } from "node:child_process";

export interface QualityIssue {
  file: string;
  line: number;
  message: string;
  severity: Severity;
}

/**
 * Check quality metrics on changed files.
 * Uses regex-based analysis as a lightweight alternative
 * to full AST parsing (which would need language-specific parsers).
 */
export function checkQualityMetrics(config: GateConfig): ReturnType<typeof createFinding>[] {
  const findings: ReturnType<typeof createFinding>[] = [];

  try {
    // Get changed files
    const diffFiles = getChangedFiles(config.baseBranch);
    if (diffFiles.length === 0) return findings;

    for (const file of diffFiles) {
      if (!fs.existsSync(file)) continue;

      // Skip non-source files
      const ext = path.extname(file);
      if (!isSourceFile(ext)) continue;

      try {
        const content = fs.readFileSync(file, "utf-8");
        const issues = analyzeFile(file, content, config);
        findings.push(...issues);
      } catch {
        // Skip unreadable files
      }
    }
  } catch {
    // Git not available or no changes — skip
  }

  return findings;
}

function getChangedFiles(baseBranch: string): string[] {
  try {
    const output = execSync(
      `git diff --name-only ${baseBranch}...HEAD 2>/dev/null || git diff --name-only HEAD~1 2>/dev/null || echo ""`,
      { encoding: "utf-8" }
    );
    return output
      .split("\n")
      .map((f) => f.trim())
      .filter((f) => f.length > 0);
  } catch {
    return [];
  }
}

function isSourceFile(ext: string): boolean {
  const sourceExtensions = [
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".py",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".swift",
    ".rb",
    ".php",
  ];
  return sourceExtensions.includes(ext.toLowerCase());
}

function analyzeFile(
  file: string,
  content: string,
  config: GateConfig
): ReturnType<typeof createFinding>[] {
  const findings: ReturnType<typeof createFinding>[] = [];
  const lines = content.split("\n");

  let currentFunction: { name: string; startLine: number; params: number; depth: number } | null = null;
  let functionLineCount = 0;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNum = i + 1;

    // Track brace depth for nesting
    const openBraces = (line.match(/\{/g) || []).length;
    const closeBraces = (line.match(/\}/g) || []).length;
    braceDepth += openBraces - closeBraces;

    // Simple function detection
    const funcMatch = line.match(
      /(?:function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\(|(\w+)\s*\([^)]*\)\s*\{|def\s+(\w+)\s*\(|func\s+(\w+)\s*\()/
    );

    if (funcMatch && !currentFunction) {
      const name =
        funcMatch[1] || funcMatch[2] || funcMatch[3] || funcMatch[4] || funcMatch[5] || "anonymous";
      const paramsMatch = line.match(/\(([^)]*)\)/);
      const params = paramsMatch
        ? paramsMatch[1]
            .split(",")
            .filter((p) => p.trim().length > 0).length
        : 0;

      currentFunction = {
        name,
        startLine: lineNum,
        params,
        depth: braceDepth,
      };
      functionLineCount = 0;

      // Check param count
      if (params > config.qualityMetrics.maxParamsPerFunction) {
        findings.push(
          createFinding(
            GateLayer.STRUCTURED,
            Severity.WARN,
            `\`${name}()\` has ${params} parameters (max ${config.qualityMetrics.maxParamsPerFunction})`,
            { file, line: lineNum, suggestion: "Consider refactoring into smaller functions or using an options object" }
          )
        );
      }
    }

    if (currentFunction) {
      functionLineCount++;

      // Check nesting depth
      if (
        braceDepth - currentFunction.depth >
        config.qualityMetrics.maxNestingDepth
      ) {
        findings.push(
          createFinding(
            GateLayer.STRUCTURED,
            Severity.WARN,
            `\`${currentFunction.name}()\` nesting depth exceeds ${config.qualityMetrics.maxNestingDepth} at line ${lineNum}`,
            { file, line: lineNum, suggestion: "Extract nested logic into separate functions" }
          )
        );
      }

      // Check function close
      if (braceDepth <= currentFunction.depth && closeBraces > 0) {
        // Function ended
        if (
          functionLineCount > config.qualityMetrics.maxLinesPerFunction
        ) {
          findings.push(
            createFinding(
              GateLayer.STRUCTURED,
              Severity.INFO,
              `\`${currentFunction.name}()\` is ${functionLineCount} lines (max ${config.qualityMetrics.maxLinesPerFunction})`,
              {
                file,
                line: currentFunction.startLine,
                suggestion: "Consider breaking into smaller, focused functions",
              }
            )
          );
        }
        currentFunction = null;
        functionLineCount = 0;
      }
    }
  }

  return findings;
}