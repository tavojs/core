import fs from "node:fs/promises";
import path from "node:path";
import { ARTIFACT_SCHEMA_VERSION, GENERATED_DIR, PAGE_FILE_EXT } from "../constants.mjs";
import { fileExists, readFilesRecursive } from "../utils/fs.mjs";
import { normalizeModuleId, normalizePathname, toPosixPath } from "../utils/path.mjs";

export type PageRoute = {
  file: string;
  files: string[];
  path: string;
};

export type ParsedPageFile = {
  dirParts: string[];
  fileStem: string;
};

export function parsePageFile(file: string): ParsedPageFile {
  const normalized = normalizeModuleId(file);
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

export function toRouteSegment(segment: string): string | null {
  if (/^\((.+)\)$/.test(segment)) {
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

export function toRoutePath(parts: string[], fileStem: string): string {
  const allParts = [...parts];
  if (fileStem !== "index") {
    allParts.push(fileStem);
  }
  const routeSegments = allParts.map(toRouteSegment).filter(Boolean);
  return routeSegments.length === 0 ? "/" : `/${routeSegments.join("/")}`;
}

export function parentDirKeys(parts: string[]): string[] {
  const out: string[] = [""];
  for (let index = 1; index <= parts.length; index += 1) {
    out.push(parts.slice(0, index).join("/"));
  }
  return out;
}

function compareRouteSpecificity(left: string, right: string): number {
  const leftSegments = normalizePathname(left).split("/").filter(Boolean);
  const rightSegments = normalizePathname(right).split("/").filter(Boolean);
  const rank = (segment: string): number => {
    if (segment.startsWith("*?")) return 0;
    if (segment.startsWith("*")) return 1;
    if (segment.startsWith(":?")) return 2;
    if (segment.startsWith(":")) return 3;
    return 4;
  };
  const commonLength = Math.min(leftSegments.length, rightSegments.length);
  for (let index = 0; index < commonLength; index += 1) {
    const difference = rank(rightSegments[index]) - rank(leftSegments[index]);
    if (difference !== 0) return difference;
  }
  return leftSegments.length - rightSegments.length;
}

export async function collectPageRoutes(rootDir: string, pagesDir: string): Promise<PageRoute[]> {
  const pagesRoot = path.join(rootDir, pagesDir);
  if (!(await fileExists(pagesRoot))) {
    return [];
  }

  const files = await readFilesRecursive(pagesRoot);
  const layouts = new Map<string, string>();
  for (const file of files) {
    const parsed = parsePageFile(file);
    const joinedDir = parsed.dirParts.join("/");
    if (parsed.fileStem === "_layout") {
      layouts.set(joinedDir, path.resolve(file));
    }
  }

  const routes: PageRoute[] = [];
  for (const file of files) {
    const parsed = parsePageFile(file);
    if (parsed.fileStem === "_layout" || parsed.fileStem === "_error" || parsed.fileStem === "404") {
      continue;
    }
    if (parsed.fileStem.startsWith("_")) {
      continue;
    }
    routes.push({
      file: path.resolve(file),
      files: [
        ...parentDirKeys(parsed.dirParts)
          .map((key) => layouts.get(key))
          .filter((file): file is string => Boolean(file)),
        path.resolve(file)
      ],
      path: toRoutePath(parsed.dirParts, parsed.fileStem)
    });
  }

  routes.sort((left, right) => {
    const specificity = compareRouteSpecificity(left.path, right.path);
    if (specificity !== 0) {
      return specificity;
    }
    return left.path.localeCompare(right.path);
  });

  return routes;
}

export function paramsTypeFromRoutePath(pathname: string): string {
  const segments = normalizePathname(pathname).split("/").filter(Boolean);
  const entries: Array<[string, string]> = [];

  for (const segment of segments) {
    if (segment.startsWith("*") && !segment.startsWith("*?")) {
      entries.push([segment.slice(1) || "all", "string"]);
      continue;
    }
    if (segment.startsWith("*?")) {
      entries.push([segment.slice(2), "string | undefined"]);
      continue;
    }
    if (segment.startsWith(":?")) {
      entries.push([segment.slice(2), "string | undefined"]);
      continue;
    }
    if (segment.startsWith(":")) {
      entries.push([segment.slice(1), "string"]);
    }
  }

  if (entries.length === 0) {
    return "Record<never, never>";
  }

  return `{ ${entries.map(([key, type]) => `${JSON.stringify(key)}: ${type}`).join("; ")} }`;
}

export async function generateRouteArtifacts(rootDir: string, routes: PageRoute[]): Promise<void> {
  const generatedRoot = path.join(rootDir, GENERATED_DIR);
  await fs.mkdir(generatedRoot, { recursive: true });

  const manifest = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    routes: routes.map((route) => ({
      path: route.path,
      file: toPosixPath(path.relative(rootDir, route.file)),
      files: route.files.map((file) => toPosixPath(path.relative(rootDir, file)))
    }))
  };

  await fs.writeFile(path.join(generatedRoot, "route-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const union = routes.length > 0 ? routes.map((route) => JSON.stringify(route.path)).join(" | ") : "never";
  const typeMap = routes
    .map((route) => `  ${JSON.stringify(route.path)}: ${paramsTypeFromRoutePath(route.path)};`)
    .join("\n");
  const fileMap = routes
    .map((route) => `  ${JSON.stringify(route.path)}: ${JSON.stringify(toPosixPath(path.relative(rootDir, route.file)))};`)
    .join("\n");
  const moduleImports = routes
    .map((route, index) => {
      const relativeImport = toPosixPath(path.relative(generatedRoot, route.file)).replace(/\.[^.]+$/, "");
      return `import type * as RouteModule${index} from ${JSON.stringify(relativeImport.startsWith(".") ? relativeImport : `./${relativeImport}`)};`;
    })
    .join("\n");
  const moduleMap = routes
    .map((route, index) => `  ${JSON.stringify(route.path)}: typeof RouteModule${index};`)
    .join("\n");

  await fs.writeFile(
    path.join(generatedRoot, "routes.d.ts"),
    [
      'import type { Component } from "@tavojs/core";',
      'import type { PageLoadContext, PageProps, PageStaticParams } from "@tavojs/core/router";',
      moduleImports,
      moduleImports ? "" : "",
      `export declare const TAVO_ROUTE_ARTIFACT_SCHEMA_VERSION: ${ARTIFACT_SCHEMA_VERSION};`,
      "",
      "export type AppRoutePath = " + union + ";",
      "",
      "export interface AppRouteParams {",
      typeMap || "  [route: string]: Record<never, never>;",
      "}",
      "",
      "export interface AppRouteModules {",
      moduleMap || "  [route: string]: unknown;",
      "}",
      "",
      "export interface AppRouteFiles {",
      fileMap || "  [route: string]: string;",
      "}",
      "",
      "export type RouteParamsFor<TPath extends AppRoutePath> = AppRouteParams[TPath];",
      "export type RouteModuleFor<TPath extends AppRoutePath> = AppRouteModules[TPath];",
      "export type RouteFileFor<TPath extends AppRoutePath> = AppRouteFiles[TPath];",
      "",
      "export type RouteLoaderContextFor<TPath extends AppRoutePath> = Omit<PageLoadContext, \"params\"> & {",
      "  params: RouteParamsFor<TPath>;",
      "};",
      "export type RouteLoaderDataFor<TPath extends AppRoutePath> =",
      "  RouteModuleFor<TPath> extends { load: (...args: any[]) => infer TResult }",
      "    ? Awaited<TResult>",
      "    : never;",
      "",
      "export type RouteHeadFor<TPath extends AppRoutePath> =",
      "  RouteModuleFor<TPath> extends { head: infer THead } ? THead : never;",
      "",
      "export type RouteMiddlewareFor<TPath extends AppRoutePath> =",
      "  RouteModuleFor<TPath> extends { middleware: infer TMiddleware } ? TMiddleware : never;",
      "export type RouteStaticParamsFor<TPath extends AppRoutePath> = PageStaticParams & Array<RouteParamsFor<TPath>>;",
      "",
      "export type RouteComponentFor<TPath extends AppRoutePath> =",
      "  RouteModuleFor<TPath> extends { default: infer TComponent } ? TComponent : never;",
      "",
      "export type RoutePagePropsFor<TPath extends AppRoutePath> = PageProps<",
      "  RouteLoaderDataFor<TPath>,",
      "  RouteParamsFor<TPath>",
      ">;",
      "",
      "export type RouteComponentPropsFor<TPath extends AppRoutePath> =",
      "  RouteComponentFor<TPath> extends Component<infer TProps> ? TProps : RoutePagePropsFor<TPath>;",
      "",
      "export interface AppRouteLoaderData {",
      ...routes.map((route) => `  ${JSON.stringify(route.path)}: RouteLoaderDataFor<${JSON.stringify(route.path)}>;`),
      "}",
      "",
      "export interface AppRouteComponentProps {",
      ...routes.map((route) => `  ${JSON.stringify(route.path)}: RouteComponentPropsFor<${JSON.stringify(route.path)}>;`),
      "}",
      "",
      "export interface AppRouteHeads {",
      ...routes.map((route) => `  ${JSON.stringify(route.path)}: RouteHeadFor<${JSON.stringify(route.path)}>;`),
      "}",
      "",
      "export interface AppRouteComponents {",
      ...routes.map((route) => `  ${JSON.stringify(route.path)}: RouteComponentFor<${JSON.stringify(route.path)}>;`),
      "}",
      ""
    ].join("\n"),
    "utf8"
  );
}
