import type { Api, Model } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { GateModelKey } from "./model-picker";
import { applyGateModelForLayer, findModelInRegistry } from "./model-registry";
import { GateLayer, type GateState } from "./state";

const LAYER_TO_CONFIG_KEY: Partial<Record<GateLayer, GateModelKey>> = {
  [GateLayer.SELF_REVIEW]: "selfReview",
  [GateLayer.STRUCTURED]: "structuredReview",
  [GateLayer.SECURITY]: "securityAudit",
  [GateLayer.TEST]: "testGate",
};

export async function switchGateModelForLayer(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  gate: GateState,
  layer: GateLayer,
): Promise<void> {
  const key = LAYER_TO_CONFIG_KEY[layer];
  if (!key) return;

  const ref = gate.config.models[key];
  const result = await applyGateModelForLayer(
    ctx.modelRegistry,
    (model) => pi.setModel(model),
    key,
    ref,
    (msg, type) => ctx.ui.notify?.(msg, type),
  );

  gate.layerModels.set(layer, result.ref);
}

export function rememberImplementModel(
  gate: GateState,
  model: Model<Api> | undefined,
): void {
  if (!model) return;
  gate.layerModels.set(GateLayer.IDLE, `${model.provider}/${model.id}`);
}

export async function restoreImplementModel(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  gate: GateState,
): Promise<void> {
  const saved = gate.layerModels.get(GateLayer.IDLE);
  if (!saved) return;

  const model = findModelInRegistry(ctx.modelRegistry, saved);
  if (model) {
    await pi.setModel(model);
  }
}