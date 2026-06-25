/**
 * Resolve gate model strings against Pi ModelRegistry (~/.pi/agent/models.json).
 */
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ModelRegistry } from "@earendil-works/pi-coding-agent";
import type { GateModelKey } from "./model-picker";

export type ParsedModelRef = {
  provider?: string;
  modelId: string;
  raw: string;
};

/** Display id stored in settings (provider/id). */
export function formatModelRef(model: Model<Api>): string {
  return `${model.provider}/${model.id}`;
}

export function parseModelRef(raw: string): ParsedModelRef {
  const trimmed = raw.trim();
  const slash = trimmed.indexOf("/");
  if (slash > 0) {
    return {
      provider: trimmed.slice(0, slash),
      modelId: trimmed.slice(slash + 1),
      raw: trimmed,
    };
  }
  return { modelId: trimmed, raw: trimmed };
}

export function findModelInRegistry(
  registry: ModelRegistry,
  raw: string,
): Model<Api> | undefined {
  registry.refresh?.();
  const parsed = parseModelRef(raw);

  if (parsed.provider) {
    const exact = registry.find(parsed.provider, parsed.modelId);
    if (exact) return exact;
  }

  const available = registry.getAvailable();
  const byId = available.filter((m) => m.id === parsed.modelId);
  if (byId.length === 1) return byId[0];
  if (byId.length > 1 && parsed.provider) {
    return byId.find((m) => m.provider === parsed.provider);
  }

  const needle = parsed.modelId.toLowerCase();
  const fuzzy = available.filter(
    (m) =>
      m.id.toLowerCase() === needle ||
      m.id.toLowerCase().endsWith(`/${needle}`) ||
      m.id.toLowerCase().includes(needle),
  );
  if (fuzzy.length === 1) return fuzzy[0];

  return undefined;
}

export function listAvailableModels(registry: ModelRegistry): Model<Api>[] {
  registry.refresh?.();
  return registry.getAvailable().sort((a, b) => {
    const pa = `${a.provider}/${a.id}`;
    const pb = `${b.provider}/${b.id}`;
    return pa.localeCompare(pb);
  });
}

const LAYER_MODEL_HINTS: Record<GateModelKey, RegExp[]> = {
  selfReview: [/ministral-8/i, /haiku/i, /flash/i, /mini/i, /small/i],
  structuredReview: [/medium/i, /sonnet/i, /pro/i, /large/i, /reasoner/i],
  securityAudit: [/medium/i, /sonnet/i, /pro/i, /large/i, /reasoner/i],
  testGate: [/ministral-3/i, /haiku/i, /flash/i, /mini/i, /small/i],
};

export function rankModelsForLayer(
  models: Model<Api>[],
  layer: GateModelKey,
): Model<Api>[] {
  const hints = LAYER_MODEL_HINTS[layer];
  const scored = models.map((m) => {
    const hay = `${m.provider}/${m.id} ${m.name ?? ""}`.toLowerCase();
    const score = hints.reduce(
      (s, re) => (re.test(hay) ? s + 1 : s),
      0,
    );
    return { m, score };
  });
  scored.sort((a, b) => b.score - a.score || formatModelRef(a.m).localeCompare(formatModelRef(b.m)));
  return scored.map((x) => x.m);
}

/** Built-in lineup using models.json when present (e.g. cf/* on 9router). */
export function buildRouterPreset(registry: ModelRegistry): Record<string, string> | null {
  const available = listAvailableModels(registry);
  if (available.length === 0) return null;

  const pick = (patterns: RegExp[]): string | undefined => {
    for (const re of patterns) {
      const hit = available.find((m) =>
        re.test(`${m.provider}/${m.id}`.toLowerCase()),
      );
      if (hit) return formatModelRef(hit);
    }
    return undefined;
  };

  const selfReview =
    pick([/cf\/ministral-8b/, /ministral-8b/]) ??
    pick([/ministral-8/i, /haiku/i, /flash/i]);
  const structured =
    pick([/cf\/mistral-medium/, /mistral-medium/]) ??
    pick([/medium/i, /sonnet/i, /pro/i]);
  const security = structured;
  const testGate =
    pick([/cf\/ministral-3b/, /ministral-3b/]) ??
    pick([/ministral-3/i, /haiku/i, /flash/i]);

  if (!selfReview || !structured || !testGate) return null;

  return {
    selfReview,
    structuredReview: structured,
    securityAudit: security ?? structured,
    testGate,
  };
}

export async function applyGateModelForLayer(
  registry: ModelRegistry,
  setModel: (model: Model<Api>) => Promise<boolean>,
  layerKey: GateModelKey,
  modelRef: string,
  notify?: (msg: string, type: "info" | "warning" | "error") => void,
): Promise<{ ok: boolean; ref: string; model?: Model<Api> }> {
  const model = findModelInRegistry(registry, modelRef);
  if (!model) {
    notify?.(`Gate ${layerKey}: model not in registry — ${modelRef}`, "warning");
    return { ok: false, ref: modelRef };
  }

  const ok = await setModel(model);
  if (!ok) {
    notify?.(
      `Gate ${layerKey}: no auth for ${formatModelRef(model)}`,
      "warning",
    );
    return { ok: false, ref: formatModelRef(model), model };
  }

  return { ok: true, ref: formatModelRef(model), model };
}