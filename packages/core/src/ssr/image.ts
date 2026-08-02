import type { ImageFormat, ImageOptimizerOptions, RemoteImagePattern } from "./types.js";
import { withDefaultSecurityHeaders } from "../security.js";

type OptimizerResult = {
  body: Uint8Array;
  contentType: string;
  maxAgeSeconds: number;
};

type SharpFactory = import("sharp").SharpConstructor;

let sharpFactoryPromise: Promise<SharpFactory> | null = null;

type ImageWorkState = {
  active: number;
  cache: Map<string, OptimizerResult>;
  inflight: Map<string, Promise<OptimizerResult>>;
  queue: Array<() => void>;
};

const imageWorkByOptions = new WeakMap<object, ImageWorkState>();
const defaultImageWorkState: ImageWorkState = {
  active: 0,
  cache: new Map(),
  inflight: new Map(),
  queue: []
};

function getImageWorkState(options: ImageOptimizerOptions | undefined): ImageWorkState {
  if (!options) return defaultImageWorkState;
  const existing = imageWorkByOptions.get(options);
  if (existing) return existing;
  const created: ImageWorkState = { active: 0, cache: new Map(), inflight: new Map(), queue: [] };
  imageWorkByOptions.set(options, created);
  return created;
}

async function acquireImageTransform(
  state: ImageWorkState,
  options: Required<ImageOptimizerOptions>
): Promise<() => void> {
  if (state.active >= options.maxConcurrentTransforms) {
    if (state.queue.length >= options.maxPendingTransforms) {
      throw new Error("tavo image: optimizer is busy.");
    }
    await new Promise<void>((resolve) => state.queue.push(resolve));
  } else {
    state.active += 1;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const next = state.queue.shift();
    if (next) {
      next();
    } else {
      state.active = Math.max(0, state.active - 1);
    }
  };
}

function imageOptimizerHintForError(message: string, source?: string | null): string | null {
  let exampleHostname = "static.example.com";
  if (source) {
    try {
      exampleHostname = new URL(source).hostname || exampleHostname;
    } catch {
      exampleHostname = "static.example.com";
    }
  }

  if (message.includes("remote images are disabled") || message.includes("remote image host is not allowed")) {
    return [
      "Remote images rendered through Tavo Image must be allowed in your app config.",
      "Add a narrow allowlist to the root tavo.config.ts:",
      "export default defineConfig({",
      "  ssr: {",
      "    images: {",
      "      allowRemote: true,",
      `      remotePatterns: [{ protocol: "https:", hostname: "${exampleHostname}" }],`,
      "    },",
      "  },",
      "});",
      "Restart the SSR dev server after changing tavo.config.ts."
    ].join("\n");
  }

  if (message.includes("optional \"sharp\" dependency is required")) {
    return "Install sharp in the app that runs SSR: npm install sharp";
  }

  return null;
}

export function logImageOptimizerError(error: unknown, requestUrl?: URL): void {
  const message = error instanceof Error ? error.message : String(error);
  const source = requestUrl?.searchParams.get("src");
  const hint = imageOptimizerHintForError(message, source);
  const request = requestUrl ? `${requestUrl.pathname}${requestUrl.search}` : "/_tavo/image";
  const details = [
    `[tavo image] Failed to optimize ${request}`,
    source ? `Source: ${source}` : undefined,
    `Reason: ${message}`,
    hint ? `How to fix:\n${hint}` : undefined
  ].filter(Boolean).join("\n");

  console.error(details);
}

async function loadSharp(): Promise<SharpFactory> {
  sharpFactoryPromise ??= import("sharp").then((loadedModule) => loadedModule.default).catch((error) => {
    sharpFactoryPromise = null;
    throw new Error(
      `tavo image: the optional "sharp" dependency is required for server image optimization. Install it in your app to enable optimized images. ${error instanceof Error ? error.message : String(error)}`
    );
  });
  return sharpFactoryPromise;
}

function resolveImagesOptions(options?: ImageOptimizerOptions): Required<ImageOptimizerOptions> {
  return {
    enabled: options?.enabled ?? true,
    allowRemote: options?.allowRemote ?? false,
    remotePatterns: options?.remotePatterns ?? [],
    publicDir: options?.publicDir ?? "public",
    quality: options?.quality ?? 75,
    cacheMaxAge: options?.cacheMaxAge ?? 31536000,
    defaultFormat: options?.defaultFormat ?? "webp",
    sizes: options?.sizes ?? [320, 640, 960, 1280, 1600],
    timeoutMs: options?.timeoutMs ?? 5000,
    maxBytes: options?.maxBytes ?? 10 * 1024 * 1024,
    memoryCacheMaxEntries: Math.max(0, Math.floor(options?.memoryCacheMaxEntries ?? 128)),
    maxConcurrentTransforms: Math.max(1, Math.floor(options?.maxConcurrentTransforms ?? 4)),
    maxPendingTransforms: Math.max(0, Math.floor(options?.maxPendingTransforms ?? 64)),
    allowInsecureRemote: options?.allowInsecureRemote ?? false,
    resolveHostname: options?.resolveHostname ?? defaultResolveHostname
  };
}

async function defaultResolveHostname(hostname: string): Promise<Array<{ address: string }>> {
  const dns = await import("node:dns/promises");
  return dns.lookup(hostname, { all: true, verbatim: true });
}

function isRemoteSource(value: string): boolean {
  return value.startsWith("https://") || value.startsWith("http://");
}

function hostnameMatches(patternHostname: string, sourceHostname: string): boolean {
  const normalizedPattern = patternHostname.toLowerCase();
  const normalizedSource = sourceHostname.toLowerCase();
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(1);
    return normalizedSource.endsWith(suffix) && normalizedSource !== normalizedPattern.slice(2);
  }
  return normalizedSource === normalizedPattern;
}

function pathnameMatches(patternPathname: string | undefined, sourcePathname: string): boolean {
  if (!patternPathname || patternPathname === "/") {
    return true;
  }
  return sourcePathname === patternPathname || sourcePathname.startsWith(`${patternPathname.replace(/\/+$/, "")}/`);
}

function patternAllowsRemoteSource(pattern: string | RemoteImagePattern, sourceUrl: URL): boolean {
  if (typeof pattern === "string") {
    try {
      const patternUrl = new URL(pattern);
      return (
        sourceUrl.protocol === patternUrl.protocol &&
        hostnameMatches(patternUrl.hostname, sourceUrl.hostname) &&
        sourceUrl.port === patternUrl.port &&
        pathnameMatches(patternUrl.pathname, sourceUrl.pathname)
      );
    } catch {
      return hostnameMatches(pattern, sourceUrl.hostname) && sourceUrl.port === "";
    }
  }

  return (
    hostnameMatches(pattern.hostname, sourceUrl.hostname) &&
    (pattern.protocol === undefined || sourceUrl.protocol === pattern.protocol) &&
    sourceUrl.port === (pattern.port ?? "") &&
    pathnameMatches(pattern.pathname, sourceUrl.pathname)
  );
}

function isPrivateHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const mappedIpv4 = normalized.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/)?.[1];
  if (mappedIpv4) return isPrivateHostname(mappedIpv4);
  const mappedHex = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (mappedHex) {
    const high = Number.parseInt(mappedHex[1]!, 16);
    const low = Number.parseInt(mappedHex[2]!, 16);
    return isPrivateHostname(
      `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`
    );
  }
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized === "::1"
  ) {
    return true;
  }

  const ipv4 = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) {
    if (
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:")
    ) {
      return true;
    }
    return false;
  }

  const [, aRaw, bRaw, cRaw] = ipv4;
  const a = Number(aRaw);
  const b = Number(bRaw);
  const c = Number(cRaw);
  return (
    a === 10 ||
    a === 0 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && ((b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99) || b === 168)) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) ||
    a >= 224
  );
}

async function assertHostnameResolvesPublicly(
  hostname: string,
  resolveHostname: Required<ImageOptimizerOptions>["resolveHostname"]
): Promise<void> {
  const net = await import("node:net");
  if (net.isIP(hostname)) {
    if (isPrivateHostname(hostname)) {
      throw new Error("tavo image: private network image hosts are not allowed.");
    }
    return;
  }

  const records = await resolveHostname(hostname);
  if (records.length === 0 || records.some((record) => isPrivateHostname(record.address))) {
    throw new Error("tavo image: private network image hosts are not allowed.");
  }
}

function assertRemoteSourceAllowed(src: string, options: Required<ImageOptimizerOptions>): URL {
  const sourceUrl = new URL(src);
  if (isPrivateHostname(sourceUrl.hostname)) {
    throw new Error("tavo image: private network image hosts are not allowed.");
  }
  if (sourceUrl.protocol !== "https:" && !options.allowInsecureRemote) {
    throw new Error("tavo image: remote images must use https unless allowInsecureRemote is enabled.");
  }
  if (
    options.remotePatterns.length === 0 ||
    !options.remotePatterns.some((pattern) => patternAllowsRemoteSource(pattern, sourceUrl))
  ) {
    throw new Error("tavo image: remote image host is not allowed.");
  }
  return sourceUrl;
}

async function assertRemoteSourceAllowedForFetch(
  src: string,
  options: Required<ImageOptimizerOptions>
): Promise<URL> {
  const sourceUrl = assertRemoteSourceAllowed(src, options);
  await assertHostnameResolvesPublicly(sourceUrl.hostname, options.resolveHostname);
  return sourceUrl;
}

async function readResponseWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("tavo image: remote image is larger than the configured maxBytes limit.");
  }

  const reader = response.body?.getReader();
  if (!reader) {
    return Buffer.from(await response.arrayBuffer());
  }

  const chunks: Uint8Array[] = [];
  let received = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value) {
        continue;
      }
      received += value.byteLength;
      if (received > maxBytes) {
        throw new Error("tavo image: remote image exceeded the configured maxBytes limit.");
      }
      chunks.push(value);
    }
    complete = true;
  } finally {
    if (!complete) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

function normalizeRequestedWidth(value: string | null, fallbackSizes: number[]): number | null {
  if (!value) {
    return fallbackSizes[fallbackSizes.length - 1] ?? null;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }
  return Math.min(parsed, 3840);
}

function normalizeRequestedQuality(value: string | null, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(1, Math.min(100, parsed));
}

function normalizeRequestedFormat(value: string | null, fallback: ImageFormat): ImageFormat {
  if (
    value === "webp" ||
    value === "avif" ||
    value === "jpeg" ||
    value === "png" ||
    value === "original"
  ) {
    return value;
  }
  return fallback;
}

function resolveLocalPath(rootDir: string, publicDir: string, src: string): string {
  const cleanSrc = src.replace(/^\/+/, "");
  const normalizedPublicDir = publicDir.startsWith("/")
    ? publicDir.replace(/\/+$/, "")
    : `${rootDir}/${publicDir.replace(/^\/+/, "").replace(/\/+$/, "")}`;
  const publicRoot = new URL(`file://${normalizedPublicDir}/`).pathname;
  const resolved = new URL(cleanSrc, `file://${normalizedPublicDir}/`).pathname;
  if (!resolved.startsWith(publicRoot)) {
    throw new Error("tavo image: attempted to read outside the public directory.");
  }
  return resolved;
}

async function readLocalFileWithLimit(
  rootDir: string,
  publicDir: string,
  src: string,
  maxBytes: number
): Promise<Buffer> {
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = resolveLocalPath(rootDir, publicDir, src);
  const normalizedPublicDir = publicDir.startsWith("/")
    ? publicDir.replace(/\/+$/, "")
    : path.resolve(rootDir, publicDir.replace(/^\/+/, "").replace(/\/+$/, ""));
  const [realPublicRoot, realFilePath] = await Promise.all([
    fs.realpath(normalizedPublicDir),
    fs.realpath(filePath)
  ]);
  const relative = path.relative(realPublicRoot, realFilePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("tavo image: attempted to read outside the public directory.");
  }

  const stat = await fs.stat(realFilePath);
  if (!stat.isFile()) {
    throw new Error("tavo image: local image source is not a file.");
  }
  if (stat.size > maxBytes) {
    throw new Error("tavo image: local image is larger than the configured maxBytes limit.");
  }
  return fs.readFile(realFilePath);
}

async function fetchRemoteImageWithLimit(
  src: string,
  options: Required<ImageOptimizerOptions>
): Promise<Buffer> {
  let sourceUrl = await assertRemoteSourceAllowedForFetch(src, options);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const response = await fetch(sourceUrl, {
        redirect: "manual",
        signal: controller.signal
      });

      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel().catch(() => undefined);
        const location = response.headers.get("location");
        if (!location) {
          throw new Error("tavo image: remote image redirect is missing a location.");
        }
        if (redirectCount === 3) {
          throw new Error("tavo image: remote image exceeded the redirect limit.");
        }
        sourceUrl = await assertRemoteSourceAllowedForFetch(new URL(location, sourceUrl).toString(), options);
        continue;
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined);
        throw new Error(`tavo image: failed to fetch remote image (${response.status}).`);
      }
      return await readResponseWithLimit(response, options.maxBytes);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("tavo image: remote image exceeded the redirect limit.");
}

async function loadSourceBuffer(
  src: string,
  options: Required<ImageOptimizerOptions>
): Promise<Buffer> {
  if (isRemoteSource(src)) {
    if (!options.allowRemote) {
      throw new Error("tavo image: remote images are disabled.");
    }
    return fetchRemoteImageWithLimit(src, options);
  }

  if (!src.startsWith("/")) {
    throw new Error("tavo image: local images must use absolute public paths.");
  }

  const processRef = globalThis as unknown as { process?: { cwd?: () => string } };
  const rootDir = typeof processRef.process?.cwd === "function" ? processRef.process.cwd() : ".";
  return readLocalFileWithLimit(rootDir, options.publicDir, src, options.maxBytes);
}

function resolveOutputFormat(metadataFormat: string | undefined, requested: ImageFormat): ImageFormat {
  if (requested !== "original") {
    return requested;
  }
  if (metadataFormat === "jpeg" || metadataFormat === "jpg") {
    return "jpeg";
  }
  if (metadataFormat === "png") {
    return "png";
  }
  if (metadataFormat === "webp") {
    return "webp";
  }
  if (metadataFormat === "avif") {
    return "avif";
  }
  return "png";
}

function contentTypeForFormat(format: ImageFormat): string {
  switch (format) {
    case "avif":
      return "image/avif";
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
    default:
      return "image/webp";
  }
}

/** Optimizes one image request and returns transformed bytes plus cache metadata. */
export async function optimizeImageFromUrl(
  requestUrl: URL,
  imageOptions?: ImageOptimizerOptions
): Promise<OptimizerResult | null> {
  if (requestUrl.pathname !== "/_tavo/image") {
    return null;
  }

  const options = resolveImagesOptions(imageOptions);
  if (!options.enabled) {
    return null;
  }

  const src = requestUrl.searchParams.get("src");
  if (!src) {
    throw new Error("tavo image: missing src query parameter.");
  }

  const width = normalizeRequestedWidth(requestUrl.searchParams.get("w"), options.sizes);
  if (!width) {
    throw new Error("tavo image: invalid width query parameter.");
  }

  const quality = normalizeRequestedQuality(requestUrl.searchParams.get("q"), options.quality);
  const requestedFormat = normalizeRequestedFormat(
    requestUrl.searchParams.get("f"),
    options.defaultFormat
  );
  const workState = getImageWorkState(imageOptions);
  const cacheKey = JSON.stringify([src, width, quality, requestedFormat]);
  const cached = workState.cache.get(cacheKey);
  if (cached) {
    workState.cache.delete(cacheKey);
    workState.cache.set(cacheKey, cached);
    return cached;
  }
  const pending = workState.inflight.get(cacheKey);
  if (pending) return pending;

  const work = (async (): Promise<OptimizerResult> => {
    const release = await acquireImageTransform(workState, options);
    try {
      const sharp = await loadSharp();
      const inputBuffer = await loadSourceBuffer(src, options);
      const metadata = await sharp(inputBuffer).metadata();
      const outputFormat = resolveOutputFormat(metadata.format, requestedFormat);

      let pipeline = sharp(inputBuffer)
        .rotate()
        .resize({ width, withoutEnlargement: true });

      switch (outputFormat) {
        case "avif":
          pipeline = pipeline.avif({ quality });
          break;
        case "jpeg":
          pipeline = pipeline.jpeg({ quality, mozjpeg: true });
          break;
        case "png":
          pipeline = pipeline.png({ quality });
          break;
        case "webp":
        default:
          pipeline = pipeline.webp({ quality });
          break;
      }

      const result: OptimizerResult = {
        body: await pipeline.toBuffer(),
        contentType: contentTypeForFormat(outputFormat),
        maxAgeSeconds: options.cacheMaxAge
      };
      if (options.memoryCacheMaxEntries > 0) {
        workState.cache.set(cacheKey, result);
        while (workState.cache.size > options.memoryCacheMaxEntries) {
          const oldest = workState.cache.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          workState.cache.delete(oldest);
        }
      }
      return result;
    } finally {
      release();
    }
  })();
  workState.inflight.set(cacheKey, work);
  try {
    return await work;
  } finally {
    workState.inflight.delete(cacheKey);
  }
}

/** Converts one optimizer result to a standard Fetch Response object. */
export function imageOptimizerResultToResponse(result: OptimizerResult): Response {
  const arrayBuffer = result.body.buffer.slice(
    result.body.byteOffset,
    result.body.byteOffset + result.body.byteLength
  ) as ArrayBuffer;
  return new Response(arrayBuffer, {
    status: 200,
    headers: withDefaultSecurityHeaders({
      "Content-Type": result.contentType,
      "Cache-Control": `public, max-age=${result.maxAgeSeconds}, immutable`
    })
  });
}

/** Converts optimizer failures into contained HTTP responses for public endpoints. */
export function imageOptimizerErrorToResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  let status = 500;
  let body = "Image Optimization Failed";

  if (code === "ENOENT") {
    status = 404;
    body = "Image Not Found";
  } else if (message.includes("optimizer is busy")) {
    status = 503;
    body = "Service Unavailable";
  } else if (message.includes("larger than") || message.includes("exceeded the configured maxBytes")) {
    status = 413;
    body = "Payload Too Large";
  } else if (
    message.includes("private network") ||
    message.includes("are disabled") ||
    message.includes("host is not allowed") ||
    message.includes("must use https") ||
    message.includes("outside the public directory")
  ) {
    status = 403;
    body = "Forbidden";
  } else if (
    message.includes("missing src") ||
    message.includes("invalid width") ||
    message.includes("must use absolute public paths") ||
    message.includes("source is not a file")
  ) {
    status = 400;
    body = "Invalid Image Request";
  } else if (
    message.includes("failed to fetch remote image") ||
    message.includes("remote image redirect") ||
    message.includes("remote image exceeded the redirect limit") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  ) {
    status = 502;
    body = "Bad Gateway";
  }

  return new Response(body, {
    status,
    headers: withDefaultSecurityHeaders({
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      ...(status === 503 ? { "Retry-After": "1" } : {})
    })
  });
}
