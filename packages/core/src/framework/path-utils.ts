import type { RouterParams } from "../router/index.js";

const PAGE_FILE_EXT = /\.[cm]?[jt]sx?$/;
const ROUTE_GROUP_RE = /^\((.+)\)$/;

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

/** Normalizes route paths to always start with '/'. */
export function normalizePath(path: string): string {
  const absolute = path.startsWith("/") ? path : `/${path}`;
  if (absolute.length <= 1 || absolute.charCodeAt(absolute.length - 1) !== 47) {
    return absolute;
  }
  let end = absolute.length - 1;
  while (end > 1 && absolute.charCodeAt(end - 1) === 47) {
    end -= 1;
  }
  return absolute.slice(0, end);
}

/** Splits a path string into non-empty normalized segments. */
export function splitPathSegments(path: string): string[] {
  const normalized = normalizePath(path);
  if (normalized === "/") {
    return [];
  }
  const body = normalized.slice(1);
  return body.includes("//") ? body.split("/").filter(Boolean) : body.split("/");
}

function assignDecodedParam(params: RouterParams, key: string, value: string): void {
  if (key !== "__proto__" && key !== "prototype" && key !== "constructor") {
    params[key] = value;
    return;
  }
  Object.defineProperty(params, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true
  });
}

function decodePathSegment(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** Precompiles a route pattern into reusable segment match metadata. */
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

/** Matches a precompiled route pattern against a pathname. */
export function matchCompiledPattern(
  compiled: CompiledRoutePattern,
  pathname: string
): RouterParams | null {
  return matchCompiledPatternSegments(compiled, splitPathSegments(pathname));
}

/** Matches an already-tokenized pathname to avoid repeated work across route candidates. */
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
      assignDecodedParam(params, segment.key, decoded);
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
    assignDecodedParam(next, key, value);
    if (catchAll && key !== "*") {
      Object.defineProperty(next, "*", {
        configurable: true,
        enumerable: false,
        value,
        writable: true
      });
    }
    return next;
  };

  const matchFrom = (patternIndex: number, pathIndex: number, params: RouterParams): RouterParams | null => {
    const state = patternIndex * pathStateWidth + pathIndex;
    if (failedStates?.has(state)) {
      return null;
    }

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
      if (value !== segment.value) {
        return fail();
      }
      return matchFrom(patternIndex + 1, pathIndex + 1, params) ?? fail();
    }
    if (segment.kind === "param") {
      if (value === undefined) {
        return fail();
      }
      const decoded = decodePathSegment(value);
      if (decoded === null) {
        return fail();
      }
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
          if (consumed) {
            return consumed;
          }
        }
      }
      const skipped = matchFrom(patternIndex + 1, pathIndex, params);
      return skipped ?? fail();
    }

    const minimumEnd = segment.kind === "catch-all" ? pathIndex + 1 : pathIndex;
    for (let end = pathParts.length; end >= minimumEnd; end -= 1) {
      const captured = pathParts.slice(pathIndex, end).join("/");
      const matched = matchFrom(
        patternIndex + 1,
        end,
        assignParam(params, segment.key, captured, segment.kind === "catch-all")
      );
      if (matched) {
        return matched;
      }
    }
    return fail();
  };

  return matchFrom(0, 0, {});
}

/** Matches framework route patterns against pathnames and extracts params. */
export function matchPattern(pattern: string, pathname: string): RouterParams | null {
  return matchCompiledPattern(compilePattern(pattern), pathname);
}

type ParsedPageFile = {
  dirParts: string[];
  fileStem: string;
};

/** Normalizes file separators for page module file paths. */
function normalizePageFile(file: string): string {
  return file.replace(/\\/g, "/");
}

/** Parses a page module file path into directory segments and stem metadata. */
export function parsePageFile(file: string): ParsedPageFile {
  const normalized = normalizePageFile(file);
  const marker = "/pages/";
  const markerIndex = normalized.lastIndexOf(marker);

  let relative = markerIndex >= 0 ? normalized.slice(markerIndex + marker.length) : normalized;
  relative = relative.replace(/^\.?\/*/, "").replace(/^src\//, "").replace(/^pages\//, "");
  relative = relative.replace(PAGE_FILE_EXT, "");

  const segments = relative.split("/").filter(Boolean);
  const fileStem = segments.pop() ?? "index";

  return {
    dirParts: segments,
    fileStem
  };
}

/** Converts a file-system route segment to a runtime route token. */
function toRouteSegment(segment: string): string | null {
  if (ROUTE_GROUP_RE.test(segment)) {
    return null;
  }
  const catchAllOptional = segment.match(/^\[\[\.\.\.(.+)\]\]$/);
  if (catchAllOptional) {
    return `*?${catchAllOptional[1]}`;
  }
  const catchAll = segment.match(/^\[\.\.\.(.+)\]$/);
  if (catchAll) {
    return `*${catchAll[1]}`;
  }
  const optional = segment.match(/^\[\[(.+)\]\]$/);
  if (optional) {
    return `:?${optional[1]}`;
  }
  const dynamic = segment.match(/^\[(.+)\]$/);
  if (dynamic) {
    return `:${dynamic[1]}`;
  }
  return segment;
}

/** Builds a route pathname from parsed directory segments and file stem. */
export function toRoutePath(parts: string[], fileStem: string): string {
  const allParts = [...parts];
  if (fileStem !== "index") {
    allParts.push(fileStem);
  }
  const routeSegments = allParts
    .map(toRouteSegment)
    .filter((segment): segment is string => segment !== null);
  return routeSegments.length === 0 ? "/" : `/${routeSegments.join("/")}`;
}

/** Computes parent layout keys for nested layout resolution. */
export function parentDirKeys(parts: string[]): string[] {
  const out: string[] = [""];
  for (let i = 1; i <= parts.length; i += 1) {
    out.push(parts.slice(0, i).join("/"));
  }
  return out;
}

/** Scores a route for deterministic specificity-based sorting. */
export function rankRoute(path: string): number {
  const segments = splitPathSegments(path);
  if (segments.length === 0) {
    return 1000;
  }
  let score = 0;
  for (const segment of segments) {
    if (segment.startsWith("*")) {
      score += 1;
    } else if (segment.startsWith(":")) {
      score += 2;
    } else {
      score += 3;
    }
  }
  return score * 100 + segments.length;
}

/** Orders routes by the first segment where their specificity differs. */
export function compareRouteSpecificity(left: string, right: string): number {
  const leftSegments = splitPathSegments(left);
  const rightSegments = splitPathSegments(right);
  const rankSegment = (segment: string): number => {
    if (segment.startsWith("*?")) return 0;
    if (segment.startsWith("*")) return 1;
    if (segment.startsWith(":?")) return 2;
    if (segment.startsWith(":")) return 3;
    return 4;
  };
  const commonLength = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < commonLength; index += 1) {
    const difference = rankSegment(rightSegments[index]) - rankSegment(leftSegments[index]);
    if (difference !== 0) {
      return difference;
    }
  }
  return leftSegments.length - rightSegments.length;
}

/** Returns the leading static pathname shared by every match of a compiled route. */
export function getStaticPatternPrefix(compiled: CompiledRoutePattern): string {
  const parts: string[] = [];
  for (const segment of compiled.segments) {
    if (segment.kind !== "static") {
      break;
    }
    parts.push(segment.value);
  }
  return parts.length > 0 ? `/${parts.join("/")}` : "";
}
