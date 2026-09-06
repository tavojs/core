import { createPagesRuntimeAsync, renderPagesResponseFromRuntimeAsync } from "../framework/index.js";
import { createRequestCacheKey } from "../framework/runtime/cache.js";
import { createMemoryStaticCache } from "./cache.js";
import { hasPersonalRequestHeaders } from "./request.js";
import type { FetchHandlerOptions, NodeHandlerOptions, SsrStaticCacheEntry } from "./types.js";

function cloneCachedResponse(entry: SsrStaticCacheEntry) {
  return {
    ...entry.response,
    headers: { ...entry.response.headers }
  };
}

export function createStaticResponseRenderer(
  options: NodeHandlerOptions | FetchHandlerOptions,
  runtimePromise = createPagesRuntimeAsync(options.modules, options)
) {
  const cache = options.staticCache ?? createMemoryStaticCache();
  const inflight = new Map<string, Promise<Awaited<ReturnType<typeof renderPagesResponseFromRuntimeAsync>>>>();
  // Native adapters own their entry lifecycle, so they must also own invalidation
  // metadata. Only minimal adapters need the bounded compatibility index below.
  const needsCacheIndex = !cache.invalidateTags || !cache.clear;
  const maxIndexedEntries = 1_024;
  const cacheTagsByKey = new Map<string, string[]>();
  let cacheMutation: Promise<unknown> = Promise.resolve();

  function mutateCache<T>(operation: () => Promise<T>): Promise<T> {
    if (!needsCacheIndex) return operation();
    const result = cacheMutation.then(operation);
    cacheMutation = result.catch(() => undefined);
    return result;
  }

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
            await mutateCache(async () => {
              if (needsCacheIndex && !cacheTagsByKey.has(cacheKey) && cacheTagsByKey.size >= maxIndexedEntries) {
                const oldest = cacheTagsByKey.keys().next().value!;
                // Evict the actual entry before forgetting how to invalidate it.
                // If deletion fails, leave it indexed and skip this cache write.
                await cache.delete(oldest);
                cacheTagsByKey.delete(oldest);
              }
              await cache.set(cacheKey, {
                response,
                tags: response.resolved.cache.tags,
                expiresAt:
                  response.resolved.cache.revalidate === null
                    ? null
                    : now + response.resolved.cache.revalidate * 1000
              });
              if (needsCacheIndex) {
                cacheTagsByKey.delete(cacheKey);
                cacheTagsByKey.set(cacheKey, response.resolved.cache.tags);
              }
            });
          } catch {
            // A cache adapter failure should degrade to an uncached render.
          }
        } else {
          try {
            await mutateCache(async () => {
              await cache.delete(cacheKey);
              cacheTagsByKey.delete(cacheKey);
            });
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
      await mutateCache(async () => {
        if (cache.invalidateTags) {
          deleted += await cache.invalidateTags(Array.from(requested));
        }
        for (const [key, entryTags] of cacheTagsByKey) {
          if (!entryTags.some((tag) => requested.has(tag))) continue;
          if (!cache.invalidateTags) {
            await cache.delete(key);
            deleted += 1;
          }
          cacheTagsByKey.delete(key);
        }
      });
      return deleted;
    },
    async clearCache(): Promise<void> {
      const runtime = await runtimePromise;
      runtime.clearCache();
      await mutateCache(async () => {
        if (cache.clear) {
          await cache.clear();
        } else {
          await Promise.all(Array.from(cacheTagsByKey.keys(), (key) => cache.delete(key)));
        }
        cacheTagsByKey.clear();
      });
    }
  });
}
