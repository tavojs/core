import { loadTavoConfig } from "../config/load.js";
import {
  createPagesRuntimeAsync,
  renderPagesResponseAsync,
  renderPagesStreamResponseAsync,
} from "../framework/index.js";
import { handlePluginRequest } from "../plugins/request.js";
import {
  responseHeadersFromFetch,
  responseHeadersToNode,
  withDefaultFetchSecurityHeaders,
  type ResponseHeaders,
} from "./headers.js";
import { withDefaultSecurityHeaders } from "../security.js";
import {
  imageOptimizerErrorToResponse,
  imageOptimizerResultToResponse,
  logImageOptimizerError,
  optimizeImageFromUrl,
} from "./image.js";
import {
  createFetchRequestFromNodeRequest,
  hasPersonalRequestHeaders,
  readRequestHeader,
  type NodeRequestLike,
} from "./request.js";
import {
  loadViteFromProjectRoot,
  runtimeImport,
} from "./runtime.js";
import type {
  NodeHandlerOptions,
  RunningDevServer,
  ViteAutoPagesDevServerOptions,
  ViteDevServerLike,
} from "./types.js";
import {
  createDevStaticCacheKey,
  createMonitorPayload,
  getProcessEnvValue,
  isPageRenderMethod,
  type DevMonitorState,
} from "./vite-dev/monitor.js";
import {
  loadPageModulesForVite,
  mergeDocumentHeadWithDevAssets,
  mergeHtmlShellDocument,
  resolveClientModuleScripts,
  resolveCssEntries,
  resolveHtmlShellDocument,
} from "./vite-dev/assets.js";
import { resolveInlineViteStyleTags } from "./vite-dev/style.js";
import { withViteDevHtmlHeaders } from "./vite-dev/html-headers.js";
export { withViteDevHtmlHeaders } from "./vite-dev/html-headers.js";
import {
  isLikelyAssetRequest,
  shouldInvalidateDevCache,
  tryServeViteSourceRequest,
} from "./vite-dev/requests.js";
export function createViteDevRequestUrl(req: NodeRequestLike): URL {
  const host = readDevRequestHost(req) || "localhost";
  return new URL(req.url || "/", `http://${host}`);
}

function readNodeRequestAuthorization(req: NodeRequestLike): string | undefined {
  return readRequestHeader(req, "authorization");
}

export function isViteDevMonitorAuthorized(
  req: NodeRequestLike,
  options: { host: string; token?: string }
): boolean {
  const token = options.token ?? "";
  if (!token) {
    return false;
  }
  const expected = `Bearer ${token}`;
  return readNodeRequestAuthorization(req) === expected;
}

function readDevRequestHost(req: NodeRequestLike): string | undefined {
  const headers = req.headers;
  if (!headers) {
    return undefined;
  }
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== "host") {
      continue;
    }
    return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

type DevCachedResponse = {
  html: string;
  status: number;
  headers: ResponseHeaders;
  redirect?: string;
  expiresAt: number | null;
};

async function readStreamToString(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value) {
        html += decoder.decode(value, { stream: true });
      }
    }
  } finally {
    reader.releaseLock();
  }
  html += decoder.decode();
  return html;
}

/** Starts a Vite middleware-mode server that SSR-renders file-based pages. */
export async function startViteAutoPagesDevServer(
  options?: ViteAutoPagesDevServerOptions,
): Promise<RunningDevServer> {
  const nodeHttp = await runtimeImport("node:http");
  const nodePath = await runtimeImport("node:path");
  const processRef = (
    globalThis as unknown as { process?: { cwd?: () => string } }
  ).process;
  const cwd = typeof processRef?.cwd === "function" ? processRef.cwd() : ".";

  const rootDir = options?.root ? nodePath.resolve(options.root) : cwd;
  const tavoConfig = await loadTavoConfig(rootDir, {
    mode: options?.mode ?? "development",
  });
  const vitePackage = await loadViteFromProjectRoot(rootDir);
  const port = options?.port ?? 4174;
  const host = options?.host ?? getProcessEnvValue("HOST") ?? "127.0.0.1";
  const monitorToken = getProcessEnvValue("TAVO_MONITOR_TOKEN") ?? "";

  const vite = (await vitePackage.createServer({
    root: rootDir,
    server: { middlewareMode: true },
    appType: "custom",
  })) as ViteDevServerLike;

  const configuredSsrOptions: Omit<NodeHandlerOptions, "modules"> & {
    modules?: NodeHandlerOptions["modules"];
  } = {
    ...(tavoConfig.ssr ?? {}),
    plugins: tavoConfig.plugins,
  };
  const pagesDir = options?.pagesDir ?? tavoConfig.pagesDir ?? "src/pages";
  const cssHrefs = await resolveCssEntries(
    rootDir,
    options?.cssEntries ?? tavoConfig.cssEntries,
  );
  const scriptSrcs = await resolveClientModuleScripts(rootDir);
  const shellDocument = await resolveHtmlShellDocument(rootDir);
  const responseCache = new Map<string, DevCachedResponse>();
  const monitorState: DevMonitorState = {
    startedAt: Date.now(),
    requestCount: 0,
    inflight: 0,
    errorCount: 0,
    cacheHits: 0,
    cacheMisses: 0,
    lastRequestAt: null,
    lastRenderDurationMs: null,
    totalRenderDurationMs: 0,
    maxRenderDurationMs: 0,
    routeHits: {},
  };
  const serverUrl = `http://${host}:${port}`;

  const viteWithWatcher = vite as ViteDevServerLike & {
    watcher?: {
      on(event: string, listener: (...args: unknown[]) => void): void;
    };
  };
  viteWithWatcher.watcher?.on("all", (event: unknown, file: unknown) => {
    if (
      shouldInvalidateDevCache(
        String(event ?? ""),
        typeof file === "string" ? file : undefined,
        rootDir,
      )
    ) {
      responseCache.clear();
    }
  });

  const server = nodeHttp.createServer((req: any, res: any) => {
    vite.middlewares(req, res, async (middlewareError?: unknown) => {
      if (middlewareError) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(String(middlewareError));
        return;
      }

      const url = createViteDevRequestUrl(req as NodeRequestLike);
      if (url.pathname === "/_tavo/monitor") {
        if (!isViteDevMonitorAuthorized(req as NodeRequestLike, { host, token: monitorToken })) {
          res.writeHead(404, withDefaultSecurityHeaders({
            "Content-Type": "text/plain; charset=utf-8",
          }));
          res.end("Not found");
          return;
        }
        const payload = await createMonitorPayload(monitorState, {
          url: serverUrl,
          mode: "vite-dev",
          cacheEntries: responseCache.size,
          port,
          host,
        });
        res.writeHead(200, withDefaultSecurityHeaders({
          "Content-Type": "application/json; charset=utf-8",
        }));
        res.end(JSON.stringify(payload, null, 2));
        return;
      }
      if (isLikelyAssetRequest(url.pathname)) {
        const transformedSource = await tryServeViteSourceRequest(
          vite,
          `${url.pathname}${url.search}`,
        );
        if (transformedSource) {
          res.writeHead(200, { "Content-Type": transformedSource.contentType });
          res.end(transformedSource.code);
          return;
        }
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        res.end("Not found");
        return;
      }
      try {
        monitorState.requestCount += 1;
        monitorState.inflight += 1;
        monitorState.lastRequestAt = Date.now();
        monitorState.routeHits[url.pathname] =
          (monitorState.routeHits[url.pathname] ?? 0) + 1;
        const requestStartedAt = Date.now();
        const optimizedImage = await optimizeImageFromUrl(
          url,
          options?.images ?? tavoConfig.ssr?.images,
        );
        if (optimizedImage) {
          const response = imageOptimizerResultToResponse(optimizedImage);
          res.writeHead(
            response.status,
            Object.fromEntries(response.headers.entries()),
          );
          res.end(Buffer.from(await response.arrayBuffer()));
          monitorState.inflight -= 1;
          return;
        }

        if (!isPageRenderMethod(req.method)) {
          const loadedOptions = configuredSsrOptions;
          const modules =
            loadedOptions.modules ??
            (await loadPageModulesForVite(vite, rootDir, pagesDir));
          const runtime = await createPagesRuntimeAsync(modules, loadedOptions);
          const fetchRequest = await createFetchRequestFromNodeRequest(
            req as NodeRequestLike,
            url,
            {
              maxBodyBytes: loadedOptions.maxRequestBodyBytes,
            },
          );
          const pluginResponse = await handlePluginRequest(
            runtime.pluginRuntime,
            fetchRequest,
            {
              rawRequest: req,
              trustedHosts: loadedOptions.trustedHosts,
            },
          );
          const response =
            pluginResponse ??
            (await runtime.handleAction(url.pathname, fetchRequest));
          if (response) {
            const securedResponse = withDefaultFetchSecurityHeaders(response);
            res.writeHead(
              securedResponse.status,
              responseHeadersToNode(responseHeadersFromFetch(securedResponse.headers)),
            );
            res.end(Buffer.from(await securedResponse.arrayBuffer()));
          } else {
            res.writeHead(405, withDefaultSecurityHeaders({
              Allow: "GET, HEAD",
              "Content-Type": "text/plain; charset=utf-8",
            }));
            res.end("Method Not Allowed");
          }
          monitorState.inflight -= 1;
          return;
        }

        const now = Date.now();
        const baseCacheKey = createDevStaticCacheKey(
          url.pathname,
          url.search,
          req,
        );
        let cacheKey = baseCacheKey;
        const canUseStaticCache = !hasPersonalRequestHeaders(req);
        const cached = canUseStaticCache
          ? responseCache.get(cacheKey)
          : undefined;
        if (cached && (cached.expiresAt === null || cached.expiresAt > now)) {
          monitorState.cacheHits += 1;
          monitorState.lastRenderDurationMs = 0;
          res.writeHead(cached.status, responseHeadersToNode(cached.headers));
          res.end(cached.html);
          monitorState.inflight -= 1;
          return;
        }
        monitorState.cacheMisses += 1;

        const renderPromise = (async (): Promise<DevCachedResponse> => {
          const loadedOptions = configuredSsrOptions;
          const modules =
            loadedOptions.modules ??
            (await loadPageModulesForVite(vite, rootDir, pagesDir));
          const inlineStyles = await resolveInlineViteStyleTags(
            vite,
            rootDir,
            pagesDir,
          );
          const renderOptions = {
            ...loadedOptions,
            request: req,
            document: mergeDocumentHeadWithDevAssets(
              mergeHtmlShellDocument(shellDocument, loadedOptions.document),
              cssHrefs,
              inlineStyles,
              scriptSrcs,
            ),
          };
          const response = loadedOptions.stream
            ? await renderPagesStreamResponseAsync(
                modules,
                url.pathname,
                renderOptions,
              )
            : await renderPagesResponseAsync(
                modules,
                url.pathname,
                renderOptions,
              );
          const html =
            "stream" in response
              ? await readStreamToString(response.stream)
              : response.html;

          const cachePolicy = response.resolved.cache;
          cacheKey = createDevStaticCacheKey(
            url.pathname,
            url.search,
            req,
            cachePolicy.vary,
          );
          const entry: DevCachedResponse = {
            html,
            status: response.status,
            headers: withViteDevHtmlHeaders(response.headers),
            redirect: response.redirect,
            expiresAt:
              cachePolicy.static && !response.redirect && response.status < 500
                ? cachePolicy.revalidate === null
                  ? null
                  : Date.now() + cachePolicy.revalidate * 1000
                : now,
          };

          if (
            canUseStaticCache &&
            cachePolicy.static &&
            !response.redirect &&
            response.status < 500
          ) {
            responseCache.set(cacheKey, entry);
          } else {
            responseCache.delete(cacheKey);
          }

          return entry;
        })();

        try {
          const rendered = await renderPromise;
          const durationMs = Date.now() - requestStartedAt;
          monitorState.lastRenderDurationMs = durationMs;
          monitorState.totalRenderDurationMs += durationMs;
          monitorState.maxRenderDurationMs = Math.max(
            monitorState.maxRenderDurationMs,
            durationMs,
          );
          res.writeHead(
            rendered.status,
            responseHeadersToNode(rendered.headers),
          );
          res.end(rendered.html);
        } finally {
          monitorState.inflight -= 1;
        }
      } catch (error) {
        monitorState.inflight = Math.max(0, monitorState.inflight - 1);
        monitorState.errorCount += 1;
        if (url.pathname === "/_tavo/image") {
          logImageOptimizerError(error, url);
          const response = imageOptimizerErrorToResponse(error);
          res.writeHead(
            response.status,
            responseHeadersToNode(responseHeadersFromFetch(response.headers)),
          );
          res.end(Buffer.from(await response.arrayBuffer()));
          return;
        }
        vite.ssrFixStacktrace(error);
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(String(error));
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  return {
    url: serverUrl,
    async close() {
      await new Promise<void>((resolve, reject) => {
        server.close((error: Error | null | undefined) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      await vite.close();
    },
  };
}
