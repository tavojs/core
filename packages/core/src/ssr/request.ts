export type NormalizedPageRequest = {
  request: Request;
  rawRequest?: unknown;
  url: URL;
  headers: Headers;
  method: string;
};

export type NodeRequestLike = {
  url?: string;
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
  on?: unknown;
  once?: (event: string, listener: () => void) => unknown;
  off?: (event: string, listener: () => void) => unknown;
  [Symbol.asyncIterator]?: unknown;
};

export class RequestBodyTooLargeError extends Error {
  constructor(limit: number) {
    super(`tavo ssr: request body exceeded the configured ${limit} byte limit.`);
    this.name = "RequestBodyTooLargeError";
  }
}

function parseContentLength(value: string | undefined): number | null {
  if (!value) {
    return null;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function readRequestHeader(request: unknown, name: string): string | undefined {
  if (!request || typeof request !== "object") {
    return undefined;
  }
  const wrappedRequest = (request as { request?: unknown }).request;
  if (wrappedRequest && wrappedRequest !== request) {
    return readRequestHeader(wrappedRequest, name);
  }
  const headers = (request as { headers?: unknown }).headers;
  if (!headers) {
    return undefined;
  }
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  if (typeof (headers as { get?: unknown }).get === "function") {
    const value = (headers as { get(name: string): unknown }).get(name);
    return typeof value === "string" ? value : undefined;
  }
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (key.toLowerCase() !== lowerName) {
      continue;
    }
    return Array.isArray(value) ? value.join(",") : value;
  }
  return undefined;
}

export function hasPersonalRequestHeaders(request: unknown): boolean {
  return Boolean(readRequestHeader(request, "cookie") || readRequestHeader(request, "authorization"));
}

export function headersFromRequestLike(request: unknown): Headers {
  if (!request || typeof request !== "object") {
    return new Headers();
  }
  const headers = (request as { headers?: unknown }).headers;
  if (headers instanceof Headers) {
    return new Headers(headers);
  }
  const out = new Headers();
  if (!headers || typeof headers !== "object") {
    return out;
  }
  if (typeof (headers as { forEach?: unknown }).forEach === "function") {
    (headers as { forEach(callback: (value: string, key: string) => void): void }).forEach((value, key) => {
      out.set(key, value);
    });
    return out;
  }
  for (const [key, value] of Object.entries(headers as Record<string, string | string[] | undefined>)) {
    if (value === undefined) {
      continue;
    }
    out.set(key, Array.isArray(value) ? value.join(",") : value);
  }
  return out;
}

export function normalizePageRequest(pathname: string, rawRequest: unknown): NormalizedPageRequest {
  const wrappedRequest = (rawRequest as { request?: unknown; rawRequest?: unknown } | undefined)?.request;
  if (typeof Request !== "undefined" && wrappedRequest instanceof Request) {
    const url = new URL(wrappedRequest.url, "http://localhost");
    return {
      request: wrappedRequest,
      rawRequest: (rawRequest as { rawRequest?: unknown }).rawRequest ?? rawRequest,
      url,
      headers: wrappedRequest.headers,
      method: wrappedRequest.method
    };
  }

  if (typeof Request !== "undefined" && rawRequest instanceof Request) {
    const url = new URL(rawRequest.url, "http://localhost");
    return {
      request: rawRequest,
      rawRequest,
      url,
      headers: rawRequest.headers,
      method: rawRequest.method
    };
  }

  const headers = headersFromRequestLike(rawRequest);
  const method =
    typeof rawRequest === "object" && rawRequest !== null && typeof (rawRequest as { method?: unknown }).method === "string"
      ? (rawRequest as { method: string }).method
      : "GET";
  const rawUrl =
    typeof rawRequest === "object" && rawRequest !== null && typeof (rawRequest as { url?: unknown }).url === "string"
      ? (rawRequest as { url: string }).url
      : pathname;
  const host = headers.get("host") ?? "localhost";
  const isAbsoluteUrl = rawUrl.startsWith("http://") || rawUrl.startsWith("https://");
  const url = isAbsoluteUrl
    ? new URL(rawUrl)
    : new URL(rawUrl || pathname, `http://${host}`);
  const request = new Request(url, { method, headers });
  return {
    request,
    rawRequest,
    url,
    headers: request.headers,
    method: request.method
  };
}

async function readNodeRequestBody(
  req: NodeRequestLike,
  maxBytes: number
): Promise<Uint8Array | undefined> {
  const method = (req.method ?? "GET").toUpperCase();
  if (method === "GET" || method === "HEAD") {
    return undefined;
  }
  const contentLength = parseContentLength(readRequestHeader(req, "content-length"));
  if (contentLength !== null && contentLength > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes);
  }
  if (typeof req[Symbol.asyncIterator] !== "function") {
    return undefined;
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Uint8Array | string>) {
    const bytes = typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
    total += bytes.byteLength;
    if (total > maxBytes) {
      throw new RequestBodyTooLargeError(maxBytes);
    }
    chunks.push(bytes);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

/** Builds a Fetch Request from a Node/Vite incoming request, including mutation bodies. */
export async function createFetchRequestFromNodeRequest(
  req: NodeRequestLike,
  url: URL,
  options: { maxBodyBytes?: number; signal?: AbortSignal } = {}
): Promise<Request> {
  const method = req.method ?? "GET";
  const headers = headersFromRequestLike(req);
  const body = await readNodeRequestBody(req, options.maxBodyBytes ?? 10 * 1024 * 1024);
  const bodyBuffer = body
    ? body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer
    : undefined;
  return new Request(url, {
    method,
    headers,
    body: bodyBuffer,
    signal: options.signal,
    ...(body ? { duplex: "half" } as RequestInit : {})
  });
}
