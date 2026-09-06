import type { ImageOptimizerOptions, RemoteImagePattern } from "./types.js";

export async function defaultResolveHostname(hostname: string): Promise<Array<{ address: string }>> {
  const dns = await import("node:dns/promises");
  return dns.lookup(hostname, { all: true, verbatim: true });
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
  let normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (normalized.includes(":")) {
    try {
      normalized = new URL(`http://[${normalized}]/`).hostname.slice(1, -1);
    } catch {
      return true;
    }
  }
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
    normalized === "::1"
  ) {
    return true;
  }

  const ipv4 = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) {
    if (
      normalized === "::" ||
      (normalized.includes(":") && /^(?:f[cd]|fe[89ab]|ff)/.test(normalized)) ||
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
  resolveHostname: Required<ImageOptimizerOptions>["resolveHostname"],
  signal: AbortSignal
): Promise<Array<{ address: string; family: number }>> {
  const net = await import("node:net");
  hostname = hostname.replace(/^\[|\]$/g, "");
  if (net.isIP(hostname)) {
    if (isPrivateHostname(hostname)) {
      throw new Error("tavo image: private network image hosts are not allowed.");
    }
    return [{ address: hostname, family: net.isIP(hostname) }];
  }

  signal.throwIfAborted();
  let onAbort: () => void = () => {};
  let records: Array<{ address: string }>;
  try {
    records = await Promise.race([
      resolveHostname(hostname),
      new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
      })
    ]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  if (records.length === 0 || records.some((record) => !net.isIP(record.address) || isPrivateHostname(record.address))) {
    throw new Error("tavo image: private network image hosts are not allowed.");
  }
  return records.map(({ address }) => ({ address, family: net.isIP(address) }));
}

function assertRemoteSourceAllowed(src: string, options: Required<ImageOptimizerOptions>): URL {
  const sourceUrl = new URL(src);
  if (isPrivateHostname(sourceUrl.hostname)) {
    throw new Error("tavo image: private network image hosts are not allowed.");
  }
  if (sourceUrl.protocol !== "https:" && (sourceUrl.protocol !== "http:" || !options.allowInsecureRemote)) {
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

async function requestRemoteImage(
  sourceUrl: URL,
  addresses: Array<{ address: string; family: number }>,
  signal: AbortSignal
): Promise<import("node:http").IncomingMessage> {
  const transport = sourceUrl.protocol === "https:"
    ? (await import("node:https")).default
    : (await import("node:http")).default;
  return new Promise((resolve, reject) => {
    const request = transport.request(sourceUrl, {
      // Keep the URL hostname for Host and TLS verification, but connect only to
      // validated addresses. Avoid a pooled socket that predates this DNS check.
      agent: false,
      signal,
      headers: { "Accept-Encoding": "identity" },
      lookup: (_hostname, options, callback) => {
        if (options.all) {
          callback(null, addresses);
        } else {
          callback(null, addresses[0]!.address, addresses[0]!.family);
        }
      }
    }, resolve);
    request.on("error", reject);
    request.end();
  });
}

async function readResponseWithLimit(response: import("node:http").IncomingMessage, maxBytes: number): Promise<Buffer> {
  const contentLength = response.headers["content-length"];
  if (contentLength && Number(contentLength) > maxBytes) {
    response.destroy();
    throw new Error("tavo image: remote image is larger than the configured maxBytes limit.");
  }

  const chunks: Buffer[] = [];
  let received = 0;
  let complete = false;
  try {
    for await (const chunk of response) {
      received += chunk.byteLength;
      if (received > maxBytes) {
        throw new Error("tavo image: remote image exceeded the configured maxBytes limit.");
      }
      chunks.push(chunk);
    }
    complete = true;
  } finally {
    if (!complete) {
      response.destroy();
    }
  }

  return Buffer.concat(chunks, received);
}

export async function fetchRemoteImageWithLimit(
  src: string,
  options: Required<ImageOptimizerOptions>
): Promise<Buffer> {
  let sourceUrl = assertRemoteSourceAllowed(src, options);
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const addresses = await assertHostnameResolvesPublicly(sourceUrl.hostname, options.resolveHostname, controller.signal);
      const response = await requestRemoteImage(sourceUrl, addresses, controller.signal);
      const status = response.statusCode ?? 502;

      if (status >= 300 && status < 400) {
        response.destroy();
        const location = response.headers.location;
        if (!location) {
          throw new Error("tavo image: remote image redirect is missing a location.");
        }
        if (redirectCount === 3) {
          throw new Error("tavo image: remote image exceeded the redirect limit.");
        }
        sourceUrl = assertRemoteSourceAllowed(new URL(location, sourceUrl).toString(), options);
        continue;
      }

      if (status < 200 || status >= 300) {
        response.destroy();
        throw new Error(`tavo image: failed to fetch remote image (${status}).`);
      }
      return await readResponseWithLimit(response, options.maxBytes);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("tavo image: remote image exceeded the redirect limit.");
}
