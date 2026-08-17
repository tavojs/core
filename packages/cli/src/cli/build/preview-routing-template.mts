type PreviewRoutingOptions = {
  routes: readonly string[];
  endpoints: readonly {
    methods: readonly string[];
    kind: "exact" | "subtree";
    path: string;
  }[];
  trailingSlash: "always" | "never" | "preserve";
};

export function createPreviewRoutingSource(options: PreviewRoutingOptions): string[] {
  return [
    `const trailingSlashPolicy = ${JSON.stringify(options.trailingSlash)};`,
    `const pageRoutePatterns = ${JSON.stringify(options.routes)};`,
    `const pluginEndpointPatterns = ${JSON.stringify(options.endpoints)};`,
    "function routePatternMatches(pattern, pathname) {",
    "  const route = pattern.split(\"/\").filter(Boolean);",
    "  const pathParts = pathname.split(\"/\").filter(Boolean);",
    "  function visit(routeIndex, pathIndex) {",
    "    if (routeIndex === route.length) return pathIndex === pathParts.length;",
    "    const segment = route[routeIndex];",
    "    if (segment.startsWith(\"*?\")) {",
    "      for (let end = pathParts.length; end >= pathIndex; end -= 1) if (visit(routeIndex + 1, end)) return true;",
    "      return false;",
    "    }",
    "    if (segment.startsWith(\"*\")) {",
    "      for (let end = pathParts.length; end > pathIndex; end -= 1) if (visit(routeIndex + 1, end)) return true;",
    "      return false;",
    "    }",
    "    if (segment.startsWith(\":?\")) return visit(routeIndex + 1, pathIndex + 1) || visit(routeIndex + 1, pathIndex);",
    "    if (pathIndex >= pathParts.length) return false;",
    "    return (segment.startsWith(\":\") || segment === pathParts[pathIndex]) && visit(routeIndex + 1, pathIndex + 1);",
    "  }",
    "  return visit(0, 0);",
    "}",
    "function canonicalPageLocation(url, method) {",
    "  if (trailingSlashPolicy === \"preserve\" || (method !== \"GET\" && method !== \"HEAD\")) return null;",
    "  const pathname = url.pathname;",
    "  if (pathname === \"/\") return null;",
    "  const pluginEndpoint = pluginEndpointPatterns.some((endpoint) => {",
    "    if (!endpoint.methods.includes(method)) return false;",
    "    return endpoint.kind === \"exact\"",
    "      ? pathname === endpoint.path",
    "      : pathname === endpoint.path || pathname.startsWith(`${endpoint.path}/`);",
    "  });",
    "  if (pluginEndpoint) return null;",
    "  const matchingPatterns = pageRoutePatterns.filter((pattern) => routePatternMatches(pattern, pathname));",
    "  const matchingPattern = matchingPatterns.find((pattern) =>",
    "    !pattern.split(\"/\").some((segment) => segment.startsWith(\":\") || segment.startsWith(\"*\"))",
    "  ) ?? matchingPatterns[0];",
    "  if (!matchingPattern) return null;",
    "  const dynamicMatch = matchingPattern.split(\"/\").some((segment) => segment.startsWith(\":\") || segment.startsWith(\"*\"));",
    "  if (dynamicMatch && path.posix.basename(pathname).includes(\".\")) return null;",
    "  const canonicalPathname = trailingSlashPolicy === \"always\"",
    "    ? `${pathname.replace(/\\/+$/, \"\")}/`",
    "    : pathname.replace(/\\/+$/, \"\") || \"/\";",
    "  return canonicalPathname === pathname ? null : `${canonicalPathname}${url.search}`;",
    "}",
  ];
}
