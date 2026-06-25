/**
 * Interactive TUI model picker for pi-sentinel gate.
 * Pattern matches pi-coding-agent examples/extensions/preset.ts (no overlay).
 */
import {
  Container,
  type SelectItem,
  SelectList,
  Text,
} from "@earendil-works/pi-tui";
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import {
  buildRouterPreset,
  formatModelRef,
  rankModelsForLayer,
  listAvailableModels,
} from "./model-registry";

// ── Presets (shared with CLI) ──────────────────────────────────────

export const GATE_MODEL_PRESETS: Record<string, Record<string, string>> = {
  mistral: {
    selfReview: "mistral/ministral-8b-2512",
    structuredReview: "mistral/mistral-medium-2508",
    securityAudit: "mistral/mistral-medium-2508",
    testGate: "mistral/ministral-3b-2512",
  },
  anthropic: {
    selfReview: "anthropic/claude-haiku-4-5",
    structuredReview: "anthropic/claude-sonnet-4",
    securityAudit: "anthropic/claude-sonnet-4",
    testGate: "anthropic/claude-haiku-4-5",
  },
  google: {
    selfReview: "google/gemini-2.5-flash",
    structuredReview: "google/gemini-2.5-pro",
    securityAudit: "google/gemini-2.5-pro",
    testGate: "google/gemini-2.5-flash",
  },
  openai: {
    selfReview: "openai/gpt-4o-mini",
    structuredReview: "openai/gpt-4o",
    securityAudit: "openai/gpt-4o",
    testGate: "openai/gpt-4o-mini",
  },
  deepseek: {
    selfReview: "deepseek/deepseek-chat",
    structuredReview: "deepseek/deepseek-reasoner",
    securityAudit: "deepseek/deepseek-reasoner",
    testGate: "deepseek/deepseek-chat",
  },
  pinkgreen: {
    selfReview: "cf/ministral-8b-latest",
    structuredReview: "cf/mistral-medium-latest",
    securityAudit: "cf/mistral-medium-latest",
    testGate: "cf/ministral-3b-latest",
  },
};

export function getGateModelPresets(
  registry?: ModelRegistry,
): Record<string, Record<string, string>> {
  const presets = { ...GATE_MODEL_PRESETS };
  if (registry) {
    const router = buildRouterPreset(registry);
    if (router) presets.router = router;
  }
  return presets;
}

export type GateModelKey =
  | "selfReview"
  | "structuredReview"
  | "securityAudit"
  | "testGate";

const LAYER_DISPLAY: Record<string, string> = {
  all: "All Layers",
  selfReview: "L1 · Self-Review",
  structuredReview: "L2 · Structured",
  securityAudit: "L3 · Security",
  testGate: "L4 · Test Gate",
};

function buildLayerItems(
  currentModels: Record<string, string>,
): SelectItem[] {
  return [
    {
      value: "all",
      label: "All Layers",
      description: "Apply one preset to every layer",
    },
    {
      value: "selfReview",
      label: "L1 · Self-Review",
      description: currentModels.selfReview,
    },
    {
      value: "structuredReview",
      label: "L2 · Structured",
      description: currentModels.structuredReview,
    },
    {
      value: "securityAudit",
      label: "L3 · Security",
      description: currentModels.securityAudit,
    },
    {
      value: "testGate",
      label: "L4 · Test Gate",
      description: currentModels.testGate,
    },
  ];
}

function buildPresetItems(
  layer: string,
  presets: Record<string, Record<string, string>>,
  registry?: ModelRegistry,
  layerKey?: GateModelKey,
): SelectItem[] {
  const items: SelectItem[] = Object.entries(presets).map(([name, models]) => {
    const modelForLayer =
      layer === "all"
        ? Object.values(models)[0] ?? "?"
        : models[layer] ?? "?";
    return {
      value: `preset:${name}`,
      label: name.charAt(0).toUpperCase() + name.slice(1),
      description: modelForLayer,
    };
  });

  if (registry && layer !== "all" && layerKey) {
    const ranked = rankModelsForLayer(listAvailableModels(registry), layerKey);
    for (const m of ranked.slice(0, 12)) {
      const ref = formatModelRef(m);
      items.push({
        value: `model:${ref}`,
        label: ref,
        description: m.name ?? m.id,
      });
    }
  }

  items.push({
    value: "__custom__",
    label: "Custom model…",
    description: "provider/model-id from models.json",
  });
  return items;
}

async function pickFromList<T extends string>(
  ctx: ExtensionCommandContext,
  title: string,
  items: SelectItem[],
  maxVisible = 10,
): Promise<T | null> {
  if (ctx.mode !== "tui" || !ctx.hasUI) {
    return null;
  }

  const result = await ctx.ui.custom<T | null>((tui, theme, _kb, done) => {
    const container = new Container();
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
    container.addChild(new Text(theme.fg("accent", theme.bold(title)), 1, 0));

    const selectList = new SelectList(
      items,
      Math.min(items.length, maxVisible),
      {
        selectedPrefix: (t: string) => theme.fg("accent", t),
        selectedText: (t: string) => theme.fg("accent", t),
        description: (t: string) => theme.fg("muted", t),
        scrollInfo: (t: string) => theme.fg("dim", t),
        noMatch: (t: string) => theme.fg("warning", t),
      },
    );

    selectList.onSelect = (item) => done(item.value as T);
    selectList.onCancel = () => done(null);
    container.addChild(selectList);
    container.addChild(
      new Text(
        theme.fg("dim", "↑↓ navigate · enter select · esc cancel"),
        1,
        0,
      ),
    );
    container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

    return {
      render: (width: number) => container.render(width),
      invalidate: () => container.invalidate(),
      handleInput: (data: string) => {
        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  });

  return result;
}

export interface ModelPickerApplyHandlers {
  applyPresetAll: (preset: string, models: Record<string, string>) => Promise<void>;
  applyPresetLayer: (
    layer: GateModelKey,
    preset: string,
    modelId: string,
  ) => Promise<void>;
  applyCustomAll: (modelId: string) => Promise<void>;
  applyCustomLayer: (layer: GateModelKey, modelId: string) => Promise<void>;
}

/**
 * Full interactive flow: layer → preset/custom → save.
 */
export async function runInteractiveModelPicker(
  ctx: ExtensionCommandContext,
  currentModels: Record<string, string>,
  handlers: ModelPickerApplyHandlers,
  registry?: ModelRegistry,
): Promise<void> {
  if (ctx.mode !== "tui" || !ctx.hasUI) {
    ctx.ui.notify(
      "Interactive model picker needs TUI. Use: /gate model presets or /gate model mistral",
      "warning",
    );
    return;
  }

  const layer = await pickFromList<string>(
    ctx,
    "pi-sentinel · Select layer",
    buildLayerItems(currentModels),
  );

  if (!layer) {
    ctx.ui.notify("Model picker cancelled", "info");
    return;
  }

  const layerLabel = LAYER_DISPLAY[layer] ?? layer;
  const currentModel =
    layer === "all"
      ? currentModels.selfReview
      : currentModels[layer] ?? "";

  const presets = getGateModelPresets(registry);

  const preset = await pickFromList<string>(
    ctx,
    `Model for ${layerLabel}${layer !== "all" ? ` (now: ${currentModel})` : ""}`,
    buildPresetItems(layer, presets, registry, layer === "all" ? undefined : (layer as GateModelKey)),
    14,
  );

  if (!preset) {
    ctx.ui.notify("Model picker cancelled", "info");
    return;
  }

  if (preset === "__custom__") {
    const modelId = await ctx.ui.input(
      "Custom model ID",
      "provider/model-id",
    );
    const trimmed = modelId?.trim();
    if (!trimmed) {
      ctx.ui.notify("No model entered", "warning");
      return;
    }
    if (layer === "all") {
      await handlers.applyCustomAll(trimmed);
    } else {
      await handlers.applyCustomLayer(layer as GateModelKey, trimmed);
    }
    return;
  }

  if (preset.startsWith("model:")) {
    const modelId = preset.slice("model:".length);
    if (layer === "all") {
      await handlers.applyCustomAll(modelId);
    } else {
      await handlers.applyCustomLayer(layer as GateModelKey, modelId);
    }
    return;
  }

  if (preset.startsWith("preset:")) {
    const presetName = preset.slice("preset:".length);
    const presetModels = presets[presetName];
    if (!presetModels) {
      ctx.ui.notify(`Unknown preset: ${presetName}`, "error");
      return;
    }

    if (layer === "all") {
      await handlers.applyPresetAll(presetName, presetModels);
    } else {
      const modelId = presetModels[layer];
      if (!modelId) {
        ctx.ui.notify(`Preset ${presetName} has no model for ${layer}`, "error");
        return;
      }
      await handlers.applyPresetLayer(layer as GateModelKey, presetName, modelId);
    }
    return;
  }

  ctx.ui.notify(`Unknown selection: ${preset}`, "error");
}