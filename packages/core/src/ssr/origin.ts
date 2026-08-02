import { TavoError } from "../diagnostics.js";

export function normalizeCanonicalOrigin(
  value: string | undefined,
): URL | null {
  if (!value) {
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch (cause) {
    throw new TavoError(
      "TAVO_SSR_001",
      "tavo ssr: canonicalOrigin must be an HTTP(S) origin without "
        + "credentials, path, query, or hash.",
      { cause, details: { value } },
    );
  }
  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || parsed.username
    || parsed.password
    || parsed.pathname !== "/"
    || parsed.search
    || parsed.hash
  ) {
    throw new TavoError(
      "TAVO_SSR_001",
      "tavo ssr: canonicalOrigin must be an HTTP(S) origin without "
        + "credentials, path, query, or hash.",
      { details: { value } },
    );
  }
  return parsed;
}
