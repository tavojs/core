import fs from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { fileExists } from "../utils/fs.mjs";
import type { PackageManager } from "../types.mjs";

type ProjectConfig = {
  pagesDir?: string;
  cssEntries?: string[];
  build?: {
    prerenderStyles?: "inline" | "external";
    budgets?: {
      firstLoadJs?: string | number;
      routeJs?: string | number;
    };
  };
};

const projectConfigCache = new Map<string, Promise<ProjectConfig>>();

type CoreConfigModule = {
  loadTavoConfig(
    rootDir: string,
    options?: { mode?: string },
  ): Promise<ProjectConfig>;
};

async function loadCoreConfigModule(rootDir: string): Promise<CoreConfigModule> {
  async function findCorePackage(start: string): Promise<string | null> {
    let current = path.resolve(start);
    while (true) {
      const candidate = path.join(
        current,
        "node_modules",
        "@tavojs",
        "core",
      );
      if (await fileExists(path.join(candidate, "package.json"))) {
        return candidate;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        return null;
      }
      current = parent;
    }
  }
  const packageRoot = await findCorePackage(rootDir)
    ?? await findCorePackage(path.dirname(fileURLToPath(import.meta.url)));
  if (!packageRoot) {
    throw new Error(
      "tavo CLI: @tavojs/core is required to load tavo.config.ts.",
    );
  }
  const packageJson = JSON.parse(
    await fs.readFile(path.join(packageRoot, "package.json"), "utf8"),
  ) as {
    exports?: Record<string, string | { import?: string }>;
  };
  const devExport = packageJson.exports?.["./dev"];
  const relativeEntry = typeof devExport === "string"
    ? devExport
    : devExport?.import;
  if (!relativeEntry) {
    throw new Error(
      "tavo CLI: @tavojs/core does not export @tavojs/core/dev.",
    );
  }
  const entry = path.resolve(packageRoot, relativeEntry);
  const loaded = await import(pathToFileURL(entry).href) as Partial<CoreConfigModule>;
  if (typeof loaded.loadTavoConfig !== "function") {
    throw new Error(
      "tavo CLI: @tavojs/core/dev must export loadTavoConfig().",
    );
  }
  return loaded as CoreConfigModule;
}

export async function loadViteFromProjectRoot(rootDir: string): Promise<typeof import("vite")> {
  try {
    const requireFromRoot = createRequire(path.join(rootDir, "package.json"));
    return await import(requireFromRoot.resolve("vite"));
  } catch {
    return await import("vite");
  }
}

export async function loadProjectConfig(rootDir: string): Promise<ProjectConfig> {
  const resolvedRoot = path.resolve(rootDir);
  const cached = projectConfigCache.get(resolvedRoot);
  if (cached) {
    return cached;
  }
  const pending = (async () => {
    const coreConfig = await loadCoreConfigModule(resolvedRoot);
    return coreConfig.loadTavoConfig(resolvedRoot, {
      mode: process.env.NODE_ENV?.trim() || "production",
    });
  })();
  projectConfigCache.set(resolvedRoot, pending);
  try {
    return await pending;
  } catch (error) {
    projectConfigCache.delete(resolvedRoot);
    throw error;
  }
}

export async function readPagesDirFromConfig(rootDir: string): Promise<string> {
  return (await loadProjectConfig(rootDir)).pagesDir ?? "src/pages";
}

export async function readCssEntriesFromConfig(rootDir: string): Promise<string[]> {
  return (await loadProjectConfig(rootDir)).cssEntries
    ?? ["src/styles.css", "src/styles.scss", "src/app.css", "src/app.scss"];
}

export async function readBuildBudgetsFromConfig(rootDir: string): Promise<{
  firstLoadJs?: string | number;
  routeJs?: string | number;
}> {
  return (await loadProjectConfig(rootDir)).build?.budgets ?? {};
}

export async function readPrerenderStyleModeFromConfig(
  rootDir: string
): Promise<"inline" | "external"> {
  return (await loadProjectConfig(rootDir)).build?.prerenderStyles === "external"
    ? "external"
    : "inline";
}

export async function detectPackageManager(rootDir: string): Promise<PackageManager> {
  const packageFile = path.join(rootDir, "package.json");
  if (await fileExists(packageFile)) {
    try {
      const pkg = JSON.parse(await fs.readFile(packageFile, "utf8"));
      const fromField = typeof pkg.packageManager === "string" ? pkg.packageManager.split("@")[0] : null;
      if (fromField === "npm" || fromField === "pnpm" || fromField === "yarn" || fromField === "bun") {
        return fromField;
      }
    } catch {}
  }
  if (await fileExists(path.join(rootDir, "pnpm-lock.yaml"))) {
    return "pnpm";
  }
  if (await fileExists(path.join(rootDir, "yarn.lock"))) {
    return "yarn";
  }
  if (await fileExists(path.join(rootDir, "bun.lockb")) || await fileExists(path.join(rootDir, "bun.lock"))) {
    return "bun";
  }
  return "npm";
}

export async function ensureProjectPackage(rootDir: string): Promise<void> {
  const packageFile = path.join(rootDir, "package.json");
  if (await fileExists(packageFile)) {
    return;
  }
  throw new Error("tavo CLI: no package.json found in the current project root.");
}
