import type { Component } from "../../jsx.js";
import { h } from "../../jsx.js";
import { emitInstrumentation } from "../../instrumentation.js";
import type { AnyI18nService } from "../../i18n/index.js";
import type { RouterParams } from "../../router/index.js";
import {
  hasPersonalRequestHeaders,
  normalizePageRequest,
  type NormalizedPageRequest
} from "../../ssr/request.js";
import type {
  AnyRecord,
  PageCachePolicy,
  PageModuleRecord,
  PageResolveOptions,
  PageRouteDefinition,
  PageRuntimeOptions,
  PagesManifest,
  PagesRuntimePending,
  PagesRuntimeResolved
} from "../types.js";
import { isNotFoundSignal } from "../not-found.js";
import { createRequestCacheKey } from "./cache.js";
import { createPageContext } from "./context.js";
import { runWithI18nRequestLocale } from "./i18n-context.js";
import { resolveDynamicCachePolicy } from "./resolution-cache-policy.js";
import { loadRouteData } from "./resolution-loaders.js";
import {
  resolveRouteHead,
  resolveStaticCsrHead
} from "./resolution-head.js";
import { normalizeHead } from "./head.js";
import type { RuntimeResolutionCache } from "./resolution-cache.js";
import { isBrowserRuntime, isClientRuntime, renderCsrFallback } from "./rendering.js";
import type { RuntimeRouteEntry } from "./routes.js";
import { runMiddlewares } from "./setup.js";

type ResolvedRoute = {
  route: PageRouteDefinition | null;
  params: RouterParams;
};

type ResolutionStateMachineOptions = {
  manifest: PagesManifest;
  runtimeOptions?: PageRuntimeOptions;
  runtimeI18n?: AnyI18nService;
  entries: Map<string, RuntimeRouteEntry>;
  cache: RuntimeResolutionCache;
  resolvePath(pathname: string): ResolvedRoute;
  ensureRouteLoaded(route: PageRouteDefinition): Promise<void>;
  loadSpecialModule(file: "404" | "_error"): Promise<PageModuleRecord | undefined>;
  renderResolved(value: PagesRuntimeResolved): PagesRuntimeResolved["node"];
  renderPending(value: Omit<PagesRuntimePending, "node">): PagesRuntimePending["node"];
  applyLocale(locale?: string): void;
  detectLocale(pathname: string, request?: unknown): string | undefined;
};

type ActiveResolution = {
  pathname: string;
  fromPath?: string;
  request: NormalizedPageRequest;
  requestId: string;
  startedAt: number;
  route: PageRouteDefinition;
  params: RouterParams;
  entry?: RuntimeRouteEntry;
  cachePolicy: PageCachePolicy;
  cacheKey: string;
  canReuse: boolean;
  i18n?: PagesRuntimeResolved["i18n"];
  resolveOptions?: PageResolveOptions;
};

function emptyResult(
  state: ActiveResolution,
  overrides: Partial<PagesRuntimeResolved>
): PagesRuntimeResolved {
  return {
    pathname: state.pathname,
    params: state.params,
    route: state.route,
    status: 200,
    data: null,
    error: null,
    layers: [],
    layerData: {},
    head: {},
    cache: state.cachePolicy,
    renderMode: state.route.renderMode,
    node: null,
    i18n: state.i18n,
    ...overrides
  };
}

async function runRouteWork(
  state: ActiveResolution,
  options: ResolutionStateMachineOptions
): Promise<PagesRuntimeResolved> {
  options.applyLocale(state.i18n?.locale);
  const middlewareStartedAt = Date.now();
  const redirect = await runMiddlewares(
    state.entry?.middlewareChain ?? state.route.middleware,
    {
      to: state.pathname,
      from: state.fromPath,
      params: state.params,
      signal: state.request.request.signal,
      ...state.request
    }
  );
  emitInstrumentation(options.runtimeOptions?.instrumentation, {
    name: "route.middleware",
    phase: "end",
    requestId: state.requestId,
    route: state.route.path,
    durationMs: Date.now() - middlewareStartedAt
  });
  if (redirect) {
    return emptyResult(state, {
      status: redirect.status,
      redirect: redirect.redirect
    });
  }
  if (state.route.renderMode === "csr" && !isBrowserRuntime()) {
    const head = resolveStaticCsrHead(state.entry);
    return emptyResult(state, {
      status: head.status ?? 200,
      head,
      cache: { static: false, revalidate: null, vary: [], tags: [] },
      renderMode: "csr",
      node: renderCsrFallback(
        options.runtimeOptions?.csrFallback,
        state.pathname,
        state.params
      )
    });
  }

  const loaded = await loadRouteData({
    pathname: state.pathname,
    params: state.params,
    route: state.route,
    request: state.request,
    requestId: state.requestId,
    locale: state.i18n?.locale,
    applyLocale: options.applyLocale,
    instrumentation: options.runtimeOptions?.instrumentation,
    onPagePending: state.resolveOptions?.onPending
      ? (layers, layerData) => {
          const pendingBase = {
            pathname: state.pathname,
            params: state.params,
            route: state.route,
            layers,
            layerData
          };
          state.resolveOptions?.onPending?.({
            ...pendingBase,
            node: options.renderPending(pendingBase)
          });
        }
      : undefined
  });
  const notFoundLayer = loaded.layers.find((layer) => isNotFoundSignal(layer.error));
  if (notFoundLayer) throw notFoundLayer.error;
  const head = resolveRouteHead({
    pathname: state.pathname,
    params: state.params,
    request: state.request,
    entry: state.entry,
    layers: loaded.layers,
    data: loaded.data,
    error: loaded.error,
    locale: state.i18n?.locale,
    applyLocale: options.applyLocale
  });
  const result = emptyResult(state, {
    status: head.status ?? (loaded.error ? 500 : 200),
    data: loaded.data,
    error: loaded.error,
    layers: loaded.layers,
    layerData: loaded.layerData,
    head
  });
  if (result.error && !options.manifest.error) {
    const errorModule = await options.loadSpecialModule("_error");
    if (errorModule) options.manifest.error = errorModule.default;
  }
  options.applyLocale(state.i18n?.locale);
  result.node = options.renderResolved(result);
  options.cache.store(state.cacheKey, state.canReuse, result);
  return result;
}

export function createRuntimeResolutionStateMachine(
  options: ResolutionStateMachineOptions
) {
  let requestSequence = 0;

  async function resolveNotFound(
    pathname: string,
    requestId: string,
    startedAt: number,
    request: NormalizedPageRequest,
    i18n?: PagesRuntimeResolved["i18n"]
  ): Promise<PagesRuntimeResolved> {
    const specialModule =
      options.manifest.notFound && options.manifest.notFoundHead
        ? undefined
        : await options.loadSpecialModule("404");
    const fallback =
      (options.runtimeOptions?.notFound as Component<AnyRecord> | undefined) ??
      options.manifest.notFound ??
      specialModule?.default;
    if (!options.runtimeOptions?.notFound && specialModule) {
      options.manifest.notFound ??= specialModule.default;
      options.manifest.notFoundHead ??= specialModule.head;
    }
    const headExport = options.manifest.notFoundHead ?? specialModule?.head;
    options.applyLocale(i18n?.locale);
    const head = {
      ...normalizeHead(
        typeof headExport === "function"
          ? headExport({
              ...createPageContext(pathname, {}, request),
              data: null,
              error: null
            })
          : headExport
      ),
      status: 404
    };
    const result: PagesRuntimeResolved = {
      pathname,
      params: {},
      route: null,
      status: 404,
      data: null,
      error: null,
      layers: [],
      layerData: {},
      head,
      cache: { static: false, revalidate: null, vary: [], tags: [] },
      renderMode: "ssr",
      node: fallback ? h(fallback as Component, { pathname }) : null,
      i18n
    };
    emitInstrumentation(options.runtimeOptions?.instrumentation, {
      name: "route.resolve",
      phase: "end",
      requestId,
      durationMs: Date.now() - startedAt,
      status: 404
    });
    return result;
  }

  async function resolvePathAsync(
    pathname: string,
    request?: unknown,
    fromPath?: string,
    resolveOptions?: PageResolveOptions,
    localeScoped = false
  ): Promise<PagesRuntimeResolved> {
    const normalized = normalizePageRequest(pathname, request);
    normalized.request.signal.throwIfAborted();
    const requestLocale = options.detectLocale(pathname, normalized.request);
    if (!localeScoped && options.runtimeI18n && requestLocale) {
      return runWithI18nRequestLocale(options.runtimeI18n, requestLocale, () =>
        resolvePathAsync(pathname, request, fromPath, resolveOptions, true)
      );
    }
    const requestId = `route-${++requestSequence}`;
    const startedAt = Date.now();
    emitInstrumentation(options.runtimeOptions?.instrumentation, {
      name: "route.resolve",
      phase: "start",
      requestId
    });
    options.applyLocale(requestLocale);
    const resolved = options.resolvePath(pathname);
    const snapshotLocale = requestLocale ?? options.runtimeI18n?.locale;
    const i18n = options.runtimeI18n ? {
      locale: snapshotLocale!,
      dir: options.runtimeI18n.getLocaleInfo(snapshotLocale as never).dir ?? "ltr"
    } : undefined;
    if (!resolved.route) {
      return resolveNotFound(pathname, requestId, startedAt, normalized, i18n);
    }

    const route = resolved.route;
    await options.ensureRouteLoaded(route);
    normalized.request.signal.throwIfAborted();
    const hasDynamicCacheTags = route.cacheTagResolvers.some(
      (resolver) => typeof resolver === "function"
    );
    const cachePolicy = hasDynamicCacheTags
      ? await resolveDynamicCachePolicy(route, pathname, resolved.params, normalized)
      : route.cache;
    const canReuse = cachePolicy.static && !hasPersonalRequestHeaders(normalized.request);
    const vary = options.runtimeI18n
      ? ["accept-language", ...cachePolicy.vary]
      : cachePolicy.vary;
    const cacheKey = createRequestCacheKey(pathname, normalized.request, vary);
    const cached = canReuse ? options.cache.getFresh(cacheKey) : undefined;
    if (cached) {
      emitInstrumentation(options.runtimeOptions?.instrumentation, {
        name: "route.cache",
        phase: "hit",
        requestId,
        route: route.path,
        cacheTags: cached.cache.tags
      });
      options.applyLocale(cached.i18n?.locale);
      const result = options.cache.restore(cached, options.renderResolved);
      emitInstrumentation(options.runtimeOptions?.instrumentation, {
        name: "route.resolve",
        phase: "end",
        requestId,
        route: route.path,
        durationMs: Date.now() - startedAt,
        status: result.status
      });
      return result;
    }
    emitInstrumentation(options.runtimeOptions?.instrumentation, {
      name: "route.cache",
      phase: "miss",
      requestId,
      route: route.path,
      cacheTags: cachePolicy.tags
    });

    const canReuseInflight = canReuse && !isClientRuntime();
    const pending = canReuseInflight ? options.cache.getPending(cacheKey) : undefined;
    if (pending) return pending;
    const state: ActiveResolution = {
      pathname,
      fromPath,
      request: normalized,
      requestId,
      startedAt,
      route,
      params: resolved.params,
      entry: options.entries.get(route.path),
      cachePolicy,
      cacheKey,
      canReuse,
      i18n,
      resolveOptions
    };
    const work = runRouteWork(state, options);
    if (canReuseInflight) options.cache.setPending(cacheKey, work);
    try {
      const result = await work;
      emitInstrumentation(options.runtimeOptions?.instrumentation, {
        name: "route.resolve",
        phase: "end",
        requestId,
        route: route.path,
        durationMs: Date.now() - startedAt,
        status: result.status
      });
      return result;
    } catch (error) {
      if (isNotFoundSignal(error)) {
        return resolveNotFound(
          pathname,
          requestId,
          startedAt,
          normalized,
          i18n
        );
      }
      emitInstrumentation(options.runtimeOptions?.instrumentation, {
        name: "route.resolve",
        phase: normalized.request.signal.aborted ? "abort" : "error",
        requestId,
        route: route.path,
        durationMs: Date.now() - startedAt,
        error
      });
      throw error;
    } finally {
      if (canReuseInflight) options.cache.removePending(cacheKey);
    }
  }

  return { resolvePathAsync };
}
