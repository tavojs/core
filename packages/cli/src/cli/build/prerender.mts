import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { canonicalizeTrailingSlash } from "@tavojs/core/router";
import { ARTIFACT_SCHEMA_VERSION } from "../constants.mjs";
import { toPosixPath } from "../utils/path.mjs";
import type { PageRoute } from "../project/routes.mjs";

type PrerenderedStaticPage = {
  pathname: string;
  html: string;
  status?: number;
};

type StaticPrerenderResult = {
  entries?: PrerenderedStaticPage[];
  diagnostics?: string[];
};

export type PrerenderStyleMode = "inline" | "external";

export type PrerenderStyleAsset = {
  file: string;
  css: string;
  styleIds: string[];
};

type PluginEndpoint = {
  methods: readonly string[];
  kind: "exact" | "subtree";
  path: string;
};

function pageRouteMatches(pattern: string, pathname: string): boolean {
  const route = pattern.split("/").filter(Boolean);
  const parts = pathname.split("/").filter(Boolean);
  const visit = (routeIndex: number, pathIndex: number): boolean => {
    if (routeIndex === route.length) return pathIndex === parts.length;
    const segment = route[routeIndex]!;
    if (segment.startsWith("*?")) {
      for (let end = parts.length; end >= pathIndex; end -= 1) if (visit(routeIndex + 1, end)) return true;
      return false;
    }
    if (segment.startsWith("*")) {
      for (let end = parts.length; end > pathIndex; end -= 1) if (visit(routeIndex + 1, end)) return true;
      return false;
    }
    if (segment.startsWith(":?")) return visit(routeIndex + 1, pathIndex + 1) || visit(routeIndex + 1, pathIndex);
    if (pathIndex >= parts.length) return false;
    return (segment.startsWith(":") || segment === parts[pathIndex]) && visit(routeIndex + 1, pathIndex + 1);
  };
  return visit(0, 0);
}

function endpointMatches(endpoint: PluginEndpoint, pathname: string): boolean {
  const endpointPath = endpoint.path === "/" ? "/" : endpoint.path.replace(/\/+$/, "");
  return endpoint.kind === "subtree"
    ? pathname === endpointPath || pathname.startsWith(`${endpointPath}/`)
    : pathname === endpointPath;
}

export function collectPrerenderedTrailingSlashLinkDiagnostics({
  html,
  pagePathname,
  routes,
  policy,
  endpoints = [],
  publicPathnames = new Set<string>(),
}: {
  html: string;
  pagePathname: string;
  routes: readonly Pick<PageRoute, "path">[];
  policy: "always" | "never" | "preserve";
  endpoints?: readonly PluginEndpoint[];
  publicPathnames?: ReadonlySet<string>;
}): string[] {
  if (policy === "preserve") return [];
  const diagnostics: string[] = [];
  const anchorPattern = /<a\b([^>]*)>/gi;
  for (const anchor of html.matchAll(anchorPattern)) {
    const attributes = anchor[1] ?? "";
    if (/\bdownload(?:\s*=|\s|$)/i.test(attributes)) continue;
    const hrefMatch = attributes.match(/\bhref\s*=\s*(["'])(.*?)\1/i);
    if (!hrefMatch) continue;
    const href = hrefMatch[2]!;
    if (!href.startsWith("/") || href.startsWith("//")) continue;
    const pathname = href.split(/[?#]/, 1)[0] || "/";
    if (
      pathname === "/" ||
      pathname === "/assets" ||
      pathname.startsWith("/assets/") ||
      publicPathnames.has(pathname) ||
      endpoints.some((endpoint) => endpointMatches(endpoint, pathname)) ||
      !routes.some((route) => pageRouteMatches(route.path, pathname))
    ) continue;
    const canonicalHref = canonicalizeTrailingSlash(href, policy);
    if (canonicalHref === href) continue;
    diagnostics.push(
      `Prerendered ${pagePathname} contains noncanonical internal page href ${JSON.stringify(href)}; `
      + `routing.trailingSlash=${JSON.stringify(policy)} requires ${JSON.stringify(canonicalHref)}.`,
    );
  }
  return diagnostics;
}

async function collectPublicPathnames(rootDir: string): Promise<Set<string>> {
  const publicDir = path.join(rootDir, "public");
  const pathnames = new Set<string>();
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(file);
      } else {
        pathnames.add(`/${toPosixPath(path.relative(publicDir, file))}`);
      }
    }
  };
  try {
    await visit(publicDir);
    return pathnames;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Set();
    throw error;
  }
}

export function externalizePrerenderedStyles(html: string): {
  html: string;
  asset?: PrerenderStyleAsset;
} {
  const stylePattern =
    /<style(?:\s+nonce="([^"]*)")?\s+data-tavo-style="([^"]+)"\s*>([\s\S]*?)<\/style>/gi;
  const matches = Array.from(html.matchAll(stylePattern)).filter(
    (match) => (match[3] ?? "").length > 0
  );
  if (matches.length === 0) {
    return { html };
  }

  const nonces = new Set(matches.map((match) => match[1] ?? ""));
  if (nonces.size > 1) {
    return { html };
  }

  const css = `${matches.map((match) => match[3] ?? "").join("\n")}\n`;
  const hash = createHash("sha256").update(css).digest("hex").slice(0, 16);
  const file = `assets/tavo-ssr-styles-${hash}.css`;
  const styleIds = matches.map((match) => match[2] ?? "");
  const extractedIds = new Set(styleIds);
  const nonce = matches[0]?.[1];
  const nonceAttribute = nonce === undefined ? "" : ` nonce="${nonce}"`;
  let linked = false;

  const transformed = html.replace(stylePattern, (
    tag,
    matchedNonce: string | undefined,
    id: string,
    styleCss: string
  ) => {
    if (!styleCss || !extractedIds.has(id) || (matchedNonce ?? "") !== (nonce ?? "")) {
      return tag;
    }
    const marker =
      `<style${matchedNonce === undefined ? "" : ` nonce="${matchedNonce}"`}` +
      ` data-tavo-style="${id}" data-tavo-style-external></style>`;
    if (linked) {
      return marker;
    }
    linked = true;
    return `<link rel="stylesheet" href="/${file}" data-tavo-style-bundle${nonceAttribute}>${marker}`;
  });

  return {
    html: transformed,
    asset: { file, css, styleIds }
  };
}

export async function readRouteBuildModes(buildRoot: string): Promise<Map<string, string>> {
  const entryFile = path.join(buildRoot, "server", "entry.mjs");
  const entryModule = (await import(pathToFileURL(entryFile).href)) as {
    getRouteBuildModes?: () => Promise<Array<{ path: string; mode: string }>>;
  };
  if (typeof entryModule.getRouteBuildModes !== "function") {
    return new Map();
  }
  return new Map((await entryModule.getRouteBuildModes()).map((entry) => [entry.path, entry.mode]));
}

function htmlOutputPathForPathname(clientDir: string, pathname: string): string | null {
  const segments = safeOutputPathSegments(pathname);
  if (!segments) {
    return null;
  }
  const relative = segments.length === 0 ? "index.html" : path.join(...segments, "index.html");
  const target = path.resolve(clientDir, relative);
  const insideClient = target === clientDir || target.startsWith(`${clientDir}${path.sep}`);
  return insideClient ? target : null;
}

export function safeOutputPathSegments(pathname: string): string[] | null {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const rawSegments = normalized.split("/").filter(Boolean);
  const segments: string[] = [];
  for (const segment of rawSegments) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(segment);
    } catch {
      return null;
    }
    if (
      decoded.length === 0 ||
      decoded === "." ||
      decoded === ".." ||
      decoded.includes("/") ||
      decoded.includes("\\")
    ) {
      return null;
    }
    segments.push(decoded);
  }
  return segments;
}

export async function writePrerenderedStaticPages({
  buildRoot,
  rootDir,
  styleMode = "inline",
  routes = [],
  trailingSlash = "preserve",
  endpoints = [],
}: {
  buildRoot: string;
  rootDir: string;
  styleMode?: PrerenderStyleMode;
  routes?: readonly PageRoute[];
  trailingSlash?: "always" | "never" | "preserve";
  endpoints?: readonly PluginEndpoint[];
}): Promise<{ count: number; diagnostics: string[] }> {
  const clientDir = path.join(buildRoot, "client");
  const entryFile = path.join(buildRoot, "server", "entry.mjs");
  const entryModule = (await import(pathToFileURL(entryFile).href)) as {
    prerenderStaticPages?: () => Promise<StaticPrerenderResult>;
  };

  if (typeof entryModule.prerenderStaticPages !== "function") {
    return { count: 0, diagnostics: ["SSR entry does not expose prerenderStaticPages()."] };
  }

  const result = await entryModule.prerenderStaticPages();
  const diagnostics = [...(result.diagnostics ?? [])];
  const publicPathnames = await collectPublicPathnames(rootDir);
  const written: Array<{ entry: PrerenderedStaticPage; target: string; styleAsset?: string }> = [];
  const targets = new Set<string>();
  const styleAssets = new Map<string, string>();

  for (const entry of result.entries ?? []) {
    const target = htmlOutputPathForPathname(clientDir, entry.pathname);
    if (!target) {
      diagnostics.push(`Skipped ${entry.pathname}: output path is outside the client build directory.`);
      continue;
    }
    if (targets.has(target)) {
      diagnostics.push(`Skipped ${entry.pathname}: another prerendered route already writes this output path.`);
      continue;
    }
    targets.add(target);
    const transformed = styleMode === "external"
      ? externalizePrerenderedStyles(entry.html)
      : { html: entry.html, asset: undefined };
    diagnostics.push(...collectPrerenderedTrailingSlashLinkDiagnostics({
      html: transformed.html,
      pagePathname: entry.pathname,
      routes,
      policy: trailingSlash,
      endpoints,
      publicPathnames,
    }));
    if (transformed.asset) {
      const existing = styleAssets.get(transformed.asset.file);
      if (existing !== undefined && existing !== transformed.asset.css) {
        throw new Error(`tavo build: conflicting prerender style asset ${transformed.asset.file}`);
      }
      styleAssets.set(transformed.asset.file, transformed.asset.css);
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, transformed.html, "utf8");
    written.push({ entry, target, styleAsset: transformed.asset?.file });
  }

  for (const [file, css] of styleAssets) {
    const target = path.join(clientDir, ...file.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, css, "utf8");
  }

  if (written.length > 0) {
    const prerenderManifest = {
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      routes: written.map(({ entry, target, styleAsset }) => ({
        path: entry.pathname,
        status: entry.status ?? 200,
        file: toPosixPath(path.relative(rootDir, target)),
        ...(styleAsset ? { styleAsset } : {})
      }))
    };
    await fs.writeFile(
      path.join(buildRoot, "prerender-manifest.json"),
      `${JSON.stringify(prerenderManifest, null, 2)}\n`,
      "utf8"
    );
  }

  return { count: written.length, diagnostics };
}
