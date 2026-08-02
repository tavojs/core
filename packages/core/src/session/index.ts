import { normalizeRedirectTarget } from "../security.js";
import type {
  Session,
  SessionCommitOptions,
  SessionCookieOptions,
  SessionStorage,
  SessionStorageOptions,
  SessionStore,
  SessionStoreEntry
} from "./types.js";

export type {
  Session,
  SessionCommitOptions,
  SessionCookieOptions,
  SessionCookieSameSite,
  SessionStorage,
  SessionStorageOptions,
  SessionStore,
  SessionStoreEntry
} from "./types.js";

const DEFAULT_PATH = "/";
const DEFAULT_SAME_SITE = "lax";
const MIN_SECRET_BYTES = 32;
const DEFAULT_MAX_MEMORY_SESSIONS = 10_000;

export type MemorySessionStoreOptions = {
  /** Maximum process-local sessions. Set to 0 to disable persistence. */
  maxEntries?: number;
};

function isStrongSessionSecret(secret: string): boolean {
  return new TextEncoder().encode(secret).byteLength >= MIN_SECRET_BYTES;
}

function assertCookieConfig(cookie: SessionCookieOptions): void {
  if (!cookie.name || /[=\s;]/.test(cookie.name)) {
    throw new Error("tavo session: cookie.name must be a valid cookie name.");
  }
  if (!Array.isArray(cookie.secrets) || cookie.secrets.length === 0 || cookie.secrets.some((secret) => !secret)) {
    throw new Error("tavo session: cookie.secrets must include at least one non-empty secret.");
  }
  if (cookie.secrets.some((secret) => !isStrongSessionSecret(secret))) {
    throw new Error(`tavo session: cookie.secrets must be at least ${MIN_SECRET_BYTES} bytes each.`);
  }
  if (cookie.path && /[;\u0000-\u001f\u007f]/.test(cookie.path)) {
    throw new Error("tavo session: cookie.path contains invalid characters.");
  }
  if (cookie.domain && /[;\s\u0000-\u001f\u007f]/.test(cookie.domain)) {
    throw new Error("tavo session: cookie.domain contains invalid characters.");
  }
  if (cookie.sameSite && !["lax", "strict", "none"].includes(cookie.sameSite)) {
    throw new Error("tavo session: cookie.sameSite must be lax, strict, or none.");
  }
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlEncodeString(value: string): string {
  return base64UrlEncode(new TextEncoder().encode(value));
}

function timingSafeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.byteLength !== rightBytes.byteLength) {
    return false;
  }
  let diff = 0;
  for (let index = 0; index < leftBytes.byteLength; index += 1) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
}

type SessionSigner = (value: string) => Promise<string>;

function createSessionSigner(secret: string): SessionSigner {
  let keyPromise: Promise<CryptoKey> | null = null;
  return async (value: string): Promise<string> => {
    keyPromise ??= crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      await keyPromise,
      new TextEncoder().encode(value)
    );
    return base64UrlEncode(new Uint8Array(signature));
  };
}

async function encodeSignedId(id: string, sign: SessionSigner): Promise<string> {
  const encodedId = base64UrlEncodeString(id);
  return `${encodedId}.${await sign(encodedId)}`;
}

async function decodeSignedId(value: string | undefined, signers: SessionSigner[]): Promise<string | null> {
  if (!value) {
    return null;
  }
  const [encodedId, signature] = value.split(".");
  if (!encodedId || !signature) {
    return null;
  }
  for (const sign of signers) {
    if (timingSafeEqual(signature, await sign(encodedId))) {
      try {
        const padded = encodedId.replace(/-/g, "+").replace(/_/g, "/");
        const base64 = padded.padEnd(Math.ceil(padded.length / 4) * 4, "=");
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) {
          bytes[index] = binary.charCodeAt(index);
        }
        return new TextDecoder().decode(bytes);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function createSessionId(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) {
      continue;
    }
    const name = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (name) {
      cookies[name] = value;
    }
  }
  return cookies;
}

function requestFromContext(contextOrRequest: unknown): Request | null {
  if (typeof Request !== "undefined" && contextOrRequest instanceof Request) {
    return contextOrRequest;
  }
  const request = (contextOrRequest as { request?: unknown } | undefined)?.request;
  return typeof Request !== "undefined" && request instanceof Request ? request : null;
}

function serializeCookie(
  cookie: SessionCookieOptions,
  value: string,
  options: { expires?: Date; maxAge?: number; secure?: boolean } = {}
): string {
  const parts = [`${cookie.name}=${value}`];
  parts.push(`Path=${cookie.path ?? DEFAULT_PATH}`);
  if (cookie.domain) {
    parts.push(`Domain=${cookie.domain}`);
  }
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  }
  if (options.expires) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (cookie.httpOnly !== false) {
    parts.push("HttpOnly");
  }
  if (options.secure ?? cookie.secure) {
    parts.push("Secure");
  }
  parts.push(`SameSite=${cookie.sameSite ?? DEFAULT_SAME_SITE}`);
  return parts.join("; ");
}

class TavoSession<T extends Record<string, unknown>> implements Session<T> {
  private destroyed = false;
  private shouldRotate = false;

  constructor(
    public id: string,
    public data: T,
    public isNew: boolean,
    public secure: boolean
  ) {}

  get rotated(): boolean {
    return this.shouldRotate;
  }

  delete(key: keyof T & string): void {
    delete this.data[key];
  }

  destroy(): void {
    this.destroyed = true;
  }

  get<K extends keyof T & string>(key: K): T[K] | undefined {
    return this.data[key] as T[K] | undefined;
  }

  has(key: keyof T & string): boolean {
    return Object.prototype.hasOwnProperty.call(this.data, key);
  }

  rotate(): void {
    this.shouldRotate = true;
  }

  set<K extends keyof T & string>(key: K, value: T[K]): void {
    this.data[key] = value;
  }

  consumeDestroyed(): boolean {
    return this.destroyed;
  }
}

export function createMemorySessionStore<T extends Record<string, unknown>>(
  options?: MemorySessionStoreOptions
): SessionStore<T> & {
  size(): number;
} {
  const sessions = new Map<string, SessionStoreEntry<T>>();
  const requestedMax = options?.maxEntries ?? DEFAULT_MAX_MEMORY_SESSIONS;
  if (!Number.isFinite(requestedMax) || requestedMax < 0) {
    throw new RangeError("tavo session: memory store maxEntries must be a finite non-negative number.");
  }
  const maxEntries = Math.floor(requestedMax);

  function read(id: string): SessionStoreEntry<T> | null {
    const entry = sessions.get(id) ?? null;
    if (!entry) {
      return null;
    }
    if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
      sessions.delete(id);
      return null;
    }
    return {
      data: { ...entry.data },
      expiresAt: entry.expiresAt
    };
  }

  return {
    get: read,
    set(id, entry) {
      if (maxEntries === 0) {
        return;
      }
      sessions.delete(id);
      sessions.set(id, {
        data: { ...entry.data },
        expiresAt: entry.expiresAt
      });
      while (sessions.size > maxEntries) {
        const oldest = sessions.keys().next().value as string | undefined;
        if (oldest === undefined) {
          break;
        }
        sessions.delete(oldest);
      }
    },
    delete(id) {
      sessions.delete(id);
    },
    size() {
      return sessions.size;
    }
  };
}

export function createSessionStorage<T extends Record<string, unknown>>(
  options: SessionStorageOptions<T>
): SessionStorage<T> {
  assertCookieConfig(options.cookie);
  const cookie = options.cookie;
  const store = options.store ?? createMemorySessionStore<T>();
  const signers = cookie.secrets.map(createSessionSigner);

  async function getSession(contextOrRequest?: unknown): Promise<Session<T>> {
    const request = requestFromContext(contextOrRequest);
    const secure = cookie.secure ?? (request ? new URL(request.url).protocol === "https:" : false);
    const cookies = parseCookieHeader(request?.headers.get("cookie"));
    const id = await decodeSignedId(cookies[cookie.name], signers);
    if (id) {
      const entry = await store.get(id);
      if (entry) {
        return new TavoSession<T>(id, { ...entry.data }, false, secure);
      }
      await store.delete(id);
    }
    return new TavoSession<T>(createSessionId(), {} as T, true, secure);
  }

  async function commitSession(session: Session<T>, commitOptions?: SessionCommitOptions): Promise<string> {
    const concrete = session as TavoSession<T>;
    if (concrete.consumeDestroyed()) {
      return destroySession(session, commitOptions);
    }

    const previousId = concrete.id;
    if (concrete.rotated) {
      concrete.id = createSessionId();
      await store.delete(previousId);
    }

    const maxAge = commitOptions?.maxAge ?? cookie.maxAge;
    const expiresAt = typeof maxAge === "number" ? Date.now() + Math.max(0, maxAge) * 1000 : null;
    await store.set(concrete.id, {
      data: { ...concrete.data },
      expiresAt
    });

    return serializeCookie(cookie, await encodeSignedId(concrete.id, signers[0]), {
      maxAge,
      secure: concrete.secure
    });
  }

  async function destroySession(session: Session<T>, commitOptions?: SessionCommitOptions): Promise<string> {
    await store.delete(session.id);
    const maxAge = commitOptions?.maxAge ?? 0;
    return serializeCookie(cookie, "", {
      expires: new Date(0),
      maxAge,
      secure: session.secure
    });
  }

  async function redirect(to: string, session: Session<T>, init?: ResponseInit): Promise<Response> {
    const headers = new Headers(init?.headers);
    headers.append("Set-Cookie", await commitSession(session));
    headers.set("Location", normalizeRedirectTarget(to));
    return new Response(null, {
      ...init,
      status: init?.status ?? 303,
      headers
    });
  }

  return {
    commitSession,
    destroySession,
    getSession,
    redirect
  };
}
