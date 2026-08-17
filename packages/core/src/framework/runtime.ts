import { h } from "../jsx.js";
import {
  createRouter,
  type RouteConfig,
  type RouterParams,
} from "../router/index.js";
import { createStore } from "../store/index.js";
import type { AnyI18nService } from "../i18n/index.js";
import {
  createPluginRuntime,
  createPluginRuntimeAsync,
  renderPluginHead,
} from "../plugins/runtime.js";
import { createPagesManifestDetailed } from "./manifest.js";
import type {
  PageModuleRecord,
  PageModules,
  PageRouteDefinition,
  PageRuntimeOptions,
  PagesRuntime,
  RoutesCatalogState,
} from "./types.js";
import {
  getRegisteredDefaultI18nService,
  normalizeResolvedCacheLimit,
} from "./runtime/setup.js";
import { createRuntimeModuleLoader } from "./runtime/module-loader.js";
import { createRuntimeActionHandler } from "./runtime/action-handler.js";
import { createRuntimeRenderer } from "./runtime/runtime-renderer.js";
import {
  createRuntimeRouteIndex,
  resolveIndexedRoute,
} from "./runtime/routes.js";
import { createRuntimeResolutionCache } from "./runtime/resolution-cache.js";
import { createRuntimeResolutionStateMachine } from "./runtime/resolution-state-machine.js";

/** Creates runtime route resolution/rendering services for a pages module map. */
export function createPagesRuntime(
  modules: PageModules,
  options?: PageRuntimeOptions,
): PagesRuntime {
  const appRoutes = createPagesManifestDetailed(modules).routes.map(
    (route) => route.path,
  );
  const pluginRuntime =
    options?.pluginRuntime ??
    createPluginRuntime(options?.plugins, { appRoutes, routing: options?.routing });
  const runtimeModules = {
    ...pluginRuntime.routeModules,
    ...modules,
  } satisfies PageModules;
  const runtimeI18n = options?.i18n ?? getRegisteredDefaultI18nService();
  const baseMiddleware = [
    ...pluginRuntime.pageMiddlewareBeforeApp,
    ...(options?.middleware ?? []),
    ...pluginRuntime.pageMiddlewareAfterApp,
  ];
  const manifest = createPagesManifestDetailed(runtimeModules);
  const routeIndex = createRuntimeRouteIndex(manifest.routes, baseMiddleware);
  const runtimeRouteEntries = routeIndex.entries;
  const routesStore = createStore<RoutesCatalogState>({
    routes: manifest.routes,
  });
  const routeConfigs: RouteConfig[] = manifest.routes.map((route) => ({
    path: route.path,
    component: ({ params }) =>
      h(route.component, {
        ...(options?.getPageProps?.() ?? {}),
        params,
      }),
  }));
  const router = createRouter(routeConfigs, {
    routing: options?.routing,
    resolveRoutePathname: (pathname) => runtimeI18n?.resolvePath(pathname).pathname ?? pathname,
  });
  const moduleCache = new Map<string, PageModuleRecord>();
  const resolutionCache = createRuntimeResolutionCache({
    maxEntries: normalizeResolvedCacheLimit(options?.maxResolvedCacheEntries),
    instrumentation: options?.instrumentation,
  });
  const { ensureRouteLoaded, loadSpecialModule } = createRuntimeModuleLoader(
    {
      modules,
      runtimeModules,
      manifest,
      entries: runtimeRouteEntries,
      baseMiddleware,
      moduleCache,
    },
  );

  function applyI18nLocale(locale?: string): void {
    if (locale && runtimeI18n) {
      runtimeI18n.setLocale(locale, { persist: false });
    }
  }

  function detectI18nLocale(
    pathname: string,
    request?: unknown,
  ): string | undefined {
    if (!runtimeI18n) return undefined;
    return request !== undefined
      ? runtimeI18n.detectLocale({ pathname, request })
      : runtimeI18n.resolvePath(pathname).locale;
  }

  function getRoutePathname(pathname: string): string {
    return runtimeI18n ? runtimeI18n.resolvePath(pathname).pathname : pathname;
  }

  function resolvePath(pathname: string): {
    route: PageRouteDefinition | null;
    params: RouterParams;
  } {
    return resolveIndexedRoute(routeIndex, getRoutePathname(pathname));
  }

  const { renderPath, renderResolved, renderPending } = createRuntimeRenderer({
    manifest,
    runtimeOptions: options,
    resolvePath,
    applyLocale: applyI18nLocale,
  });
  const { resolvePathAsync } = createRuntimeResolutionStateMachine({
    manifest,
    runtimeOptions: options,
    runtimeI18n,
    entries: runtimeRouteEntries,
    cache: resolutionCache,
    resolvePath,
    ensureRouteLoaded,
    loadSpecialModule,
    renderResolved,
    renderPending,
    applyLocale: applyI18nLocale,
    detectLocale: detectI18nLocale,
  });
  const handleAction = createRuntimeActionHandler({
    runtimeOptions: options,
    resolvePath,
    ensureRouteLoaded,
  });

  return {
    manifest,
    routes: manifest.routes,
    routesStore,
    routeConfigs,
    router,
    diagnostics: manifest.diagnostics,
    pluginHead: renderPluginHead(pluginRuntime),
    pluginRuntime,
    i18n: runtimeI18n,
    renderPath,
    renderResolved,
    resolvePath,
    loadRouteModules: ensureRouteLoaded,
    resolvePathAsync,
    handleAction,
    invalidateCache: resolutionCache.invalidate,
    clearCache: resolutionCache.clear,
    inspect() {
      return {
        routeCount: manifest.routes.length,
        routes: manifest.routes.map((route) => ({
          path: route.path,
          renderMode: route.renderMode,
          static: route.cache.static,
          revalidate: route.cache.revalidate,
          tags: [...route.cache.tags],
        })),
        cacheEntries: resolutionCache.entryCount(),
        inflightResolutions: resolutionCache.pendingCount(),
        loadedModules: moduleCache.size,
        diagnostics: [...manifest.diagnostics],
      };
    },
  };
}

/** Async variant for SSR/build flows that use async plugin lifecycle hooks. */
export async function createPagesRuntimeAsync(
  modules: PageModules,
  options?: PageRuntimeOptions,
): Promise<PagesRuntime> {
  const appRoutes = createPagesManifestDetailed(modules).routes.map(
    (route) => route.path,
  );
  const pluginRuntime =
    options?.pluginRuntime ??
    (await createPluginRuntimeAsync(options?.plugins, { appRoutes, routing: options?.routing }));
  return createPagesRuntime(modules, { ...options, pluginRuntime });
}
