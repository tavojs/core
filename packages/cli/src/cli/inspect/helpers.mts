import path from "node:path";
import type { SourceRange } from "../project/analyzer.mjs";
import type { CliFlags } from "../types.mjs";
import { fileExists } from "../utils/fs.mjs";
import { toPosixPath } from "../utils/path.mjs";
import type { ProjectDiagnostic, RouteInspection } from "./types.mjs";

export function printJson(value: unknown): void {
  console.log(JSON.stringify(value));
}

export function isJson(flags?: CliFlags): boolean {
  return Boolean(flags?.json);
}

export async function readFileSafe(filePath: string): Promise<string | null> {
  try {
    return await import("node:fs/promises").then((fs) => fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export async function readPackageJson(rootDir: string): Promise<Record<string, unknown> | null> {
  const source = await readFileSafe(path.join(rootDir, "package.json"));
  if (!source) {
    return null;
  }
  try {
    return JSON.parse(source) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export async function hasTavoConfig(rootDir: string): Promise<boolean> {
  return await fileExists(path.join(rootDir, "tavo.config.ts"));
}

export function findLine(source: string, pattern: RegExp | string): number | undefined {
  const lines = source.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (typeof pattern === "string" ? lines[index].includes(pattern) : pattern.test(lines[index])) {
      return index + 1;
    }
  }
  return undefined;
}

export function enrichDiagnostic(diagnostic: ProjectDiagnostic): ProjectDiagnostic {
  const categoryByCode: Record<string, ProjectDiagnostic["category"]> = {
    "missing-package-json": "project-shape",
    "missing-pages-dir": "project-shape",
    "missing-css-entry": "project-shape",
    "missing-bootstrap": "project-shape",
    "invalid-route-segment": "routing",
    "csr-static-options": "routing",
    "missing-page-load-context-import": "agent-convention",
    "browser-api-in-loader": "server-boundary",
    "react-api-in-tavo-component": "agent-convention",
    "route-pattern-mismatch": "routing",
    "stale-route-artifacts": "routing",
    "invalid-route-manifest": "routing",
    "incompatible-route-manifest": "routing",
    "typecheck-skipped": "typecheck",
    "typecheck-failed": "typecheck",
    "route-parse-error": "runtime-smoke",
    "route-missing-default-export": "runtime-smoke",
    "route-top-level-throw": "runtime-smoke"
  };
  return {
    category: categoryByCode[diagnostic.code] ?? "project-shape",
    confidence: diagnostic.confidence ?? "high",
    safeToAutoFix: diagnostic.fix?.risk === "low",
    ...diagnostic
  };
}

export function sourceRangeFromLine(line?: number): SourceRange | undefined {
  return line ? { startLine: line, startColumn: 1, endLine: line, endColumn: 1 } : undefined;
}

function routeParamsFromPath(pathname: string): Array<{ name: string; optional: boolean; catchAll: boolean }> {
  const params: Array<{ name: string; optional: boolean; catchAll: boolean }> = [];
  for (const segment of pathname.split("/").filter(Boolean)) {
    if (segment === "*") {
      params.push({ name: "all", optional: false, catchAll: true });
    } else if (segment.startsWith("*?")) {
      params.push({ name: segment.slice(2), optional: true, catchAll: true });
    } else if (segment.startsWith(":?")) {
      params.push({ name: segment.slice(2), optional: true, catchAll: false });
    } else if (segment.startsWith(":")) {
      params.push({ name: segment.slice(1), optional: false, catchAll: false });
    }
  }
  return params;
}

export async function listPageFiles(rootDir: string, pagesDir: string): Promise<string[]> {
  const { readFilesRecursive } = await import("../utils/fs.mjs");
  const pagesRoot = path.join(rootDir, pagesDir);
  if (!(await fileExists(pagesRoot))) {
    return [];
  }
  return await readFilesRecursive(pagesRoot);
}

export function hasInvalidRouteSegment(segment: string): boolean {
  if (!segment.includes("[") && !segment.includes("]")) {
    return false;
  }
  return !(
    /^\[(.+)\]$/.test(segment) ||
    /^\[\[(.+)\]\]$/.test(segment) ||
    /^\[\.\.\.(.+)\]$/.test(segment) ||
    /^\[\[\.\.\.(.+)\]\]$/.test(segment)
  );
}

export function routePatternFromPageRelative(relative: string): string {
  const segments = relative.replace(/\.[^.]+$/, "").split("/").filter(Boolean);
  const leaf = segments.pop() ?? "index";
  const routeSegments = [...segments];
  if (leaf !== "index") {
    routeSegments.push(leaf);
  }
  const visible = routeSegments.filter((segment) => !/^\((.+)\)$/.test(segment));
  return visible.length === 0 ? "/" : `/${visible.join("/")}`;
}

export function inspectRouteFiles(
  rootDir: string,
  routes: Array<{ path: string; file: string; files: string[] }>
): RouteInspection[] {
  return routes.map((route) => ({
    path: route.path,
    file: toPosixPath(path.relative(rootDir, route.file)),
    files: route.files.map((file) => toPosixPath(path.relative(rootDir, file))),
    params: routeParamsFromPath(route.path),
    layouts: route.files.slice(0, -1).map((file) => toPosixPath(path.relative(rootDir, file)))
  }));
}
