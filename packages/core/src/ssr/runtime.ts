/** Performs dynamic runtime imports for Node-only modules. */
export function runtimeImport(specifier: string): Promise<any> {
  return new Function("s", "return import(s);")(specifier) as Promise<any>;
}

/** Converts paths to POSIX style for virtual module addressing. */
export function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

/** Recursively collects source files supported as page modules. */
export async function readFilesRecursive(rootDir: string): Promise<string[]> {
  const fs = await runtimeImport("node:fs/promises");
  const path = await runtimeImport("node:path");
  const out: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!/\.[cm]?[jt]sx?$/.test(entry.name)) {
        continue;
      }
      out.push(fullPath);
    }
  }

  await walk(rootDir);
  return out;
}

/** Checks whether a file path exists and is accessible. */
export async function fileExists(pathname: string): Promise<boolean> {
  try {
    const fs = await runtimeImport("node:fs/promises");
    await fs.access(pathname);
    return true;
  } catch {
    return false;
  }
}

/** Loads Vite from project root if installed locally, otherwise falls back globally. */
export async function loadViteFromProjectRoot(rootDir: string): Promise<any> {
  try {
    const [{ createRequire }, path] = await Promise.all([
      runtimeImport("node:module"),
      runtimeImport("node:path")
    ]);
    const requireFromRoot = createRequire(path.join(rootDir, "package.json"));
    const resolved = requireFromRoot.resolve("vite");
    return runtimeImport(resolved);
  } catch {
    return runtimeImport("vite");
  }
}
