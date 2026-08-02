import type { Child, Component } from "../jsx.js";
import { h } from "../jsx.js";
import { createTavo } from "./mvc.js";
import { RouterProvider } from "../router/index.js";
import { renderDocument, renderDocumentStream } from "../server.js";
import { escapeHtml, normalizeRedirectTarget, withDefaultSecurityHeaders } from "../security.js";
import { hasPersonalRequestHeaders, readRequestHeader } from "../ssr/request.js";
import { runWithStoreSnapshotScope, type StoreSnapshotState } from "../store/index.js";
import {
  createPagesRuntime,
  createPagesRuntimeAsync,
} from "./runtime.js";
import { productionAssetHead } from "./runtime/production-assets.js";
import type {
  PageModules,
  PagesRuntime,
  PagesAppProps,
  RenderPagesDocumentAsyncOptions,
  RenderPagesDocumentOptions,
  RenderPagesResponse,
  RenderPagesStreamResponse,
} from "./types.js";

/** Wraps resolved route output in the same router shell used by the client auto-pages app. */
function createResolvedAppNode(
  runtime: PagesRuntime,
  pathname: string,
  resolved: Awaited<ReturnType<PagesRuntime["resolvePathAsync"]>>,
  options?: RenderPagesDocumentAsyncOptions,
): Child {
  return h(RouterProvider as unknown as Component, {
    router: runtime.router,
    pathname: resolved.pathname,
    busy: false,
    contentId: "tavo-route-content",
    children: resolved.node,
  });
}

/** Restores per-request i18n state before synchronous document rendering. */
function applyResolvedI18n(runtime: PagesRuntime, resolved: Awaited<ReturnType<PagesRuntime["resolvePathAsync"]>>): void {
  if (!runtime.i18n || !resolved.i18n) {
    return;
  }
  runtime.i18n.setLocale(resolved.i18n.locale as Parameters<typeof runtime.i18n.setLocale>[0], { persist: false });
}

/** Builds document language attributes from the resolved request locale. */
function getResolvedI18nDocumentOptions(
  runtime: PagesRuntime,
  resolved: Awaited<ReturnType<PagesRuntime["resolvePathAsync"]>>,
): {
  lang?: string;
  htmlAttributes?: Record<string, string | number | boolean>;
} {
  if (!runtime.i18n) {
    return {};
  }
  const locale = resolved.i18n?.locale ?? runtime.i18n.locale;
  const dir = resolved.i18n?.dir ?? runtime.i18n.dir;
  return {
    lang: locale,
    htmlAttributes: dir ? { dir } : {},
  };
}

function cacheControlHeaders(resolved: Awaited<ReturnType<PagesRuntime["resolvePathAsync"]>>, request: unknown): Record<string, string> {
  if (!resolved.cache.static || resolved.status !== 200 || resolved.error != null || hasPersonalRequestHeaders(request)) {
    return {};
  }
  const vary = Array.from(
    new Set([...(resolved.i18n ? ["accept-language"] : []), ...resolved.cache.vary.map((header) => header.toLowerCase())]),
  ).map((header) =>
    header
      .split("-")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("-"),
  );
  return {
    "Cache-Control":
      resolved.cache.revalidate === null
        ? "public, max-age=31536000, immutable"
        : `public, max-age=0, s-maxage=${resolved.cache.revalidate}`,
    ...(vary.length > 0 ? { Vary: vary.join(", ") } : {}),
  };
}

function createAutoPagesInitialState(
  resolved: Awaited<ReturnType<PagesRuntime["resolvePathAsync"]>>,
  existing?: unknown,
  storeState?: StoreSnapshotState,
  pluginState?: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const base = typeof existing === "object" && existing !== null ? (existing as Record<string, unknown>) : {};

  if (resolved.renderMode === "csr") {
    const state = {
      ...base,
      ...(pluginState && Object.keys(pluginState).length > 0 ? { pluginState } : {}),
    };
    return Object.keys(state).length > 0 ? state : undefined;
  }

  const clientError = resolved.error == null ? null : "Internal Server Error";
  const clientLayers = resolved.layers.map((layer) => ({
    ...layer,
    error: layer.error == null ? null : "Internal Server Error",
  }));

  return {
    ...base,
    ...(storeState ? { storeState } : {}),
    ...(pluginState && Object.keys(pluginState).length > 0 ? { pluginState } : {}),
    autoPagesResolved: {
      pathname: resolved.pathname,
      params: resolved.params,
      status: resolved.status,
      data: resolved.data,
      error: clientError,
      layers: clientLayers,
      layerData: resolved.layerData,
      head: resolved.head,
      cache: resolved.cache,
      renderMode: resolved.renderMode,
      redirect: resolved.redirect,
      routePath: resolved.route?.path ?? null,
    },
  };
}

/** Client pages app that wires runtime routes into the router provider. */
export const PagesApp = createTavo<PagesAppProps, { runtime: PagesRuntime }>({
  model: (props) => {
    const { modules, ...runtimeOptions } = props;
    return { runtime: createPagesRuntime(modules, runtimeOptions) };
  },
  view: ({ props, state }) => {
    const runtime = state.runtime;
    const pathname = typeof window === "undefined" ? "/" : window.location.pathname || "/";
    const notFoundView =
      props.notFound === undefined
        ? runtime.manifest.notFound
          ? h(runtime.manifest.notFound, { pathname })
          : null
        : h(props.notFound as unknown as Component, { pathname });

    return h(RouterProvider as unknown as Component, {
      router: runtime.router,
      notFound: notFoundView,
    });
  },
});

/** Resolves route data/head and renders a full HTML document asynchronously. */
export async function renderPagesDocumentAsync(
  modules: PageModules,
  pathname: string,
  options?: RenderPagesDocumentAsyncOptions,
): Promise<string> {
  return (await renderPagesResponseAsync(modules, pathname, options)).html;
}

/** Resolves route data/head and returns HTML with HTTP response metadata. */
export async function renderPagesResponseAsync(
  modules: PageModules,
  pathname: string,
  options?: RenderPagesDocumentAsyncOptions,
): Promise<RenderPagesResponse> {
  const runtime = await createPagesRuntimeAsync(modules, options);
  return renderPagesResponseFromRuntimeAsync(runtime, pathname, options);
}

function renderResolvedPagesResponse(
  runtime: PagesRuntime,
  pathname: string,
  resolved: Awaited<ReturnType<PagesRuntime["resolvePathAsync"]>>,
  storeState: StoreSnapshotState | undefined,
  options?: RenderPagesDocumentAsyncOptions,
): RenderPagesResponse {
  const pluginHead = runtime.pluginHead;
  const assetHead = productionAssetHead(resolved, options);
  const i18nDocument = getResolvedI18nDocumentOptions(runtime, resolved);
  applyResolvedI18n(runtime, resolved);

  if (resolved.redirect) {
    const redirect = normalizeRedirectTarget(resolved.redirect, {
      allowExternal: options?.allowExternalRedirects,
    });
    const fallbackNode = h("main", null, `Redirect to ${redirect}`);
    const redirectHead =
      `${options?.document?.unsafeHeadHtml ?? ""}${assetHead}${pluginHead}`
      + `<meta http-equiv="refresh" content="0;url=${escapeHtml(redirect)}">`;
    const html = renderDocument(fallbackNode, {
      ...(options?.document ?? {}),
      lang: i18nDocument.lang ?? options?.document?.lang,
      title: options?.document?.title ?? "Redirect",
      unsafeHeadHtml: redirectHead,
      htmlAttributes: {
        ...(i18nDocument.htmlAttributes ?? {}),
        ...(options?.document?.htmlAttributes ?? {}),
      },
    });
    return {
      html,
      status: resolved.status,
      headers: withDefaultSecurityHeaders({
        "Content-Type": "text/html; charset=utf-8",
        Location: redirect,
      }),
      redirect,
      resolved,
    };
  }

  const documentOptions = {
    ...(options?.document ?? {}),
    lang: i18nDocument.lang ?? options?.document?.lang,
    title: resolved.head.title ?? options?.document?.title,
    unsafeHeadHtml: `${options?.document?.unsafeHeadHtml ?? ""}${assetHead}${pluginHead}${resolved.head.unsafeHeadHtml ?? ""}`,
    htmlAttributes: {
      ...(i18nDocument.htmlAttributes ?? {}),
      ...(options?.document?.htmlAttributes ?? {}),
      ...(resolved.head.htmlAttributes ?? {}),
      "data-tavo-title-fallback": options?.document?.title ?? "",
    },
    bodyAttributes: {
      ...(options?.document?.bodyAttributes ?? {}),
      ...(resolved.head.bodyAttributes ?? {}),
    },
    appAttributes: {
      ...(options?.document?.appAttributes ?? {}),
      "data-tavo-render-mode": resolved.renderMode,
    },
  };

  const documentNode = resolved.renderMode === "csr" ? resolved.node : createResolvedAppNode(runtime, pathname, resolved, options);

  const html = renderDocument(documentNode, {
    ...documentOptions,
    beforeRender() {
      applyResolvedI18n(runtime, resolved);
    },
    initialState: createAutoPagesInitialState(
      resolved,
      options?.document?.initialState,
      storeState,
      runtime.pluginRuntime.serializeHydrationState(),
    ),
  });

  return {
    html,
    status: resolved.status,
    headers: withDefaultSecurityHeaders({
      "Content-Type": "text/html; charset=utf-8",
      ...cacheControlHeaders(resolved, options?.request),
    }),
    resolved,
  };
}

/** Resolves route data/head with a prebuilt runtime and returns HTML with HTTP response metadata. */
export async function renderPagesResponseFromRuntimeAsync(
  runtime: PagesRuntime,
  pathname: string,
  options?: RenderPagesDocumentAsyncOptions,
): Promise<RenderPagesResponse> {
  const { value } = await runWithStoreSnapshotScope(async (readSnapshot) => {
    const resolved = await runtime.resolvePathAsync(pathname, options?.request, options?.fromPath);
    return renderResolvedPagesResponse(runtime, pathname, resolved, readSnapshot(), options);
  });
  return value;
}

function renderResolvedPagesStreamResponse(
  runtime: PagesRuntime,
  pathname: string,
  resolved: Awaited<ReturnType<PagesRuntime["resolvePathAsync"]>>,
  storeState: StoreSnapshotState | undefined,
  options?: RenderPagesDocumentAsyncOptions,
): RenderPagesStreamResponse {
  const pluginHead = runtime.pluginHead;
  const assetHead = productionAssetHead(resolved, options);
  const i18nDocument = getResolvedI18nDocumentOptions(runtime, resolved);
  applyResolvedI18n(runtime, resolved);

  if (resolved.redirect) {
    const redirect = normalizeRedirectTarget(resolved.redirect, {
      allowExternal: options?.allowExternalRedirects,
    });
    const fallbackNode = h("main", null, `Redirect to ${redirect}`);
    const redirectHead =
      `${options?.document?.unsafeHeadHtml ?? ""}${assetHead}${pluginHead}`
      + `<meta http-equiv="refresh" content="0;url=${escapeHtml(redirect)}">`;
    const html = renderDocument(fallbackNode, {
      ...(options?.document ?? {}),
      lang: i18nDocument.lang ?? options?.document?.lang,
      title: options?.document?.title ?? "Redirect",
      unsafeHeadHtml: redirectHead,
      htmlAttributes: {
        ...(i18nDocument.htmlAttributes ?? {}),
        ...(options?.document?.htmlAttributes ?? {}),
      },
    });
    return {
      stream: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(html));
          controller.close();
        },
      }),
      status: resolved.status,
      headers: withDefaultSecurityHeaders({
        "Content-Type": "text/html; charset=utf-8",
        Location: redirect,
      }),
      redirect,
      resolved,
    };
  }

  const documentOptions = {
    ...(options?.document ?? {}),
    lang: i18nDocument.lang ?? options?.document?.lang,
    title: resolved.head.title ?? options?.document?.title,
    unsafeHeadHtml: `${options?.document?.unsafeHeadHtml ?? ""}${assetHead}${pluginHead}${resolved.head.unsafeHeadHtml ?? ""}`,
    htmlAttributes: {
      ...(i18nDocument.htmlAttributes ?? {}),
      ...(options?.document?.htmlAttributes ?? {}),
      ...(resolved.head.htmlAttributes ?? {}),
      "data-tavo-title-fallback": options?.document?.title ?? "",
    },
    bodyAttributes: {
      ...(options?.document?.bodyAttributes ?? {}),
      ...(resolved.head.bodyAttributes ?? {}),
    },
    appAttributes: {
      ...(options?.document?.appAttributes ?? {}),
      "data-tavo-render-mode": resolved.renderMode,
    },
    initialState: createAutoPagesInitialState(
      resolved,
      options?.document?.initialState,
      storeState,
      runtime.pluginRuntime.serializeHydrationState(),
    ),
    beforeRender() {
      applyResolvedI18n(runtime, resolved);
    },
  };

  const node = resolved.renderMode === "csr" ? resolved.node : createResolvedAppNode(runtime, pathname, resolved, options);

  return {
    stream: renderDocumentStream(node, documentOptions),
    status: resolved.status,
    headers: withDefaultSecurityHeaders({
      "Content-Type": "text/html; charset=utf-8",
      ...cacheControlHeaders(resolved, options?.request),
    }),
    resolved,
  };
}

/** Resolves route data/head with a prebuilt runtime and returns a streamed HTML response. */
export async function renderPagesStreamResponseFromRuntimeAsync(
  runtime: PagesRuntime,
  pathname: string,
  options?: RenderPagesDocumentAsyncOptions,
): Promise<RenderPagesStreamResponse> {
  const { value } = await runWithStoreSnapshotScope(async (readSnapshot) => {
    const resolved = await runtime.resolvePathAsync(pathname, options?.request, options?.fromPath);
    return renderResolvedPagesStreamResponse(runtime, pathname, resolved, readSnapshot(), options);
  });
  return value;
}

/** Resolves route data/head and returns a streamed HTML response. */
export async function renderPagesStreamResponseAsync(
  modules: PageModules,
  pathname: string,
  options?: RenderPagesDocumentAsyncOptions,
): Promise<RenderPagesStreamResponse> {
  const runtime = await createPagesRuntimeAsync(modules, options);
  return renderPagesStreamResponseFromRuntimeAsync(runtime, pathname, options);
}

/** Renders a route synchronously to a full HTML document. */
export function renderPagesDocument(modules: PageModules, pathname: string, options?: RenderPagesDocumentOptions): string {
  const runtime = createPagesRuntime(modules, options);
  const node = runtime.renderPath(pathname);
  return renderDocument(node, options?.document);
}
