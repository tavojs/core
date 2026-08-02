const SAFE_ATTRIBUTE_NAME = /^[A-Za-z_:][A-Za-z0-9_:.~-]*$/;
const SAFE_ELEMENT_TAG_NAME = /^[A-Za-z][A-Za-z0-9:-]*$/;
const URL_ATTRIBUTE_NAMES = new Set([
  "action",
  "background",
  "cite",
  "data",
  "formaction",
  "href",
  "imagesrcset",
  "manifest",
  "ping",
  "poster",
  "src",
  "srcset",
  "xlink:href"
]);
const SAFE_URL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);
const DEFAULT_SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Frame-Options": "SAMEORIGIN"
};

/** Returns true when an attribute name is safe to serialize or set on a DOM element. */
export function isSafeAttributeName(name: string): boolean {
  const normalized = name.toLowerCase();
  return SAFE_ATTRIBUTE_NAME.test(name) && !normalized.startsWith("on") && normalized !== "srcdoc";
}

/** Returns true when an element tag name is safe to serialize or create. */
export function isSafeElementTagName(name: string): boolean {
  return SAFE_ELEMENT_TAG_NAME.test(name);
}

/** Returns true when a prop name is a URL-valued attribute that needs protocol validation. */
export function isUrlAttributeName(name: string): boolean {
  return URL_ATTRIBUTE_NAMES.has(name.toLowerCase());
}

/** Accepts relative URLs and well-known safe absolute URL protocols. */
export function isSafeUrlValue(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return true;
  }
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    return false;
  }
  if (trimmed.startsWith("//")) {
    return false;
  }
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.startsWith("?")
  ) {
    return true;
  }

  try {
    const parsed = new URL(trimmed, "https://tavo.local");
    return SAFE_URL_PROTOCOLS.has(parsed.protocol);
  } catch {
    return false;
  }
}

/** Returns true when a prop can be safely serialized as an HTML/DOM attribute. */
export function isSafeAttribute(name: string, value: unknown): boolean {
  if (!isSafeAttributeName(name)) {
    return false;
  }
  const normalized = name.toLowerCase();
  if (normalized === "srcset" || normalized === "imagesrcset") {
    return String(value)
      .split(",")
      .every((candidate) => isSafeUrlValue(candidate.trim().split(/\s+/, 1)[0] ?? ""));
  }
  if (normalized === "ping") {
    return String(value).split(/\s+/).filter(Boolean).every(isSafeUrlValue);
  }
  return !isUrlAttributeName(normalized) || isSafeUrlValue(String(value));
}

/** Escapes strings for HTML attribute/text contexts. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Escapes JSON embedded in script tags. */
export function escapeScriptJson(value: string): string {
  return value
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

/** Normalizes middleware redirects to safe same-origin paths by default. */
export function normalizeRedirectTarget(
  value: string,
  options?: { allowExternal?: boolean }
): string {
  const trimmed = value.trim();
  if (trimmed.length === 0 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new Error("tavo security: redirect target is invalid.");
  }

  if (trimmed.startsWith("/")) {
    if (trimmed.startsWith("//") || trimmed.includes("\\") || /%(?:2f|5c)/i.test(trimmed)) {
      throw new Error("tavo security: protocol-relative redirects are not allowed.");
    }
    const base = new URL("https://tavo.invalid/");
    if (new URL(trimmed, base).origin !== base.origin) {
      throw new Error("tavo security: protocol-relative redirects are not allowed.");
    }
    return trimmed;
  }

  if (options?.allowExternal) {
    const parsed = new URL(trimmed);
    if (!SAFE_URL_PROTOCOLS.has(parsed.protocol) || parsed.protocol === "mailto:" || parsed.protocol === "tel:") {
      throw new Error("tavo security: external redirect protocol is not allowed.");
    }
    return parsed.toString();
  }

  throw new Error("tavo security: external redirects are disabled by default.");
}

/** Merges secure-by-default SSR headers with caller supplied headers. */
export function withDefaultSecurityHeaders(headers?: Record<string, string>): Record<string, string> {
  return {
    ...DEFAULT_SECURITY_HEADERS,
    ...(headers ?? {})
  };
}
