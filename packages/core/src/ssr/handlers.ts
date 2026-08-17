import {
  createPagesRuntimeAsync,
  renderPagesResponseFromRuntimeAsync,
  renderPagesStreamResponseFromRuntimeAsync,
  type PagesRuntime,
} from "../framework/index.js";
import { createRequestCacheKey } from "../framework/runtime/cache.js";
import { handlePluginRequest } from "../plugins/request.js";
import { createMemoryStaticCache } from "./cache.js";
import {
  responseHeadersFromFetch,
  responseHeadersToFetch,
  responseHeadersToNode,
  withDefaultFetchSecurityHeaders
} from "./headers.js";
import {
  imageOptimizerErrorToResponse,
  imageOptimizerResultToResponse,
  logImageOptimizerError,
  optimizeImageFromUrl
} from "./image.js";
import {
  createFetchRequestFromNodeRequest,
  hasPersonalRequestHeaders,
  RequestBodyTooLargeError,
  type NodeRequestLike
} from "./request.js";
import { withDefaultSecurityHeaders } from "../security.js";
import type {
  FetchHandlerOptions,
  NodeHandlerOptions,
  SsrStaticCacheEntry
} from "./types.js";
import { normalizeCanonicalOrigin } from "./origin.js";
import { canonicalPageRedirect, canonicalizeActionRedirect } from "./canonical.js";

function cloneCachedResponse(entry: SsrStaticCacheEntry) {
  return {
    ...entry.response,
    headers: { ...entry.response.headers }
  };
}

function isPageRenderMethod(method: string | undefined): boolean {
  const normalized = (method ?? "GET").toUpperCase();
  return normalized === "GET" || normalized === "HEAD";
}

function methodNotAllowedResponse() {
  return new Response("Method Not Allowed", {
    status: 405,
    headers: withDefaultSecurityHeaders({
      Allow: "GET, HEAD",
      "Content-Type": "text/plain; charset=utf-8"
    })
  });
}

function payloadTooLargeResponse() {
  return new Response("Payload Too Large", {
    status: 413,
    headers: withDefaultSecurityHeaders({
      "Content-Type": "text/plain; charset=utf-8"
    })
  });
}

function internalServerErrorResponse() {
  return new Response("Internal Server Error", {
    status: 500,
    headers: withDefaultSecurityHeaders({
      "Content-Type": "text/plain; charset=utf-8"
    })
  });
}

async function writeMethodNotAllowedResponse(res: {
  writeHead: (status: number, headers: Record<string, string | string[]>) => void;
  end: (body?: string | Uint8Array) => void;
}): Promise<void> {
  await writeFetchResponseToNodeResponse(methodNotAllowedResponse(), res);
}

function createStaticResponseRenderer(
  options: NodeHandlerOptions | FetchHandlerOptions,
  runtimePromise = createPagesRuntimeAsync(options.modules, options)
) {
  const cache = options.staticCache ?? createMemoryStaticCache();
  const inflight = new Map<string, Promise<Awaited<ReturnType<typeof renderPagesResponseFromRuntimeAsync>>>>();
  const cacheTagsByKey = new Map<string, string[]>();

  const render = async function render(pathname: string, request?: unknown) {
    const runtime = await runtimePromise;
    const resolvedPath = runtime.resolvePath(pathname);
    const cachePolicy = resolvedPath.route?.cache;
    const canUseStaticCache = Boolean(cachePolicy?.static) && !hasPersonalRequestHeaders(request);
    const cacheKey = createRequestCacheKey(
      pathname,
      request,
      runtime.i18n
        ? ["accept-language", ...(cachePolicy?.vary ?? [])]
        : cachePolicy?.vary
    );
    const now = Date.now();

    if (canUseStaticCache) {
      let cached: SsrStaticCacheEntry | null = null;
      try {
        cached = await cache.get(cacheKey);
      } catch {
        cached = null;
      }
      if (cached && (cached.expiresAt === null || cached.expiresAt > now)) {
        return cloneCachedResponse(cached);
      }

      const pending = inflight.get(cacheKey);
      if (pending) {
        return pending;
      }
    }

    const renderPromise = renderPagesResponseFromRuntimeAsync(runtime, pathname, {
      ...options,
      request,
      document: {
        ...(options.document ?? {})
      }
    }).then(async (response) => {
      if (canUseStaticCache) {
        if (response.resolved.cache.static && !response.redirect && response.status < 500) {
          try {
            await cache.set(cacheKey, {
              response,
              tags: response.resolved.cache.tags,
              expiresAt:
                response.resolved.cache.revalidate === null
                  ? null
                  : now + response.resolved.cache.revalidate * 1000
            });
            cacheTagsByKey.set(cacheKey, response.resolved.cache.tags);
          } catch {
            // A cache adapter failure should degrade to an uncached render.
          }
        } else {
          try {
            await cache.delete(cacheKey);
            cacheTagsByKey.delete(cacheKey);
          } catch {
            // Ignore cache delete failures so response generation remains isolated.
          }
        }
      }
      inflight.delete(cacheKey);
      return response;
    }).catch((error) => {
      inflight.delete(cacheKey);
      throw error;
    });

    if (canUseStaticCache) {
      inflight.set(cacheKey, renderPromise);
    }

    return renderPromise;
  };

  return Object.assign(render, {
    async invalidateCache(tags: string | string[]): Promise<number> {
      const requested = new Set(
        (Array.isArray(tags) ? tags : [tags]).map((tag) => tag.trim()).filter(Boolean)
      );
      if (requested.size === 0) {
        return 0;
      }
      const runtime = await runtimePromise;
      let deleted = runtime.invalidateCache(Array.from(requested));
      for (const [key, entryTags] of cacheTagsByKey) {
        if (!entryTags.some((tag) => requested.has(tag))) {
          continue;
        }
        try {
          await cache.delete(key);
          deleted += 1;
        } finally {
          cacheTagsByKey.delete(key);
        }
      }
      return deleted;
    },
    async clearCache(): Promise<void> {
      const runtime = await runtimePromise;
      runtime.clearCache();
      if (cache.clear) {
        await cache.clear();
      } else {
        await Promise.all(Array.from(cacheTagsByKey.keys(), (key) => cache.delete(key)));
      }
      cacheTagsByKey.clear();
    }
  });
}

async function writeFetchResponseToNodeResponse(
  response: Response,
  res: {
    writeHead: (status: number, headers: Record<string, string | string[]>) => void;
    end: (body?: string | Uint8Array) => void;
  }
): Promise<void> {
  res.writeHead(response.status, responseHeadersToNode(responseHeadersFromFetch(response.headers)));
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function writeReadableStreamToNodeResponse(
  stream: ReadableStream<Uint8Array>,
  res: {
    write: (chunk: Uint8Array) => boolean | void;
    end: () => void;
    destroyed?: boolean;
    once?: (event: string, listener: () => void) => unknown;
    off?: (event: string, listener: () => void) => unknown;
  }
) {
  const reader = stream.getReader();
  let complete = false;
  let closed = Boolean(res.destroyed);
  let rejectClosed: ((error: Error) => void) | undefined;
  const closedPromise = new Promise<never>((_resolve, reject) => {
    rejectClosed = reject;
  });
  const onClose = () => {
    closed = true;
    rejectClosed?.(new Error("tavo ssr: response closed while streaming."));
  };
  if (res.once && !closed) {
    res.once("close", onClose);
  }
  try {
    if (closed) onClose();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), closedPromise]);
      if (done) {
        break;
      }
      if (value) {
        const writable = res.write(value);
        if (writable === false && res.once) {
          if (res.destroyed || closed) onClose();
          let onDrain: (() => void) | undefined;
          const drainPromise = new Promise<void>((resolve) => {
            onDrain = resolve;
            res.once!("drain", onDrain);
          });
          try {
            await Promise.race([drainPromise, closedPromise]);
          } finally {
            if (onDrain) res.off?.("drain", onDrain);
          }
        }
      }
    }
    complete = true;
  } finally {
    res.off?.("close", onClose);
    if (!complete) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
  if (!res.destroyed) res.end();
}

/** Creates a Node-style request handler that renders framework pages to HTML. */
export function createNodeRequestHandler(
  options: NodeHandlerOptions,
  runtime?: PagesRuntime | Promise<PagesRuntime>,
) {
  const canonicalOrigin = normalizeCanonicalOrigin(options.canonicalOrigin);
  const handlerOptions: NodeHandlerOptions = canonicalOrigin
    ? {
        ...options,
        trustedHosts: Array.from(new Set([
          ...(options.trustedHosts ?? []),
          canonicalOrigin.host,
          canonicalOrigin.hostname
        ]))
      }
    : options;
  const runtimePromise = runtime
    ? Promise.resolve(runtime)
    : createPagesRuntimeAsync(handlerOptions.modules, handlerOptions);
  const renderResponse = createStaticResponseRenderer(handlerOptions, runtimePromise);
  const handle = async function handle(
    req: {
      url?: string;
      method?: string;
      headers?: Record<string, string | undefined>;
      once?: (event: string, listener: () => void) => unknown;
      off?: (event: string, listener: () => void) => unknown;
    },
    res: {
      writeHead: (status: number, headers: Record<string, string | string[]>) => void;
      write: (chunk: Uint8Array) => boolean | void;
      end: (body?: string | Uint8Array) => void;
      headersSent?: boolean;
      destroyed?: boolean;
      once?: (event: string, listener: () => void) => unknown;
      off?: (event: string, listener: () => void) => unknown;
    }
  ): Promise<void> {
    const requestController = new AbortController();
    const abortRequest = () => requestController.abort(new DOMException("Client disconnected", "AbortError"));
    req.once?.("aborted", abortRequest);
    try {
    const host = req.headers?.host || "localhost";
    const url = new URL(req.url || "/", canonicalOrigin ?? `http://${host}`);
    let optimizedImage;
    try {
      optimizedImage = await optimizeImageFromUrl(url, options.images);
    } catch (error) {
      if (url.pathname === "/_tavo/image") {
        logImageOptimizerError(error, url);
        await writeFetchResponseToNodeResponse(imageOptimizerErrorToResponse(error), res);
        return;
      }
      throw error;
    }
    if (optimizedImage) {
      const response = imageOptimizerResultToResponse(optimizedImage);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const runtime = await runtimePromise;
    let fetchRequest: Request;
    try {
      fetchRequest = await createFetchRequestFromNodeRequest(req as NodeRequestLike, url, {
        maxBodyBytes: options.maxRequestBodyBytes,
        signal: requestController.signal
      });
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        await writeFetchResponseToNodeResponse(payloadTooLargeResponse(), res);
        return;
      }
      throw error;
    }
    let pluginResponse: Response | null;
    try {
      pluginResponse = await handlePluginRequest(
        runtime.pluginRuntime,
        fetchRequest,
        {
          rawRequest: req,
          trustedHosts: handlerOptions.trustedHosts
        }
      );
    } catch {
      await writeFetchResponseToNodeResponse(internalServerErrorResponse(), res);
      return;
    }
    if (pluginResponse) {
      await writeFetchResponseToNodeResponse(withDefaultFetchSecurityHeaders(pluginResponse), res);
      return;
    }
    const canonicalRedirect = canonicalPageRedirect(runtime, url);
    if (canonicalRedirect) {
      await writeFetchResponseToNodeResponse(canonicalRedirect, res);
      return;
    }
    if (!isPageRenderMethod(req.method)) {
      const actionResponse = await runtime.handleAction(url.pathname, {
        request: fetchRequest,
        rawRequest: req
      });
      if (actionResponse) {
        await writeFetchResponseToNodeResponse(canonicalizeActionRedirect(actionResponse, runtime, url), res);
        return;
      }
      await writeMethodNotAllowedResponse(res);
      return;
    }
    if (options.stream) {
      const response = await renderPagesStreamResponseFromRuntimeAsync(runtime, url.pathname, {
        ...handlerOptions,
        request: { request: fetchRequest, rawRequest: req },
        document: {
          ...(handlerOptions.document ?? {})
        }
      });
      res.writeHead(response.status, responseHeadersToNode(response.headers));
      await writeReadableStreamToNodeResponse(response.stream, res);
      return;
    }
    const response = await renderResponse(url.pathname, { request: fetchRequest, rawRequest: req });
    res.writeHead(response.status, responseHeadersToNode(response.headers));
    res.end(response.html);
    } catch {
      if (res.headersSent) {
        if (!res.destroyed) res.end();
        return;
      }
      await writeFetchResponseToNodeResponse(internalServerErrorResponse(), res);
    } finally {
      req.off?.("aborted", abortRequest);
    }
  };
  return Object.assign(handle, {
    invalidateCache: renderResponse.invalidateCache,
    clearCache: renderResponse.clearCache
  });
}

/** Creates a Fetch API request handler that renders framework pages to HTML. */
export function createFetchRequestHandler(options: FetchHandlerOptions) {
  const runtimePromise = createPagesRuntimeAsync(options.modules, options);
  const renderResponse = createStaticResponseRenderer(options, runtimePromise);
  const handle = async function handle(request: Request): Promise<Response> {
    try {
    const url = new URL(request.url);
    let optimizedImage;
    try {
      optimizedImage = await optimizeImageFromUrl(url, options.images);
    } catch (error) {
      if (url.pathname === "/_tavo/image") {
        logImageOptimizerError(error, url);
        return imageOptimizerErrorToResponse(error);
      }
      throw error;
    }
    if (optimizedImage) {
      return imageOptimizerResultToResponse(optimizedImage);
    }
    const runtime = await runtimePromise;
    let pluginResponse: Response | null;
    try {
      pluginResponse = await handlePluginRequest(runtime.pluginRuntime, request, {
        trustedHosts: options.trustedHosts
      });
    } catch {
      return internalServerErrorResponse();
    }
    if (pluginResponse) {
      return withDefaultFetchSecurityHeaders(pluginResponse);
    }
    const canonicalRedirect = canonicalPageRedirect(runtime, url);
    if (canonicalRedirect) return canonicalRedirect;
    if (!isPageRenderMethod(request.method)) {
      const actionResponse = await runtime.handleAction(url.pathname, request);
      return actionResponse
        ? canonicalizeActionRedirect(actionResponse, runtime, url)
        : methodNotAllowedResponse();
    }
    if (options.stream) {
      const response = await renderPagesStreamResponseFromRuntimeAsync(runtime, url.pathname, {
        ...options,
        request,
        document: {
          ...(options.document ?? {})
        }
      });
      return new Response(response.stream, {
        status: response.status,
        headers: responseHeadersToFetch(response.headers)
      });
    }
    const response = await renderResponse(url.pathname, request);
    return new Response(response.html, {
      status: response.status,
      headers: responseHeadersToFetch(response.headers)
    });
    } catch {
      return internalServerErrorResponse();
    }
  };
  return Object.assign(handle, {
    invalidateCache: renderResponse.invalidateCache,
    clearCache: renderResponse.clearCache
  });
}
