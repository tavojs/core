import { readRequestHeader } from "../../ssr/request.js";

function getCacheVaryHeaders(vary: string[] = []): string[] {
  return Array.from(new Set(vary.map((header) => header.toLowerCase())));
}

export function createRequestCacheKey(pathname: string, request: unknown, vary: string[] = []): string {
  const varyValues = getCacheVaryHeaders(vary).map((header) => [
    header,
    readRequestHeader(request, header) ?? ""
  ]);
  let origin = "";
  let search = "";
  try {
    const requestWithUrl =
      request && typeof request === "object" && (request as { request?: unknown }).request
        ? (request as { request: unknown }).request
        : request;
    const rawUrl =
      requestWithUrl &&
      typeof requestWithUrl === "object" &&
      typeof (requestWithUrl as { url?: unknown }).url === "string"
        ? (requestWithUrl as { url: string }).url
        : pathname;
    const host = readRequestHeader(request, "host") ?? "localhost";
    const url = new URL(rawUrl, `http://${host}`);
    origin = url.origin;
    search = url.search;
  } catch {
    // Keep malformed request metadata isolated from valid origins.
    origin = "invalid-origin";
  }
  // Structured serialization prevents attacker-controlled header delimiters from
  // aliasing another cache variant. Origin isolation prevents multi-host leakage.
  return JSON.stringify([origin, `${pathname}${search}`, varyValues]);
}
