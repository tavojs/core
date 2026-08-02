import {
  compilePattern,
  getStaticPatternPrefix,
  matchCompiledPatternSegments,
  normalizePath,
  resolvePathname
} from "./path.js";
import {
  createRouterHistoryState,
  prepareRouterScrollNavigation
} from "./scroll.js";
import type { RouteConfig, Router, RouterNavigateOptions } from "./types.js";

const DYNAMIC_ROUTE_INDEX_THRESHOLD = 16;

function createRouterPopStateEvent(): Event {
  return window.PopStateEvent
    ? new window.PopStateEvent("popstate")
    : new window.Event("popstate");
}

/** Creates a client router with history navigation and pattern matching. */
export function createRouter(routes: RouteConfig[]): Router {
  const staticRoutes = new Map<string, RouteConfig>();
  const normalizedRoutes = routes.map((route, order) => ({
    ...route,
    path: normalizePath(route.path),
    order
  })).map((route) => ({
    ...route,
    compiled: compilePattern(route.path)
  }));

  const dynamicRoutes = normalizedRoutes.filter((route) => {
    if (!route.compiled.dynamic) {
      staticRoutes.set(route.path, route);
      return false;
    }
    return true;
  });
  const dynamicRoutesByPrefix = new Map<string, typeof dynamicRoutes>();
  const unprefixedDynamicRoutes: typeof dynamicRoutes = [];
  for (const route of dynamicRoutes) {
    const prefix = getStaticPatternPrefix(route.compiled);
    if (!prefix) {
      unprefixedDynamicRoutes.push(route);
      continue;
    }
    const group = dynamicRoutesByPrefix.get(prefix);
    if (group) group.push(route);
    else dynamicRoutesByPrefix.set(prefix, [route]);
  }

  return {
    navigate(to: string, options?: RouterNavigateOptions): void {
      if (typeof window === "undefined") {
        return;
      }
      const pathname = normalizePath(to);
      prepareRouterScrollNavigation(to, options);
      const state = createRouterHistoryState(options);
      if (options?.replace) {
        window.history.replaceState(state, "", pathname);
      } else {
        window.history.pushState(state, "", pathname);
      }
      window.dispatchEvent(createRouterPopStateEvent());
    },
    getPathname(): string {
      return resolvePathname();
    },
    match(pathname: string) {
      const normalizedPath = normalizePath(pathname);
      const staticRoute = staticRoutes.get(normalizedPath);
      if (staticRoute) {
        return { route: staticRoute, params: {} };
      }

      const pathParts = normalizedPath.split("/").filter(Boolean);
      if (dynamicRoutes.length < DYNAMIC_ROUTE_INDEX_THRESHOLD) {
        for (const route of dynamicRoutes) {
          const params = matchCompiledPatternSegments(route.compiled, pathParts);
          if (params) return { route, params };
        }
        return { route: null, params: {} };
      }
      const candidates = [...unprefixedDynamicRoutes];
      let prefix = "";
      for (const part of pathParts) {
        prefix += `/${part}`;
        const group = dynamicRoutesByPrefix.get(prefix);
        if (group) candidates.push(...group);
      }
      if (candidates.length > 1) candidates.sort((left, right) => left.order - right.order);
      for (const route of candidates) {
        const params = matchCompiledPatternSegments(route.compiled, pathParts);
        if (params) {
          return { route, params };
        }
      }
      return { route: null, params: {} };
    }
  };
}
