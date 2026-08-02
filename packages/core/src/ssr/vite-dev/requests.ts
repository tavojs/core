import type { ViteDevServerLike } from "../types.js";
import { toPosixPath } from "../runtime.js";
import { isStyleModulePath } from "./style.js";

export function isLikelyAssetRequest(pathname: string): boolean {
  if (pathname === "/_tavo/image") {
    return false;
  }
  if (pathname.startsWith("/@vite") || pathname.startsWith("/@fs/")) {
    return true;
  }
  return /\.[A-Za-z0-9]+$/.test(pathname) && pathname !== "/";
}

function isViteSourceRequest(pathname: string): boolean {
  return (
    pathname.startsWith("/src/") ||
    pathname.startsWith("/node_modules/") ||
    pathname.startsWith("/@id/") ||
    pathname.startsWith("/@react-refresh")
  );
}

function contentTypeForViteSource(pathname: string): string {
  if (pathname.endsWith(".css") || pathname.endsWith(".scss") || pathname.endsWith(".sass")) {
    return "text/css; charset=utf-8";
  }
  if (pathname.endsWith(".json")) {
    return "application/json; charset=utf-8";
  }
  return "text/javascript; charset=utf-8";
}

export async function tryServeViteSourceRequest(
  vite: ViteDevServerLike,
  pathnameWithSearch: string
): Promise<null | { code: string; contentType: string }> {
  const pathname = pathnameWithSearch.split("?")[0] ?? pathnameWithSearch;
  if (!isViteSourceRequest(pathname)) {
    return null;
  }
  const transformed = await vite.transformRequest(pathnameWithSearch);
  if (!transformed?.code) {
    return null;
  }
  return {
    code: transformed.code,
    contentType: contentTypeForViteSource(pathname)
  };
}

export function shouldInvalidateDevCache(
  event: string,
  file: string | undefined,
  rootDir: string,
): boolean {
  if (event !== "add" && event !== "change" && event !== "unlink") {
    return false;
  }
  if (!file) {
    return false;
  }

  const normalizedFile = toPosixPath(file);
  const relativeFile = toPosixPath(nodePathRelative(rootDir, normalizedFile));
  if (relativeFile.startsWith("src/pages/")) {
    return true;
  }
  if (
    relativeFile.startsWith("src/") &&
    (/\.[cm]?[jt]sx?$/.test(relativeFile) || isStyleModulePath(relativeFile))
  ) {
    return true;
  }
  if (relativeFile === "src/styles.css" || relativeFile === "src/styles.scss") {
    return true;
  }
  return relativeFile === "tavo.config.ts";
}

function nodePathRelative(rootDir: string, file: string): string {
  if (!file.startsWith(rootDir)) {
    return file;
  }
  return file.slice(rootDir.length).replace(/^\/+/, "");
}
