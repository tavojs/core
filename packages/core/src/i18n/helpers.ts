import type {
  I18nDetectLocaleInput,
  I18nMessages,
  I18nParams,
  I18nRoutingOptions,
  I18nState,
  I18nTextTree,
  I18nTextValue
} from "./types.js";

function isTextTree(value: I18nTextValue | undefined): value is I18nTextTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeTextTree<T extends I18nTextTree>(left: T, right: I18nTextTree): T {
  const next: Record<string, I18nTextValue> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const previous = next[key];
    next[key] = isTextTree(previous) && isTextTree(value)
      ? mergeTextTree(previous, value)
      : value;
  }
  return next as T;
}

export function readTextPath(
  messages: I18nTextTree | undefined,
  key: string
): I18nTextValue | undefined {
  if (!messages) return undefined;
  let current: I18nTextValue | undefined = messages;
  for (const segment of key.split(".").filter(Boolean)) {
    if (!isTextTree(current)) return undefined;
    current = current[segment];
  }
  return current;
}

export function interpolate(value: string, params?: I18nParams): string {
  if (!params) return value;
  return value.replace(/\{([A-Za-z0-9_.-]+)\}/g, (match, key: string) => {
    const replacement = params[key];
    return replacement === undefined || replacement === null
      ? match
      : String(replacement);
  });
}

export function normalizePathname(pathname = "/"): string {
  const value = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return value.replace(/\/{2,}/g, "/") || "/";
}

export function readHeader(
  headers: I18nDetectLocaleInput["headers"] | undefined,
  name: string
): string | undefined {
  if (!headers) return undefined;
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return headers.get(name) ?? undefined;
  }
  const lowerName = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return Array.isArray(value) ? value.join(",") : value;
    }
  }
  return undefined;
}

export function getRequestHeaders(
  request: unknown
): I18nDetectLocaleInput["headers"] | undefined {
  if (!request || typeof request !== "object") return undefined;
  return (request as { headers?: I18nDetectLocaleInput["headers"] }).headers;
}

export function readCookie(
  cookieHeader: string | undefined,
  name: string
): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey !== name) continue;
    try {
      return decodeURIComponent(rawValue.join("="));
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function canUseDocumentCookie(): boolean {
  return typeof document !== "undefined" && typeof document.cookie === "string";
}

export function readBrowserCookie(name: string): string | undefined {
  return canUseDocumentCookie() ? readCookie(document.cookie, name) : undefined;
}

export function writeBrowserCookie(name: string, value: string): void {
  if (!canUseDocumentCookie()) return;
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; ` +
    "Max-Age=31536000; SameSite=Lax";
}

export function applyBrowserDocumentLocale(
  locale: string,
  info: { dir?: string } | undefined
): void {
  if (typeof document === "undefined" || !document.documentElement) return;
  document.documentElement.lang = locale;
  document.documentElement.setAttribute("dir", info?.dir ?? "ltr");
}

export function pickAcceptedLocale<TLocale extends string>(
  header: string | undefined,
  locales: readonly TLocale[]
): TLocale | undefined {
  if (!header) return undefined;
  const ranked = header
    .split(",")
    .map((entry) => {
      const [locale = "", q = "q=1"] = entry.trim().split(";");
      return {
        locale: locale.toLowerCase(),
        quality: Number(q.trim().replace(/^q=/, "")) || 0
      };
    })
    .sort((left, right) => right.quality - left.quality);
  for (const candidate of ranked) {
    const exact = locales.find((locale) => locale.toLowerCase() === candidate.locale);
    if (exact) return exact;
    const language = candidate.locale.split("-")[0];
    const match = locales.find((locale) => (
      locale.toLowerCase().split("-")[0] === language
    ));
    if (match) return match;
  }
  return undefined;
}

export function isRoutingEnabled(
  routing: false | I18nRoutingOptions | undefined
): boolean {
  return routing !== false && Boolean(routing?.enabled);
}

export function selectText<
  TMessages extends I18nMessages,
  TDefaultLocale extends keyof TMessages & string
>(state: I18nState<TMessages>): TMessages[TDefaultLocale] {
  return (state.messages[state.locale] ?? state.messages[state.fallbackLocale]) as
    TMessages[TDefaultLocale];
}

export function selectTranslationValue<TMessages extends I18nMessages>(
  state: I18nState<TMessages>,
  key: string
): I18nTextValue | undefined {
  return readTextPath(state.messages[state.locale], key)
    ?? readTextPath(state.messages[state.fallbackLocale], key);
}
