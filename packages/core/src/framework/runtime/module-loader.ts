import {
  hasCsrIncompatibleStaticOptions,
  hasDynamicHead,
  normalizeModuleRecord,
  flattenMiddlewares
} from "./modules.js";
import {
  assertCompatibleStaticOptions,
  isDeferredPlaceholderComponent,
  isPageModuleLoader,
  resolveCachePolicy,
  resolveRenderMode
} from "../manifest.js";
import type {
  AnyRecord,
  PageMiddleware,
  PageModuleRecord,
  PageModules,
  PageRouteDefinition,
  PagesManifest
} from "../types.js";
import type { RuntimeRouteEntry } from "./routes.js";

type ModuleLoaderOptions = {
  modules: PageModules;
  runtimeModules: PageModules;
  manifest: PagesManifest;
  entries: Map<string, RuntimeRouteEntry>;
  baseMiddleware: PageMiddleware[];
  moduleCache: Map<string, PageModuleRecord>;
};

function moduleRecordFromLayer(
  layer: PageRouteDefinition["layoutLayers"][number]
): PageModuleRecord {
  return {
    default: layer.component,
    load: layer.load,
    head: layer.head,
    middleware: layer.middleware,
    render: layer.render,
    layout: layer.layout,
    prerender: layer.prerender,
    static: layer.static,
    revalidate: layer.revalidate,
    vary: layer.vary,
    cacheTags: layer.cacheTags
  };
}

function moduleRecordFromRoute(route: PageRouteDefinition): PageModuleRecord {
  return {
    default: route.component,
    pending: route.pending,
    error: route.error,
    action: route.action,
    load: route.load,
    head: route.head,
    middleware: route.middleware,
    cacheTags: route.cacheTags,
    generateStaticParams: route.generateStaticParams
  };
}

export function createRuntimeModuleLoader(options: ModuleLoaderOptions) {
  const specialModules = new Map<"404" | "_error", PageModuleRecord>();
  const pendingModules = new Map<string, Promise<PageModuleRecord | null>>();
  const pendingRoutes = new WeakMap<PageRouteDefinition, Promise<void>>();

  async function loadModuleRecord(file: string): Promise<PageModuleRecord | null> {
    const cached = options.moduleCache.get(file);
    if (cached) return cached;
    const pending = pendingModules.get(file);
    if (pending) return pending;
    const source = options.runtimeModules[file];
    if (!source) return null;
    const load = Promise.resolve()
      .then(async () => {
        const normalized = isPageModuleLoader(source)
          ? normalizeModuleRecord(await source())
          : normalizeModuleRecord(source);
        assertCompatibleStaticOptions(file, normalized);
        options.moduleCache.set(file, normalized);
        return normalized;
      })
      .finally(() => {
        pendingModules.delete(file);
      });
    pendingModules.set(file, load);
    return load;
  }

  async function loadSpecialModule(
    fileStem: "404" | "_error"
  ): Promise<PageModuleRecord | undefined> {
    const cached = specialModules.get(fileStem);
    if (cached) return cached;
    for (const file of Object.keys(options.modules)) {
      const normalizedFile = file.replace(/\\/g, "/");
      const name = normalizedFile
        .slice(normalizedFile.lastIndexOf("/") + 1)
        .replace(/\.[cm]?[jt]sx?$/, "");
      if (name !== fileStem) continue;
      const loaded = await loadModuleRecord(file);
      if (!loaded) return undefined;
      specialModules.set(fileStem, loaded);
      return loaded;
    }
    return undefined;
  }

  async function loadRouteModules(route: PageRouteDefinition): Promise<void> {
    const routeDeferred = isDeferredPlaceholderComponent(route.component);
    const hasDeferredLayout = route.layoutLayers.some((layer) => (
      isDeferredPlaceholderComponent(layer.component)
    ));
    if (!routeDeferred && !hasDeferredLayout) return;
    let routeModule: PageModuleRecord | null = null;
    if (routeDeferred) {
      routeModule = await loadModuleRecord(route.file);
      if (!routeModule) return;
      route.component = routeModule.default;
      route.pending = routeModule.pending;
      route.error = routeModule.error;
      route.action = routeModule.action;
      route.load = routeModule.load;
      route.head = routeModule.head;
      route.middleware = flattenMiddlewares(routeModule.middleware);
      route.cacheTags = routeModule.cacheTags;
      route.generateStaticParams = routeModule.generateStaticParams;
      if (routeModule.layout === false) {
        route.layoutLayers = route.layoutLayers.filter((layer) => layer.kind === "root");
      }
    }
    for (const layer of route.layoutLayers) {
      const loaded = await loadModuleRecord(layer.file);
      if (!loaded) continue;
      layer.component = loaded.default;
      layer.load = loaded.load;
      layer.head = loaded.head;
      layer.middleware = flattenMiddlewares(loaded.middleware);
      layer.render = loaded.render;
      layer.layout = loaded.layout;
      layer.prerender = loaded.prerender;
      layer.static = loaded.static;
      layer.revalidate = loaded.revalidate;
      layer.vary = loaded.vary;
      layer.cacheTags = loaded.cacheTags;
    }
    route.layouts = route.layoutLayers.map((layer) => layer.component);
    const moduleChain = [
      ...route.layoutLayers.map(moduleRecordFromLayer),
      routeModule ?? moduleRecordFromRoute(route)
    ];
    route.renderMode = resolveRenderMode(moduleChain);
    route.cacheTagResolvers = moduleChain
      .map((module) => module.cacheTags)
      .filter((tags): tags is NonNullable<typeof tags> => tags !== undefined);
    route.cache = route.renderMode === "csr"
      ? { static: false, revalidate: null, vary: [], tags: [] }
      : resolveCachePolicy(moduleChain);
    if (route.renderMode === "csr" && hasCsrIncompatibleStaticOptions(moduleChain)) {
      const diagnostic = `Route "${route.path}" uses render: "csr"; prerender/static, revalidate, ` +
        "vary, and generateStaticParams settings are ignored.";
      if (!options.manifest.diagnostics.includes(diagnostic)) {
        options.manifest.diagnostics.push(diagnostic);
      }
    }
    if (route.renderMode === "csr" && hasDynamicHead(moduleChain)) {
      const diagnostic = `Route "${route.path}" uses render: "csr" with a dynamic head() ` +
        "function; it runs in the browser after route resolution, not in the initial HTML.";
      if (!options.manifest.diagnostics.includes(diagnostic)) {
        options.manifest.diagnostics.push(diagnostic);
      }
    }
    options.entries.set(route.path, {
      route,
      middlewareChain: [
        ...options.baseMiddleware,
        ...route.layoutLayers.flatMap((layer) => layer.middleware),
        ...route.middleware
      ],
      layoutHeadLayers: route.layoutLayers.filter((layer) => Boolean(layer.head)),
      pageHead: route.head
    });
  }

  async function ensureRouteLoaded(route: PageRouteDefinition): Promise<void> {
    const routeDeferred = isDeferredPlaceholderComponent(route.component);
    const hasDeferredLayout = route.layoutLayers.some((layer) => (
      isDeferredPlaceholderComponent(layer.component)
    ));
    if (!routeDeferred && !hasDeferredLayout) return;
    const pending = pendingRoutes.get(route);
    if (pending) return pending;
    const load = loadRouteModules(route).finally(() => {
      pendingRoutes.delete(route);
    });
    pendingRoutes.set(route, load);
    return load;
  }
  return { ensureRouteLoaded, loadSpecialModule };
}
