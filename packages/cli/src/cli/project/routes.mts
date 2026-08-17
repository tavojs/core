import fs from "node:fs/promises";
import path from "node:path";
import { canonicalizeTrailingSlash } from "@tavojs/core/router";
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

function routePatternMatches(pattern: string, pathname: string): boolean {
  const route = normalizePathname(pattern).split("/").filter(Boolean);
  const pathParts = normalizePathname(pathname).split("/").filter(Boolean);
  const visit = (routeIndex: number, pathIndex: number): boolean => {
    if (routeIndex === route.length) return pathIndex === pathParts.length;
    const segment = route[routeIndex]!;
    if (segment.startsWith("*?")) {
      for (let end = pathParts.length; end >= pathIndex; end -= 1) if (visit(routeIndex + 1, end)) return true;
      return false;
    }
    if (segment.startsWith("*")) {
      for (let end = pathParts.length; end > pathIndex; end -= 1) if (visit(routeIndex + 1, end)) return true;
      return false;
    }
    if (segment.startsWith(":?")) return visit(routeIndex + 1, pathIndex + 1) || visit(routeIndex + 1, pathIndex);
    if (pathIndex >= pathParts.length) return false;
    return (segment.startsWith(":") || segment === pathParts[pathIndex]) && visit(routeIndex + 1, pathIndex + 1);
  };
  return visit(0, 0);
}

function trustedLinkReferences(source: string): Set<string> {
  const references = new Set<string>();
  const trustedPackage = /^@tavojs\/(?:core|ui)(?:\/.*)?$/;
  const namedImport = /\bimport\s*\{([\s\S]*?)\}\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(namedImport)) {
    if (!trustedPackage.test(match[2]!)) continue;
    for (const specifier of match[1]!.split(",")) {
      const parts = specifier.trim().match(/^Link(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (parts) references.add(parts[1] ?? "Link");
    }
  }
  const namespaceImport = /\bimport\s*\*\s*as\s*([A-Za-z_$][\w$]*)\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(namespaceImport)) {
    if (trustedPackage.test(match[2]!)) references.add(`${match[1]}.Link`);
  }
  return references;
}

function isRouterCanonicalizedElement(
  tag: string,
  attributes: string,
  trustedLinks: Set<string>,
): boolean {
  if (trustedLinks.has(tag)) return true;
  const polymorphic = attributes.match(/\bas\s*=\s*\{\s*([A-Za-z_$][\w$]*(?:\.Link)?)\s*\}/);
  return Boolean(polymorphic && trustedLinks.has(polymorphic[1]!));
}

/** Finds literal links that will reach an anchor without router URL canonicalization. */
export async function collectTrailingSlashLinkDiagnostics(
  rootDir: string,
  routes: PageRoute[],
  policy: "always" | "never" | "preserve",
): Promise<string[]> {
  if (policy === "preserve") return [];
  const sourceRoot = path.join(rootDir, "src");
  if (!(await fileExists(sourceRoot))) return [];
  const files = (await readFilesRecursive(sourceRoot)).filter((file) => /\.[cm]?[jt]sx?$/.test(file));
  const diagnostics: string[] = [];
  for (const file of files) {
    const source = await fs.readFile(file, "utf8");
    const trustedLinks = trustedLinkReferences(source);
    const elementPattern = /<([A-Za-z_$][\w$:.-]*)(\s[\s\S]*?)?\/?\s*>/g;
    for (const element of source.matchAll(elementPattern)) {
      const tag = element[1]!;
      const attributes = element[2] ?? "";
      if (isRouterCanonicalizedElement(tag, attributes, trustedLinks)) continue;
      const linkPattern = /\b(?:href|to|action)\s*=\s*["'](\/[^"']*)["']/g;
      for (const match of attributes.matchAll(linkPattern)) {
        const value = match[1]!;
        const pathname = value.split(/[?#]/, 1)[0] || "/";
        if (pathname === "/" || !routes.some((route) => routePatternMatches(route.path, pathname))) continue;
        const canonical = canonicalizeTrailingSlash(value, policy);
        if (canonical === value) continue;
        const attributeOffset = element[0].indexOf(attributes);
        const absoluteIndex = (element.index ?? 0) + attributeOffset + (match.index ?? 0);
        const line = source.slice(0, absoluteIndex).split("\n").length;
        diagnostics.push(
          `${toPosixPath(path.relative(rootDir, file))}:${line} internal route link ${JSON.stringify(value)} `
          + `does not match routing.trailingSlash=${JSON.stringify(policy)}; use ${JSON.stringify(canonical)}.`,
        );
      }
    }
  }
  return diagnostics;
}

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

export async function generateRouteArtifacts(
  rootDir: string,
  routes: PageRoute[],
  trailingSlash: "always" | "never" | "preserve" = "preserve",
): Promise<void> {
  const generatedRoot = path.join(rootDir, GENERATED_DIR);
  await fs.mkdir(generatedRoot, { recursive: true });

  const manifest = {
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    routing: { trailingSlash },
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
