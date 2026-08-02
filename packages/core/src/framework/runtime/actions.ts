import {
  responseHeadersToFetch,
  type ResponseHeaders,
} from "../../ssr/headers.js";
import { normalizeRedirectTarget, withDefaultSecurityHeaders } from "../../security.js";
import type { ActionContentType, ActionResult, PageRuntimeOptions } from "../types.js";

export function isUnsafeActionMethod(method: string): boolean {
  const normalized = method.toUpperCase();
  return (
    normalized !== "GET" && normalized !== "HEAD" && normalized !== "OPTIONS"
  );
}

function getActionHostname(host: string): string {
  try {
    return new URL(`http://${host}`).hostname.toLowerCase();
  } catch {
    return host.toLowerCase();
  }
}

function isLocalActionHost(host: string): boolean {
  const normalized = host.toLowerCase();
  const hostname = getActionHostname(host);
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "[::1]" ||
    normalized === "::1" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]" ||
    hostname === "::1"
  );
}

function isTrustedActionHost(
  host: string,
  trustedHosts: string[] | undefined,
): boolean {
  const normalized = host.toLowerCase();
  const hostname = getActionHostname(host);
  if (isLocalActionHost(normalized)) {
    return true;
  }
  return (trustedHosts ?? []).some((trustedHost) => {
    const trusted = trustedHost.toLowerCase();
    return trusted === normalized || trusted === hostname;
  });
}

function isNodeLikeRawRequest(rawRequest: unknown, request: Request): boolean {
  return Boolean(
    rawRequest && typeof rawRequest === "object" && rawRequest !== request,
  );
}

export function validateActionOrigin(
  request: Request,
  options?: { trustedHosts?: string[]; rawRequest?: unknown },
): boolean {
  const origin = request.headers.get("origin");

  try {
    const requestUrl = new URL(request.url);
    if (
      isNodeLikeRawRequest(options?.rawRequest, request) &&
      !isTrustedActionHost(requestUrl.host, options?.trustedHosts)
    ) {
      return false;
    }
    if (!origin) {
      return true;
    }
    return new URL(origin).origin === requestUrl.origin;
  } catch {
    return false;
  }
}

export function forbiddenActionResponse(): Response {
  return new Response("Forbidden", {
    status: 403,
    headers: withDefaultSecurityHeaders({
      "Content-Type": "text/plain; charset=utf-8",
    }),
  });
}

function normalizeRequestContentType(request: Request): string {
  return (request.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase();
}

export function matchesActionContentType(request: Request, contentType: ActionContentType): boolean {
  const requestContentType = normalizeRequestContentType(request);
  if (contentType === "json") {
    return requestContentType === "application/json" || requestContentType.endsWith("+json");
  }
  return requestContentType === "multipart/form-data" || requestContentType === "application/x-www-form-urlencoded";
}

export function unsupportedActionContentTypeResponse(contentType: ActionContentType): Response {
  return new Response(`Unsupported Media Type. Expected ${contentType}.`, {
    status: 415,
    headers: withDefaultSecurityHeaders({
      "Content-Type": "text/plain; charset=utf-8",
    }),
  });
}

function actionHeadersToFetch(
  headers: HeadersInit | ResponseHeaders | undefined,
): Headers {
  if (!headers) {
    return new Headers();
  }
  if (headers instanceof Headers) {
    return new Headers(headers);
  }
  if (Array.isArray(headers)) {
    return new Headers(headers);
  }
  return responseHeadersToFetch(headers as ResponseHeaders);
}

function isResponse(value: unknown): value is Response {
  return typeof Response !== "undefined" && value instanceof Response;
}

function withDefaultActionHeaders(headers: Headers): Headers {
  const defaults = withDefaultSecurityHeaders();
  for (const [key, value] of Object.entries(defaults)) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }
  return headers;
}

export function withDefaultActionSecurityHeaders(response: Response): Response {
  const headers = withDefaultActionHeaders(new Headers(response.headers));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function actionResultToResponse(
  result: Response | ActionResult | void,
  options?: PageRuntimeOptions,
): Response {
  if (isResponse(result)) {
    return withDefaultActionSecurityHeaders(result);
  }
  if (!result) {
    return new Response(null, { status: 204, headers: withDefaultSecurityHeaders() });
  }

  const headers = actionHeadersToFetch(result.headers);
  if (result.redirect) {
    const redirect = normalizeRedirectTarget(result.redirect, {
      allowExternal: options?.allowExternalRedirects,
    });
    headers.set("Location", redirect);
    return new Response(result.body ?? null, {
      status: result.status ?? 303,
      headers: withDefaultActionHeaders(headers),
    });
  }

  if (result.json !== undefined) {
    if (!headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json; charset=utf-8");
    }
    return new Response(JSON.stringify(result.json), {
      status: result.status ?? 200,
      headers: withDefaultActionHeaders(headers),
    });
  }

  return new Response(result.body ?? null, {
    status: result.status ?? (result.body === undefined ? 204 : 200),
    headers: withDefaultActionHeaders(headers),
  });
}
