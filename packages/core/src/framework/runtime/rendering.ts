import type { Child } from "../../jsx.js";
import { h } from "../../jsx.js";
import type {
  AnyRecord,
  PageRuntimeOptions,
  PageRouteDefinition,
  RouteDataLayer
} from "../types.js";
import type { RouterParams } from "../../router/index.js";

export function isClientRuntime(): boolean {
  return typeof (globalThis as { document?: unknown }).document !== "undefined";
}

export function isServerRuntime(): boolean {
  return !isClientRuntime();
}

export const isBrowserRuntime = isClientRuntime;

export function renderCsrFallback(
  fallback: PageRuntimeOptions["csrFallback"],
  pathname: string,
  params: RouterParams
): Child {
  if (typeof fallback === "function") {
    return fallback({ pathname, params });
  }
  return fallback ?? null;
}

export function withLayouts(
  node: Child,
  layoutLayers: PageRouteDefinition["layoutLayers"],
  props: AnyRecord,
  layers: RouteDataLayer[]
): Child {
  const layerById = new Map(layers.map((layer) => [layer.id, layer]));
  let current = node;
  for (let index = layoutLayers.length - 1; index >= 0; index -= 1) {
    const layoutLayer = layoutLayers[index];
    const resolvedLayer = layerById.get(layoutLayer.id);
    current = h(layoutLayer.component, {
      ...props,
      layerId: layoutLayer.id,
      data: resolvedLayer?.data,
      error: resolvedLayer?.error,
      children: current
    });
  }
  return current;
}
