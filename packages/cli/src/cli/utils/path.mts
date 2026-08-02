export function normalizePathname(value: string): string {
  return value.startsWith("/") ? value : `/${value}`;
}

export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

export function normalizeModuleId(value: string): string {
  return toPosixPath(value).replace(/\?.*$/, "");
}

export function normalizeGeneratorName(value: string): string {
  const normalized = toPosixPath(value).trim();
  if (
    normalized.length === 0 ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:/.test(normalized) ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("tavo CLI: generator name must be a relative path inside the project.");
  }

  const trimmed = normalized.replace(/\/+$/, "");
  const segments = trimmed.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error("tavo CLI: generator name cannot contain . or .. path segments.");
  }
  return segments.join("/");
}
