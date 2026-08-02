import type { RouterParams } from "./types.js";

type CompiledRouteSegment =
  | { kind: "static"; value: string }
  | { kind: "param"; key: string }
  | { kind: "optional-param"; key: string }
  | { kind: "catch-all"; key: string }
  | { kind: "optional-catch-all"; key: string };

export type CompiledRoutePattern = {
  pattern: string;
  segments: CompiledRouteSegment[];
  dynamic: boolean;
  linear: boolean;
  memoizeFailures: boolean;
};

/** Ensures paths are absolute and router-normalized. */
export function normalizePath(path: string): string {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  return absolute.length > 1 ? absolute.replace(/\/+$/, "") : absolute;
}

/** Splits normalized paths into route segments. */
export function splitPathSegments(path: string): string[] {
  return normalizePath(path).split("/").filter(Boolean);
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Precompiles a router path pattern for repeated match checks. */
export function compilePattern(pattern: string): CompiledRoutePattern {
  const segments = splitPathSegments(pattern).map<CompiledRouteSegment>((segment) => {
    if (segment.startsWith("*?")) {
      return { kind: "optional-catch-all", key: segment.slice(2) };
    }
    if (segment.startsWith("*")) {
      return { kind: "catch-all", key: segment.slice(1) || "*" };
    }
    if (segment.startsWith(":?")) {
      return { kind: "optional-param", key: segment.slice(2) };
    }
    if (segment.startsWith(":")) {
      return { kind: "param", key: segment.slice(1) };
    }
    return { kind: "static", value: segment };
  });

  return {
    pattern,
    segments,
    dynamic: segments.some((segment) => segment.kind !== "static"),
    linear: segments.every((segment) => segment.kind === "static" || segment.kind === "param"),
    memoizeFailures:
      segments.filter((segment) => segment.kind !== "static" && segment.kind !== "param").length > 1
  };
}

/** Matches a precompiled router pattern against a pathname. */
export function matchCompiledPattern(
  compiled: CompiledRoutePattern,
  pathname: string
): RouterParams | null {
  return matchCompiledPatternSegments(compiled, splitPathSegments(pathname));
}

export function matchCompiledPatternSegments(
  compiled: CompiledRoutePattern,
  pathParts: string[]
): RouterParams | null {
  if (compiled.linear) {
    if (compiled.segments.length !== pathParts.length) return null;
    const params: RouterParams = {};
    for (let index = 0; index < compiled.segments.length; index += 1) {
      const segment = compiled.segments[index]!;
      const value = pathParts[index]!;
      if (segment.kind === "static") {
        if (segment.value !== value) return null;
        continue;
      }
      const decoded = decodePathSegment(value);
      if (decoded === null) return null;
      Object.defineProperty(params, segment.key, {
        configurable: true,
        enumerable: true,
        value: decoded,
        writable: true
      });
    }
    return params;
  }
  const failedStates = compiled.memoizeFailures ? new Set<number>() : null;
  const pathStateWidth = pathParts.length + 1;
  const assignParam = (
    params: RouterParams,
    key: string,
    value: string,
    catchAll = false
  ): RouterParams => {
    const next = { ...params };
    Object.defineProperty(next, key, { configurable: true, enumerable: true, value, writable: true });
    if (catchAll && key !== "*") {
      Object.defineProperty(next, "*", { configurable: true, enumerable: false, value, writable: true });
    }
    return next;
  };
  const matchFrom = (patternIndex: number, pathIndex: number, params: RouterParams): RouterParams | null => {
    const state = patternIndex * pathStateWidth + pathIndex;
    if (failedStates?.has(state)) return null;

    const fail = (): null => {
      failedStates?.add(state);
      return null;
    };

    if (patternIndex === compiled.segments.length) {
      return pathIndex === pathParts.length ? params : fail();
    }
    const segment = compiled.segments[patternIndex];
    const value = pathParts[pathIndex];
    if (segment.kind === "static") {
      if (value !== segment.value) return fail();
      return matchFrom(patternIndex + 1, pathIndex + 1, params) ?? fail();
    }
    if (segment.kind === "param") {
      if (value === undefined) return fail();
      const decoded = decodePathSegment(value);
      if (decoded === null) return fail();
      return matchFrom(
        patternIndex + 1,
        pathIndex + 1,
        assignParam(params, segment.key, decoded)
      ) ?? fail();
    }
    if (segment.kind === "optional-param") {
      if (value !== undefined) {
        const decoded = decodePathSegment(value);
        if (decoded !== null) {
          const consumed = matchFrom(
            patternIndex + 1,
            pathIndex + 1,
            assignParam(params, segment.key, decoded)
          );
          if (consumed) return consumed;
        }
      }
      const skipped = matchFrom(patternIndex + 1, pathIndex, params);
      return skipped ?? fail();
    }
    const minimumEnd = segment.kind === "catch-all" ? pathIndex + 1 : pathIndex;
    for (let end = pathParts.length; end >= minimumEnd; end -= 1) {
      const matched = matchFrom(
        patternIndex + 1,
        end,
        assignParam(
          params,
          segment.key,
          pathParts.slice(pathIndex, end).join("/"),
          segment.kind === "catch-all"
        )
      );
      if (matched) return matched;
    }
    return fail();
  };
  return matchFrom(0, 0, {});
}

export function getStaticPatternPrefix(compiled: CompiledRoutePattern): string {
  const parts: string[] = [];
  for (const segment of compiled.segments) {
    if (segment.kind !== "static") break;
    parts.push(segment.value);
  }
  return parts.length > 0 ? `/${parts.join("/")}` : "";
}

/** Matches router path patterns and returns decoded route params. */
export function matchPattern(pattern: string, pathname: string): RouterParams | null {
  return matchCompiledPattern(compilePattern(pattern), pathname);
}

/** Returns current browser pathname with a server-side fallback. */
export function resolvePathname(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  return window.location.pathname || "/";
}
