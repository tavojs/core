export type ResponseHeaderValue = string | string[];
export type ResponseHeaders = Record<string, ResponseHeaderValue>;

function getHeaderValue(headers: ResponseHeaders | undefined, name: string): ResponseHeaderValue | undefined {
  if (!headers) {
    return undefined;
  }
  const normalized = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === normalized) {
      return value;
    }
  }
  return undefined;
}

/** Appends a response header value while preserving repeated Set-Cookie headers. */
export function appendResponseHeader(
  headers: ResponseHeaders,
  name: string,
  value: string
): ResponseHeaders {
  const existingKey = Object.keys(headers).find((key) => key.toLowerCase() === name.toLowerCase());
  if (!existingKey) {
    headers[name] = value;
    return headers;
  }
  const existing = headers[existingKey];
  headers[existingKey] = Array.isArray(existing) ? [...existing, value] : [existing, value];
  return headers;
}

/** Converts framework response headers into Fetch Headers without folding Set-Cookie. */
export function responseHeadersToFetch(headers: ResponseHeaders | undefined): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (Array.isArray(value)) {
      for (const part of value) {
        out.append(key, part);
      }
    } else {
      out.append(key, value);
    }
  }
  return out;
}

/** Converts Fetch Headers into the framework header shape, preserving getSetCookie when available. */
export function responseHeadersFromFetch(headers: Headers): ResponseHeaders {
  const out: ResponseHeaders = {};
  headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") {
      return;
    }
    out[key] = value;
  });

  const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof getSetCookie === "function") {
    const cookies = getSetCookie.call(headers);
    if (cookies.length > 0) {
      out["Set-Cookie"] = cookies;
    }
  } else {
    const setCookie = headers.get("set-cookie");
    if (setCookie) {
      out["Set-Cookie"] = setCookie;
    }
  }

  return out;
}

/** Normalizes framework headers for Node's writeHead API. */
export function responseHeadersToNode(headers: ResponseHeaders | undefined): Record<string, string | string[]> {
  return { ...(headers ?? {}) };
}

/** Adds default hardening headers without folding repeated response cookies. */
export function withDefaultFetchSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [key, value] of Object.entries(withDefaultSecurityHeaders())) {
    if (!headers.has(key)) {
      headers.set(key, value);
    }
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function getResponseHeader(headers: ResponseHeaders | undefined, name: string): string | undefined {
  const value = getHeaderValue(headers, name);
  return Array.isArray(value) ? value.join(", ") : value;
}

export function getSetCookieHeaders(headers: ResponseHeaders | Headers | undefined): string[] {
  if (!headers) {
    return [];
  }
  if (headers instanceof Headers) {
    const getSetCookie = (headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
    if (typeof getSetCookie === "function") {
      return getSetCookie.call(headers);
    }
    const value = headers.get("set-cookie");
    return value ? [value] : [];
  }
  const value = getHeaderValue(headers, "set-cookie");
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}
import { withDefaultSecurityHeaders } from "../security.js";
