/**
 * pi-sentinel — 5-Layer Pre-Push Review Pipeline
 *
 * A cross-model quality gate that runs before git push.
 * Layers: Compaction → Self-Review → Structured → Security → Test → Human
 *
 * Command: /gate
 * Install: pi install npm:pi-sentinel
 */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "@sinclair/typebox";

import {
  GateLayer,
  createGateState,
  type GateState,
  type GateConfig,
  type LayerResult,
  getActiveLayers,
  nextLayer,
  shouldAdvance,
  computeVerdict,
  detectTrigger,
  resolveModel,
  Severity,
  createFinding,
} from "./state";

import { DEFAULT_CONFIG, LAYER_LABELS, LAYER_ICONS, LAYER_FOOTER } from "./settings";

import {
  handleCompaction,
  generateCompactionLayerResult,
} from "./layer0-compaction";

import {
  injectSelfReviewPrompt,
  analyzeSelfReviewResponse,
  generateSelfReviewLayerResult,
} from "./layer1-self-review";

import {
  injectStructuredReviewPrompt,
  analyzeStructuredReviewResponse,
  generateStructuredLayerResult,
} from "./layer2-structured";

import {
  checkSecurityAvailability,
  injectSecurityAuditPrompt,
  generateSecurityLayerResult,
} from "./layer3-security";

import {
  injectTestGatePrompt,
  analyzeTestGateResponse,
  generateTestLayerResult,
} from "./layer4-test-gate";

import {
  injectHumanReviewPrompt,
} from "./layer5-human";

import { generateReport } from "./report";
import { updateFooter } from "./footer";
import {
  installGitHook,
  uninstallGitHook,
  setGateMarker,
  clearGateMarker,
  isHookInstalled,
} from "./git-hook";
import { checkQualityMetrics } from "./quality-metrics";
import {
  GATE_MODEL_PRESETS,
  getGateModelPresets,
  runInteractiveModelPicker,
  type GateModelKey,
} from "./model-picker";
import {
  rememberImplementModel,
  restoreImplementModel,
  switchGateModelForLayer,
} from "./gate-layer-model";
import { formatModelRef } from "./model-registry";

// ── Extension entry ────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Persistent gate state — survives turns within a session
  let gate: GateState | null = null;

  // Track whether we injected a prompt this turn (to avoid double-inject)
  let promptInjectedThisTurn = false;
  let pendingLayerAdvance: GateLayer | null = null;

  // ── Helpers ──────────────────────────────────────────────────────

  async function getConfig(): Promise<GateConfig> {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const os = await import("node:os");
      const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
      const raw = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      const userConfig = raw.prePushGate ?? {};
      return { ...DEFAULT_CONFIG, ...userConfig, layers: { ...DEFAULT_CONFIG.layers, ...(userConfig.layers ?? {}) }, models: { ...DEFAULT_CONFIG.models, ...(userConfig.models ?? {}) }, qualityMetrics: { ...DEFAULT_CONFIG.qualityMetrics, ...(userConfig.qualityMetrics ?? {}) } };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  function reset() {
    gate = null;
    promptInjectedThisTurn = false;
    pendingLayerAdvance = null;
    updateFooter(pi, null);
  }

  async function advanceToLayer(layer: GateLayer, ctx?: ExtensionContext) {
    if (!gate) return;
    gate.phase = layer;
    pendingLayerAdvance = null;
    await handleLayerEntry(layer, ctx);
  }

  async function queueLayerPrompt(
    layer: GateLayer,
    ctx: ExtensionContext | undefined,
    inject: () => void,
  ) {
    if (!gate) return;
    if (ctx) {
      await switchGateModelForLayer(pi, ctx, gate, layer);
    }
    promptInjectedThisTurn = true;
    inject();
  }

  async function handleLayerEntry(layer: GateLayer, ctx?: ExtensionContext) {
    if (!gate) return;
    const config = gate.config;

    switch (layer) {
      case GateLayer.COMPACTION: {
        const compacted = await handleCompaction(pi, gate);
        const result = generateCompactionLayerResult(compacted);
        gate.layers.push(result);
        updateFooter(pi, gate);
        await advanceToLayer(GateLayer.SELF_REVIEW, ctx);
        break;
      }

      case GateLayer.SELF_REVIEW: {
        gate.currentIteration = 0;
        updateFooter(pi, gate);
        await queueLayerPrompt(layer, ctx, () => injectSelfReviewPrompt(pi, gate));
        break;
      }

      case GateLayer.STRUCTURED: {
        updateFooter(pi, gate);
        const qualityIssues = checkQualityMetrics(gate.config);
        if (qualityIssues.length > 0) {
          gate.findings.push(...qualityIssues);
        }
        await queueLayerPrompt(layer, ctx, () =>
          injectStructuredReviewPrompt(pi, gate),
        );
        break;
      }

      case GateLayer.SECURITY: {
        const available = await checkSecurityAvailability();
        if (!available && gate.config.layers.security === "auto") {
          // Skip security layer — piolium not installed
          const result: LayerResult = {
            layer: GateLayer.SECURITY,
            passed: true,
            findings: [],
            durationMs: 0,
            summary: "Security audit skipped (piolium not installed)",
          };
          gate.layers.push(result);
          updateFooter(pi, gate);
          await advanceToLayer(GateLayer.TEST, ctx);
          return;
        }
        updateFooter(pi, gate);
        await queueLayerPrompt(layer, ctx, () =>
          injectSecurityAuditPrompt(pi, gate),
        );
        break;
      }

      case GateLayer.TEST: {
        updateFooter(pi, gate);
        await queueLayerPrompt(layer, ctx, () => injectTestGatePrompt(pi, gate));
        break;
      }

      case GateLayer.HUMAN: {
        updateFooter(pi, gate);
        injectHumanReviewPrompt(pi, gate);
        break;
      }

      case GateLayer.PASSED:
      case GateLayer.BLOCKED:
        await finalizeGate(ctx);
        break;

      default:
        break;
    }
  }

  async function finalizeGate(ctx?: ExtensionContext) {
    if (!gate) return;

    const verdict = computeVerdict(gate.layers, gate.config);
    gate.verdict = verdict;
    gate.finishedAt = Date.now();
    gate.phase = verdict === "pass" ? GateLayer.PASSED : GateLayer.BLOCKED;

    // Generate report
    await generateReport(gate);

    // Set marker for git hook
    if (verdict === "pass") {
      setGateMarker(gate);
      // Auto-push if configured
      if (gate.config.autoPushOnPass) {
        try {
          const { execSync } = await import("node:child_process");
          execSync("git push", { stdio: "inherit", cwd: process.cwd() });
          pi.ui?.notify("🚀 Auto-pushed to remote", "success");
        } catch {
          pi.ui?.notify("❌ Auto-push failed — check remotes", "error");
        }
      } else {
        pi.ui?.notify("✅ Gate PASSED — ready to git push", "success");
      }
    } else {
      clearGateMarker(gate);
      pi.ui?.notify(
        `⛔ Gate BLOCKED — ${gate.findings.filter((f) => f.severity === Severity.CRITICAL && !f.resolved).length} critical issues`,
        "error"
      );
    }

    updateFooter(pi, gate);

    if (ctx) {
      await restoreImplementModel(pi, ctx, gate);
    }
  }

  // ── Events ───────────────────────────────────────────────────────

  // Load settings on session start
  pi.on("session_start", async (_event, _ctx) => {
    reset();
  });

  // Auto-trigger detection on agent response
  pi.on("agent_end", async (event, ctx) => {
    const responseText = event.response?.content
      ?.map((c: any) => c.text ?? "")
      .join(" ") ?? "";

    // If gate is active, process current layer response
    if (gate && gate.phase !== GateLayer.IDLE) {
      await processLayerResponse(responseText, ctx);
      return;
    }

    // Auto-trigger: detect plan completion
    if (!gate && (await getConfig()).autoTrigger) {
      if (detectTrigger(responseText)) {
        await startGate(ctx);
      }
    }
  });

  async function processLayerResponse(responseText: string, ctx: ExtensionContext) {
    if (!gate) return;

    const config = gate.config;

    switch (gate.phase) {
      case GateLayer.SELF_REVIEW: {
        const { exit, issuesFixed } = analyzeSelfReviewResponse(responseText);

        if (exit && !issuesFixed) {
          // No issues — move to next layer
          const result = generateSelfReviewLayerResult(gate);
          gate.layers.push(result);
          gate.currentIteration = 0;
          await advanceToLayer(GateLayer.STRUCTURED, ctx);
        } else if (issuesFixed) {
          // Issues fixed — loop again
          gate.currentIteration++;
          if (gate.currentIteration >= config.maxIterations) {
            const result = generateSelfReviewLayerResult(gate);
            gate.layers.push(result);
            gate.currentIteration = 0;
            await advanceToLayer(GateLayer.STRUCTURED, ctx);
          } else {
            updateFooter(pi, gate);
            await queueLayerPrompt(gate.phase, ctx, () =>
              injectSelfReviewPrompt(pi, gate),
            );
          }
        } else {
          // Unclear — advance
          gate.currentIteration++;
          if (gate.currentIteration >= config.maxIterations) {
            const result = generateSelfReviewLayerResult(gate);
            gate.layers.push(result);
            gate.currentIteration = 0;
            await advanceToLayer(GateLayer.STRUCTURED, ctx);
          } else {
            updateFooter(pi, gate);
            await queueLayerPrompt(gate.phase, ctx, () =>
              injectSelfReviewPrompt(pi, gate),
            );
          }
        }
        break;
      }

      case GateLayer.STRUCTURED: {
        const { passed, findings } = analyzeStructuredReviewResponse(responseText);
        const layerFindings = findings.map((f) =>
          createFinding(GateLayer.STRUCTURED, f.severity, f.message, {
            file: f.file,
            line: f.line,
            suggestion: f.suggestion,
          })
        );
        const result = generateStructuredLayerResult(passed, layerFindings);
        gate.layers.push(result);

        if (!passed) {
          await finalizeGate(ctx);
        } else {
          const next = nextLayer(GateLayer.STRUCTURED, config);
          if (next) await advanceToLayer(next, ctx);
          else await finalizeGate(ctx);
        }
        break;
      }

      case GateLayer.SECURITY: {
        const result = generateSecurityLayerResult(responseText);
        gate.layers.push(result);

        if (!result.passed) {
          await finalizeGate(ctx);
        } else {
          const next = nextLayer(GateLayer.SECURITY, config);
          if (next) await advanceToLayer(next, ctx);
          else await finalizeGate(ctx);
        }
        break;
      }

      case GateLayer.TEST: {
        const { passed, findings } = analyzeTestGateResponse(responseText);
        const layerFindings = findings.map((f) =>
          createFinding(GateLayer.TEST, f.severity, f.message, {
            file: f.file,
            line: f.line,
          })
        );
        const result = generateTestLayerResult(passed, layerFindings);
        gate.layers.push(result);

        if (!passed) {
          await finalizeGate(ctx);
        } else {
          const next = nextLayer(GateLayer.TEST, config);
          if (next) await advanceToLayer(next, ctx);
          else await finalizeGate(ctx);
        }
        break;
      }

      case GateLayer.HUMAN: {
        // Human phase is passive — user runs /gate approve or /gate reject
        break;
      }

      default:
        break;
    }
  }

  /**
   * Update all gate models in ~/.pi/agent/settings.json
   */
  async function updateGateModels(
    ctx: ExtensionContext,
    models: Record<string, string>
  ): Promise<void> {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const os = await import("node:os");

      const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
      let settings: any = {};

      if (fs.existsSync(settingsPath)) {
        settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      }

      if (!settings.prePushGate) settings.prePushGate = {};
      if (!settings.prePushGate.models) settings.prePushGate.models = {};

      Object.assign(settings.prePushGate.models, models);

      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf-8");

      ctx.ui.notify?.("💾 Models saved to settings.json", "info");
    } catch (e: any) {
      ctx.ui.notify?.(`❌ Failed to save models: ${e.message}`, "error");
    }
  }

  /**
   * Update a single gate model setting.
   */
  async function updateGateModel(
    ctx: ExtensionContext,
    key: string,
    modelId: string
  ): Promise<void> {
    await updateGateModels(ctx, { [key]: modelId });
  }

  const LAYER_KEYS: Record<string, GateModelKey> = {
    l1: "selfReview",
    "self-review": "selfReview",
    l2: "structuredReview",
    structured: "structuredReview",
    l3: "securityAudit",
    security: "securityAudit",
    l4: "testGate",
    test: "testGate",
    tests: "testGate",
  };

  async function openModelPicker(ctx: ExtensionContext) {
    const cfg = await getConfig();
    await runInteractiveModelPicker(ctx, cfg.models, {
      applyPresetAll: async (preset, models) => {
        await updateGateModels(ctx, models);
        ctx.ui.notify(`✅ All layers → ${preset} preset`, "success");
      },
      applyPresetLayer: async (layer, preset, modelId) => {
        await updateGateModel(ctx, layer, modelId);
        ctx.ui.notify(`✅ ${layer} → ${modelId} (${preset})`, "success");
      },
      applyCustomAll: async (modelId) => {
        await updateGateModels(ctx, {
          selfReview: modelId,
          structuredReview: modelId,
          securityAudit: modelId,
          testGate: modelId,
        });
        ctx.ui.notify(`✅ All layers → ${modelId}`, "success");
      },
      applyCustomLayer: async (layer, modelId) => {
        await updateGateModel(ctx, layer, modelId);
        ctx.ui.notify(`✅ ${layer} → ${modelId}`, "success");
      },
    }, ctx.modelRegistry);
  }

  async function handleGateModelCli(
    ctx: ExtensionContext,
    modelSub: string,
    modelVal: string,
  ) {
    const PRESETS = getGateModelPresets(ctx.modelRegistry);

    if (modelSub === "" || modelSub === "show" || modelSub === "pick" || modelSub === "ui") {
      await openModelPicker(ctx);
      return;
    }

    if (modelSub === "presets") {
      const lines = ["📦 Available Presets:", ""];
      for (const [name, models] of Object.entries(PRESETS)) {
        lines.push(`  ${name}:`);
        for (const [layer, model] of Object.entries(models)) {
          lines.push(`    ${layer}: ${model}`);
        }
      }
      lines.push("", "Usage: /gate model <preset> or /gate-model");
      ctx.ui.notify(lines.join("\n"), "info");
      return;
    }

    if (PRESETS[modelSub]) {
      await updateGateModels(ctx, PRESETS[modelSub]);
      ctx.ui.notify(`✅ Models set to "${modelSub}" preset`, "success");
      return;
    }

    if (LAYER_KEYS[modelSub]) {
      const key = LAYER_KEYS[modelSub];
      const modelId = modelVal.replace(/^"|"$/g, "");
      if (!modelId || modelId === modelSub) {
        ctx.ui.notify(
          `Usage: /gate model ${modelSub} <provider/model-id>`,
          "warn",
        );
        return;
      }
      await updateGateModel(ctx, key, modelId);
      ctx.ui.notify(`✅ ${modelSub.toUpperCase()} model → ${modelId}`, "success");
      return;
    }

    if (modelVal.includes("/")) {
      await updateGateModels(ctx, {
        selfReview: modelVal,
        structuredReview: modelVal,
        securityAudit: modelVal,
        testGate: modelVal,
      });
      ctx.ui.notify(`✅ All layers → ${modelVal}`, "success");
      return;
    }

    ctx.ui.notify(
      `Unknown "${modelSub}". Try /gate-model (TUI) or /gate model presets`,
      "warn",
    );
  }

  async function startGate(ctx?: ExtensionContext) {
    const config = await getConfig();
    gate = createGateState(config);
    gate.startedAt = Date.now();

    if (ctx?.model) {
      rememberImplementModel(gate, ctx.model);
    }

    ctx?.ui?.notify?.("🛡 Pre-push gate activated — 5-layer review pipeline", "info");
    updateFooter(pi, gate);

    // Start with Layer 0: Compaction
    await handleLayerEntry(GateLayer.COMPACTION, ctx);
  }

  // ── Commands ─────────────────────────────────────────────────────

  pi.registerCommand("gate", {
    description: "Start or manage the 5-layer pre-push review pipeline",
    handler: async (args, ctx) => {
      const trimmed = (args ?? "").trim();
      const parts = trimmed.length ? trimmed.split(/\s+/) : [];
      const sub = parts[0]?.toLowerCase() ?? "";

      switch (sub) {
        case "":
        case "start":
          if (gate && gate.phase !== GateLayer.IDLE && gate.phase !== GateLayer.PASSED && gate.phase !== GateLayer.BLOCKED) {
            ctx.ui.notify("Gate already running — use /gate status", "warn");
          } else {
            await startGate(ctx);
          }
          break;

        case "quick":
          // Fast path: skip compaction + security + human
          {
            if (gate && gate.phase !== GateLayer.IDLE) {
              ctx.ui.notify("Gate already running", "warn");
              return;
            }
            const config = await getConfig();
            config.layers.compaction = false;
            config.layers.security = "off";
            config.layers.humanReview = "never";
            gate = createGateState(config);
            gate.startedAt = Date.now();
            rememberImplementModel(gate, ctx.model);
            ctx.ui.notify("🛡 Quick gate activated (skip security + human)", "info");
            updateFooter(pi, gate);
            await handleLayerEntry(GateLayer.SELF_REVIEW, ctx);
          }
          break;

        case "status":
          if (!gate || gate.phase === GateLayer.IDLE) {
            ctx.ui.notify("No active gate — run /gate to start", "info");
          } else {
            const elapsed = Date.now() - gate.startedAt;
            const secs = Math.floor(elapsed / 1000);
            const mins = Math.floor(secs / 60);
            const remainSecs = secs % 60;

            const lines: string[] = [
              `🛡 Gate Status: ${gate.phase.toUpperCase()}`,
              `⏱ Elapsed: ${mins}m ${remainSecs}s`,
              `📊 Layers: ${gate.layers.length} completed`,
              `🔍 Findings: ${gate.findings.length} total`,
            ];

            if (gate.phase === GateLayer.SELF_REVIEW) {
              lines.push(`🔄 Iteration: ${gate.currentIteration}/${gate.config.maxIterations}`);
            }

            if (gate.verdict !== "pending") {
              lines.push(
                gate.verdict === "pass"
                  ? "✅ Verdict: PASS"
                  : "⛔ Verdict: BLOCKED"
              );
            }

            ctx.ui.notify(lines.join("\n"), "info");
          }
          break;

        case "report":
          if (!gate) {
            ctx.ui.notify("No gate report — run /gate first", "warn");
          } else {
            await generateReport(gate);
            ctx.ui.notify(`📄 Report: ${gate.reportPath}`, "info");
          }
          break;

        case "approve":
          if (!gate || gate.phase !== GateLayer.HUMAN) {
            ctx.ui.notify("No human review pending", "warn");
          } else {
            gate.humanApproved = true;
            ctx.ui.notify("✅ Human review approved", "success");
            await finalizeGate(ctx);
          }
          break;

        case "reject":
          if (!gate || gate.phase !== GateLayer.HUMAN) {
            ctx.ui.notify("No human review pending", "warn");
          } else {
            gate.humanApproved = false;
            gate.verdict = "fail";
            gate.phase = GateLayer.BLOCKED;
            gate.finishedAt = Date.now();
            clearGateMarker(gate);
            await generateReport(gate);
            ctx.ui.notify("⛔ Human review rejected — gate BLOCKED", "error");
            updateFooter(pi, gate);
            await restoreImplementModel(pi, ctx, gate);
          }
          break;

        case "abort":
          if (gate) {
            gate.phase = GateLayer.ABORTED;
            gate.finishedAt = Date.now();
            clearGateMarker(gate);
            await generateReport(gate);
            ctx.ui.notify("🛑 Gate aborted", "warn");
            await restoreImplementModel(pi, ctx, gate);
            reset();
          }
          break;

        case "hook":
          {
            const hookSub = parts[1]?.toLowerCase() ?? "";
            switch (hookSub) {
              case "install":
                try {
                  installGitHook(await getConfig());
                  ctx.ui.notify("✅ Pre-push hook installed → .git/hooks/pre-push", "success");
                } catch (e: any) {
                  ctx.ui.notify(`❌ Hook install failed: ${e.message}`, "error");
                }
                break;
              case "uninstall":
                try {
                  uninstallGitHook();
                  ctx.ui.notify("🗑 Pre-push hook removed", "info");
                } catch (e: any) {
                  ctx.ui.notify(`❌ Hook uninstall failed: ${e.message}`, "error");
                }
                break;
              case "status":
                if (isHookInstalled()) {
                  ctx.ui.notify("✅ Pre-push hook is active", "info");
                } else {
                  ctx.ui.notify("❌ No pre-push hook installed — run /gate hook install", "warn");
                }
                break;
              default:
                ctx.ui.notify("Usage: /gate hook [install|uninstall|status]", "info");
            }
          }
          break;

        case "model":
          await handleGateModelCli(
            ctx,
            parts[1]?.toLowerCase() ?? "",
            parts.slice(2).join(" ") || "",
          );
          break;

        case "config":
          {
            const cfg = await getConfig();
            const lines = [
              "🛡 Pre-Push Gate Config:",
              `  Layers: compaction=${cfg.layers.compaction} self-review=${cfg.layers.selfReview} structured=${cfg.layers.structured} security=${cfg.layers.security} test=${cfg.layers.testGate} human=${cfg.layers.humanReview}`,
              `  Models: self-review=${cfg.models.selfReview} structured=${cfg.models.structuredReview} security=${cfg.models.securityAudit} test=${cfg.models.testGate}`,
              `  Self-review: ${cfg.maxIterations} iterations, freshContext=${cfg.freshContext}`,
              `  Trigger: autoTrigger=${cfg.autoTrigger}`,
              `  Git: base=${cfg.baseBranch} hook=${cfg.hookMode} autoPush=${cfg.autoPushOnPass}`,
              `  Severity gate: ${cfg.minSeverity}`,
              `  Quality: maxLines=${cfg.qualityMetrics.maxLinesPerFunction} maxParams=${cfg.qualityMetrics.maxParamsPerFunction} maxNesting=${cfg.qualityMetrics.maxNestingDepth}`,
            ];
            ctx.ui.notify(lines.join("\n"), "info");
          }
          break;

        default:
          ctx.ui.notify(
            "Usage: /gate [start|quick|status|report|approve|reject|abort|hook|model|config] · /gate-model",
            "info"
          );
      }
    },
  });

  pi.registerCommand("gate-model", {
    description: "Interactive TUI to configure pi-sentinel gate models",
    handler: async (args, ctx) => {
      const sub = (args ?? "").trim().toLowerCase();
      if (!sub) {
        await openModelPicker(ctx);
        return;
      }
      await handleGateModelCli(ctx, sub, "");
    },
  });

  // ── Tool: gate_control (for agent to query/control gate) ─────────

  pi.registerTool({
    name: "gate_control",
    label: "Gate Control",
    description:
      "Query or control the pre-push gate pipeline. Returns current status, findings, and allows the agent to acknowledge or resolve issues.",
    parameters: Type.Object({
      action: Type.Optional(
        Type.String({ description: "Action: status, resolve, retry, skip" })
      ),
      findingId: Type.Optional(
        Type.String({ description: "Finding ID to resolve (for resolve action)" })
      ),
    }),
    async execute(toolCallId, params, _signal, _onUpdate, _ctx) {
      if (!gate) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ active: false, message: "No active gate" }),
            },
          ],
          details: {},
        };
      }

      const action = params.action ?? "status";

      switch (action) {
        case "status": {
          const summary = {
            active: true,
            phase: gate.phase,
            iteration: gate.currentIteration,
            maxIterations: gate.config.maxIterations,
            layersCompleted: gate.layers.length,
            totalFindings: gate.findings.length,
            findings: gate.findings
              .filter((f) => !f.resolved)
              .map((f) => ({
                id: f.id,
                layer: f.layer,
                severity: f.severity,
                file: f.file,
                line: f.line,
                message: f.message,
              })),
            verdict: gate.verdict,
            elapsedMs: Date.now() - gate.startedAt,
          };
          return {
            content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
            details: {},
          };
        }

        case "resolve": {
          const fid = params.findingId;
          if (!fid) {
            return {
              content: [{ type: "text", text: "Error: findingId required for resolve" }],
              details: {},
            };
          }
          const found = gate.findings.find((f) => f.id === fid);
          if (found) {
            found.resolved = true;
            return {
              content: [
                {
                  type: "text",
                  text: JSON.stringify({ resolved: true, findingId: fid }),
                },
              ],
              details: {},
            };
          }
          return {
            content: [
              { type: "text", text: JSON.stringify({ resolved: false, error: "Finding not found" }) },
            ],
            details: {},
          };
        }

        case "retry": {
          // Retry current layer
          if (gate.phase !== GateLayer.IDLE && gate.phase !== GateLayer.PASSED && gate.phase !== GateLayer.BLOCKED) {
            await handleLayerEntry(gate.phase);
          }
          return {
            content: [{ type: "text", text: JSON.stringify({ retried: true, phase: gate.phase }) }],
            details: {},
          };
        }

        default:
          return {
            content: [{ type: "text", text: JSON.stringify({ error: "Unknown action", validActions: ["status", "resolve", "retry"] }) }],
            details: {},
          };
      }
    },
  });

  // ── Cleanup ──────────────────────────────────────────────────────

  pi.on("session_shutdown", async () => {
    reset();
  });
}