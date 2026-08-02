import type { RouterParams } from "../../router/index.js";
import type {
  PageMiddleware,
  PageRouteDefinition
} from "../types.js";
import {
  compilePattern,
  getStaticPatternPrefix,
  matchCompiledPatternSegments,
  normalizePath,
  splitPathSegments
} from "../path-utils.js";

export type RuntimeRouteEntry = {
  route: PageRouteDefinition;
  middlewareChain: PageMiddleware[];
  layoutHeadLayers: PageRouteDefinition["layoutLayers"];
  pageHead: PageRouteDefinition["head"];
};

type DynamicRoute = {
  route: PageRouteDefinition;
  compiled: ReturnType<typeof compilePattern>;
  order: number;
  entry: RuntimeRouteEntry;
};

export type RuntimeRouteIndex = {
  staticRoutes: Map<string, PageRouteDefinition>;
  entries: Map<string, RuntimeRouteEntry>;
  dynamicRoutes: DynamicRoute[];
  dynamicRoutesByPrefix: Map<string, DynamicRoute[]>;
  unprefixedDynamicRoutes: DynamicRoute[];
};

const DYNAMIC_ROUTE_INDEX_THRESHOLD = 16;

export function createRuntimeRouteIndex(
  routes: PageRouteDefinition[],
  baseMiddleware: PageMiddleware[]
): RuntimeRouteIndex {
  const staticRoutes = new Map<string, PageRouteDefinition>();
  const entries = new Map<string, RuntimeRouteEntry>();
  const dynamicRoutes = routes.map((route, order): DynamicRoute => ({
    route,
    compiled: compilePattern(route.path),
    order,
    entry: {
      route,
      middlewareChain: [
        ...baseMiddleware,
        ...route.layoutLayers.flatMap((layer) => layer.middleware),
        ...route.middleware
      ],
      layoutHeadLayers: route.layoutLayers.filter((layer) => Boolean(layer.head)),
      pageHead: route.head
    }
  })).filter((item) => {
    entries.set(item.route.path, item.entry);
    if (item.compiled.dynamic) return true;
    staticRoutes.set(item.route.path, item.route);
    return false;
  });
  const dynamicRoutesByPrefix = new Map<string, DynamicRoute[]>();
  const unprefixedDynamicRoutes: DynamicRoute[] = [];
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
    staticRoutes,
    entries,
    dynamicRoutes,
    dynamicRoutesByPrefix,
    unprefixedDynamicRoutes
  };
}

export function resolveIndexedRoute(
  index: RuntimeRouteIndex,
  pathname: string
): { route: PageRouteDefinition | null; params: RouterParams } {
  const normalized = normalizePath(pathname);
  const staticRoute = index.staticRoutes.get(normalized);
  if (staticRoute) return { route: staticRoute, params: {} };
  const pathParts = splitPathSegments(normalized);
  if (index.dynamicRoutes.length < DYNAMIC_ROUTE_INDEX_THRESHOLD) {
    for (const entry of index.dynamicRoutes) {
      const params = matchCompiledPatternSegments(entry.compiled, pathParts);
      if (params) return { route: entry.route, params };
    }
    return { route: null, params: {} };
  }
  const candidates = [...index.unprefixedDynamicRoutes];
  let prefix = "";
  for (const part of pathParts) {
    prefix += `/${part}`;
    const group = index.dynamicRoutesByPrefix.get(prefix);
    if (group) candidates.push(...group);
  }
  if (candidates.length > 1) {
    candidates.sort((left, right) => left.order - right.order);
  }
  for (const entry of candidates) {
    const params = matchCompiledPatternSegments(entry.compiled, pathParts);
    if (params) return { route: entry.route, params };
  }
  return { route: null, params: {} };
}
