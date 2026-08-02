import { h, type Child, type Component } from "../../jsx.js";
import { isDeferredPlaceholderComponent } from "../manifest.js";
import type {
  PagesRuntimePending,
  PageRuntimeOptions,
  PagesManifest,
  PagesRuntimeResolved
} from "../types.js";
import { isBrowserRuntime, withLayouts } from "./rendering.js";

type RuntimeRendererOptions = {
  manifest: PagesManifest;
  runtimeOptions?: PageRuntimeOptions;
  resolvePath(pathname: string): Pick<PagesRuntimeResolved, "route" | "params">;
  applyLocale(locale?: string): void;
};

export function createRuntimeRenderer(options: RuntimeRendererOptions) {
  function renderPath(pathname: string): Child {
    const resolved = options.resolvePath(pathname);
    if (!resolved.route) {
      if (options.runtimeOptions?.notFound) {
        return h(options.runtimeOptions.notFound as unknown as Component, { pathname });
      }
      return options.manifest.notFound
        ? h(options.manifest.notFound, { pathname })
        : null;
    }
    if (isDeferredPlaceholderComponent(resolved.route.component)) return null;
    if (resolved.route.renderMode === "csr" && !isBrowserRuntime()) return null;
    const shared = options.runtimeOptions?.getPageProps?.() ?? {};
    const pageNode = h(resolved.route.component, {
      ...shared,
      params: resolved.params,
      layers: [],
      layerData: {}
    });
    return withLayouts(pageNode, resolved.route.layoutLayers, {
      ...shared,
      params: resolved.params,
      pathname,
      layers: [],
      layerData: {}
    }, []);
  }

  function renderResolved(resolved: PagesRuntimeResolved): Child {
    if (!resolved.route) return resolved.node;
    options.applyLocale(resolved.i18n?.locale);
    const shared = options.runtimeOptions?.getPageProps?.() ?? {};
    const props = {
      ...shared,
      pathname: resolved.pathname,
      params: resolved.params,
      data: resolved.data,
      error: resolved.error,
      layers: resolved.layers,
      layerData: resolved.layerData
    };
    const errorComponent = resolved.route.error ?? options.manifest.error;
    const node = resolved.error && errorComponent
      ? h(errorComponent, props)
      : h(resolved.route.component, props);
    return withLayouts(
      node,
      resolved.route.layoutLayers,
      props,
      resolved.layers
    );
  }

  function renderPending(pending: Omit<PagesRuntimePending, "node">): Child {
    if (!pending.route.pending) return null;
    const shared = options.runtimeOptions?.getPageProps?.() ?? {};
    const props = {
      ...shared,
      pathname: pending.pathname,
      params: pending.params,
      layers: pending.layers,
      layerData: pending.layerData
    };
    return withLayouts(
      h(pending.route.pending, props),
      pending.route.layoutLayers,
      props,
      pending.layers
    );
  }

  return { renderPath, renderResolved, renderPending };
}
