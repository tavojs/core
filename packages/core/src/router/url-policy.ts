export type TrailingSlashPolicy = "always" | "never" | "preserve";

declare const __TAVO_TRAILING_SLASH__: TrailingSlashPolicy | undefined;

export type ResolvedUrlPolicy = {
  readonly trailingSlash: TrailingSlashPolicy;
  /** Formats a route URL while retaining its query string and fragment. */
  canonicalize(url: string): string;
};

/** Resolves the public routing policy, including its backward-compatible default. */
export function resolveUrlPolicy(
  routing?: { trailingSlash?: TrailingSlashPolicy },
): ResolvedUrlPolicy {
  const bundledPolicy = typeof __TAVO_TRAILING_SLASH__ === "undefined"
    ? undefined
    : __TAVO_TRAILING_SLASH__;
  const trailingSlash = routing?.trailingSlash ?? bundledPolicy ?? "preserve";
  return Object.freeze({
    trailingSlash,
    canonicalize(url: string): string {
      return canonicalizeTrailingSlash(url, trailingSlash);
    },
  });
}

/** Applies a trailing-slash policy without disturbing a URL's search or hash. */
export function canonicalizeTrailingSlash(
  value: string,
  policy: TrailingSlashPolicy,
): string {
  if (policy === "preserve" || !value || value.startsWith("#") || value.startsWith("?")) {
    return value;
  }
  const suffixIndex = value.search(/[?#]/);
  const path = suffixIndex < 0 ? value : value.slice(0, suffixIndex);
  const suffix = suffixIndex < 0 ? "" : value.slice(suffixIndex);
  if (!path) return value;

  // Retain an absolute URL's authority and operate only on its pathname.
  const absoluteMatch = path.match(/^([a-z][a-z\d+.-]*:\/\/[^/]+)(\/.*)?$/i);
  const prefix = absoluteMatch?.[1] ?? "";
  const pathname = absoluteMatch ? (absoluteMatch[2] || "/") : path;
  if (pathname === "/") return `${prefix}/${suffix}`;
  const canonicalPath = policy === "always"
    ? `${pathname.replace(/\/+$/, "")}/`
    : pathname.replace(/\/+$/, "");
  return `${prefix}${canonicalPath || "/"}${suffix}`;
}
