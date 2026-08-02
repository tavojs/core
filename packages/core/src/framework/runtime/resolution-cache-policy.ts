import type { RouterParams } from "../../router/index.js";
import type { NormalizedPageRequest } from "../../ssr/request.js";
import type { PageCachePolicy, PageRouteDefinition } from "../types.js";
import { createPageContext } from "./context.js";

export async function resolveDynamicCachePolicy(
  route: PageRouteDefinition,
  pathname: string,
  params: RouterParams,
  request: NormalizedPageRequest
): Promise<PageCachePolicy> {
  const tags = new Set(route.cache.tags);
  const context = createPageContext(pathname, params, request);
  for (const resolver of route.cacheTagResolvers) {
    if (typeof resolver !== "function") continue;
    const resolved = await resolver(context);
    request.request.signal.throwIfAborted();
    for (const tag of Array.isArray(resolved) ? resolved : [resolved]) {
      const normalized = tag.trim();
      if (normalized) tags.add(normalized);
    }
  }
  return { ...route.cache, tags: Array.from(tags) };
}
