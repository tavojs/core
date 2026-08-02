import path from "node:path";

export function normalizePathname(value: string): string {
  return value.replace(/\\/g, "/");
}

export function isSourceFile(id: string): boolean {
  return /\.[cm]?[jt]sx?$/.test(id);
}

export function stripQuery(id: string): string {
  return id.split("?", 1)[0] ?? id;
}

export function isInsideServerDirectory(file: string, root: string): boolean {
  const relative = normalizePathname(path.relative(root, file));
  return relative === "src/server" || relative.startsWith("src/server/");
}

export function importTargetsServerDirectory(
  importer: string,
  specifier: string,
  root: string
): boolean {
  if (specifier.startsWith("/src/server/") || specifier === "/src/server") return true;
  if (specifier.startsWith("src/server/") || specifier === "src/server") return true;
  if (!specifier.startsWith(".")) return false;
  const resolved = path.resolve(path.dirname(importer), specifier);
  return isInsideServerDirectory(resolved, root);
}
