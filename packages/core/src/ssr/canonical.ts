import type { PagesRuntime } from "../framework/index.js";
import { withDefaultSecurityHeaders } from "../security.js";

export function canonicalPageRedirect(runtime: PagesRuntime, url: URL): Response | null {
  if (!runtime.resolvePath(url.pathname).route) return null;
  const requested = `${url.pathname}${url.search}${url.hash}`;
  const canonical = runtime.router.canonicalize(requested);
  if (canonical === requested) return null;
  return new Response(null, {
    status: 308,
    headers: withDefaultSecurityHeaders({ Location: canonical }),
  });
}

export function canonicalizeActionRedirect(
  response: Response,
  runtime: PagesRuntime,
  requestUrl: URL,
): Response {
  const location = response.headers.get("Location");
  if (!location) return response;
  let target: URL;
  try {
    target = new URL(location, requestUrl);
  } catch {
    return response;
  }
  if (target.origin !== requestUrl.origin || !runtime.resolvePath(target.pathname).route) return response;
  const canonical = runtime.router.canonicalize(`${target.pathname}${target.search}${target.hash}`);
  const current = `${target.pathname}${target.search}${target.hash}`;
  if (canonical === current) return response;
  const headers = new Headers(response.headers);
  headers.set("Location", canonical);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}
