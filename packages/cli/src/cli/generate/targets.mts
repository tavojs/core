import path from "node:path";
import type { ResolvedNamedFolderTarget, ResolvedPageTarget } from "../types.mjs";
import { toPascalCase } from "../utils/format.mjs";
import { normalizeGeneratorName } from "../utils/path.mjs";

function pageFileName(name: string): string {
  return name === "home" || name === "index" ? "index.tsx" : `${name}.tsx`;
}

export function resolvePageTarget(baseDir: string, rawName: string): ResolvedPageTarget {
  const normalized = normalizeGeneratorName(rawName || "index");
  const segments = normalized.split("/").filter(Boolean);
  const leaf = segments.pop() ?? "index";
  const fileName = pageFileName(leaf);
  return {
    target: path.join(baseDir, ...segments, fileName),
    routeName: normalized,
    componentName: `${toPascalCase(leaf === "index" ? segments[segments.length - 1] ?? "home" : leaf)}Page`
  };
}

export function routePatternFromName(rawName: string): string {
  const normalized = normalizeGeneratorName(rawName || "index");
  const segments = normalized.split("/").filter(Boolean);
  const leaf = segments.pop() ?? "index";
  const routeSegments = [...segments];
  if (leaf !== "home" && leaf !== "index") {
    routeSegments.push(leaf);
  }
  return routeSegments.length === 0 ? "/" : `/${routeSegments.join("/")}`;
}

export function firstRouteParamName(routePattern: string): string | null {
  const match = routePattern.match(/\[(?:\[?(?:\.\.\.)?)([A-Za-z0-9_$-]+)\]?\]/);
  return match?.[1] ?? null;
}

export function validateStoreShape(shape: string | null): string[] | null {
  if (!shape) {
    return null;
  }
  const entries = shape.split(",").map((entry) => entry.trim()).filter(Boolean);
  for (const entry of entries) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry)) {
      throw new Error(`tavo CLI: invalid store shape key "${entry}". Use comma-separated JavaScript identifiers.`);
    }
  }
  return entries;
}

export function resolveNamedFolderTarget(baseDir: string, rawName: string, fileName = "index.tsx"): ResolvedNamedFolderTarget {
  const normalized = normalizeGeneratorName(rawName);
  const segments = normalized.split("/").filter(Boolean);
  const leaf = segments[segments.length - 1] ?? normalized;
  return {
    target: path.join(baseDir, ...segments, fileName),
    name: leaf,
    normalized
  };
}
