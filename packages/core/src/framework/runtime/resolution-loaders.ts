import { emitInstrumentation } from "../../instrumentation.js";
import type { RouterParams } from "../../router/index.js";
import type { NormalizedPageRequest } from "../../ssr/request.js";
import type {
  PageRouteDefinition,
  PageRuntimeOptions,
  RouteDataLayer
} from "../types.js";
import { isNotFoundSignal } from "../not-found.js";
import { createPageContext } from "./context.js";
import { shouldRunLoader } from "./setup.js";
import { runSsrLoadWithTimerGuard } from "./timers.js";

type LoadRouteDataOptions = {
  pathname: string;
  params: RouterParams;
  route: PageRouteDefinition;
  request: NormalizedPageRequest;
  requestId: string;
  locale?: string;
  applyLocale(locale?: string): void;
  instrumentation: PageRuntimeOptions["instrumentation"];
  onPagePending?: (
    layers: RouteDataLayer[],
    layerData: Record<string, unknown>
  ) => void;
};

type LoaderTarget = {
  id: string;
  kind: RouteDataLayer["kind"];
  load: PageRouteDefinition["load"];
};

async function runLoader(
  target: LoaderTarget,
  layerData: Record<string, unknown>,
  options: LoadRouteDataOptions
): Promise<RouteDataLayer> {
  let data: unknown = null;
  let error: unknown = null;
  const startedAt = Date.now();
  emitInstrumentation(options.instrumentation, {
    name: "route.loader",
    phase: "start",
    requestId: options.requestId,
    route: options.route.path,
    layer: target.id
  });
  try {
    options.applyLocale(options.locale);
    const label = target.kind === "layout"
      ? `load() for layout "${target.id}" on "${options.pathname}"`
      : `load() for route "${options.route.path}" on "${options.pathname}"`;
    data = await runSsrLoadWithTimerGuard(label, () => {
      options.request.request.signal.throwIfAborted();
      return target.load!(
        createPageContext(
          options.pathname,
          options.params,
          options.request,
          layerData
        )
      );
    });
    options.request.request.signal.throwIfAborted();
    emitInstrumentation(options.instrumentation, {
      name: "route.loader",
      phase: "end",
      requestId: options.requestId,
      route: options.route.path,
      layer: target.id,
      durationMs: Date.now() - startedAt
    });
  } catch (loadError) {
    emitInstrumentation(options.instrumentation, {
      name: "route.loader",
      phase: options.request.request.signal.aborted ? "abort" : "error",
      requestId: options.requestId,
      route: options.route.path,
      layer: target.id,
      durationMs: Date.now() - startedAt,
      error: loadError
    });
    if (options.request.request.signal.aborted) throw loadError;
    error = loadError;
  }
  return { id: target.id, kind: target.kind, data, error };
}

export async function loadRouteData(options: LoadRouteDataOptions): Promise<{
  data: unknown;
  error: unknown;
  layers: RouteDataLayer[];
  layerData: Record<string, unknown>;
}> {
  const layers: RouteDataLayer[] = [];
  const layerData: Record<string, unknown> = {};
  for (const layout of options.route.layoutLayers) {
    const layer = layout.load && shouldRunLoader(layout.load)
      ? await runLoader({
          id: layout.id,
          kind: "layout",
          load: layout.load
        }, layerData, options)
      : { id: layout.id, kind: "layout" as const, data: null, error: null };
    layers.push(layer);
    if (isNotFoundSignal(layer.error)) {
      return { data: null, error: layer.error, layers, layerData };
    }
    if (layer.error === null) layerData[layer.id] = layer.data;
  }
  if (
    options.route.pending &&
    options.route.load &&
    shouldRunLoader(options.route.load) &&
    layers.every((layer) => layer.error === null)
  ) {
    options.request.request.signal.throwIfAborted();
    options.onPagePending?.(layers, layerData);
  }
  const page = options.route.load && shouldRunLoader(options.route.load)
    ? await runLoader({
        id: options.route.path,
        kind: "page",
        load: options.route.load
      }, layerData, options)
    : { id: options.route.path, kind: "page" as const, data: null, error: null };
  layers.push(page);
  if (page.error === null) layerData[page.id] = page.data;
  return { data: page.data, error: page.error, layers, layerData };
}
