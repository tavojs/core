import { loadServerEnv } from "../ssr/env.js";
import { TAVO_CONFIG_MARKER } from "./define.js";
import type { TavoConfig } from "./types.js";

export type LoadTavoConfigOptions = {
  mode?: string;
};

/** Keeps core configuration isolated from fields owned by other Tavo packages. */
function normalizeTavoConfig(value: unknown): TavoConfig {
  if (
    !value
    || typeof value !== "object"
    || (value as Record<PropertyKey, unknown>)[TAVO_CONFIG_MARKER] !== true
  ) {
    throw new Error(
      "tavo config: tavo.config.ts must default-export defineConfig({...}).",
    );
  }
  const candidate = value as TavoConfig;
  const config: TavoConfig = {};
  if (candidate.pagesDir !== undefined) {
    config.pagesDir = candidate.pagesDir;
  }
  if (candidate.cssEntries !== undefined) {
    config.cssEntries = candidate.cssEntries;
  }
  if (candidate.plugins !== undefined) {
    config.plugins = candidate.plugins;
  }
  if (candidate.diagnostics !== undefined) {
    config.diagnostics = candidate.diagnostics;
  }
  if (candidate.build !== undefined) {
    config.build = candidate.build;
  }
  if (candidate.ssr !== undefined) {
    config.ssr = candidate.ssr;
  }
  return config;
}

async function loadTypeScriptTavoConfig(
  absolute: string,
  rootDir: string,
  mode: string,
): Promise<TavoConfig> {
  const runtimeImport = new Function(
    "specifier",
    "return import(specifier);",
  ) as (specifier: string) => Promise<any>;
  const vite = await runtimeImport("vite");
  let loaded;
  try {
    loaded = await vite.loadConfigFromFile(
      { command: mode === "production" ? "build" : "serve", mode },
      absolute,
      rootDir,
      "silent",
    );
  } catch (error) {
    if (
      error instanceof Error
      && error.message === "config must export or return an object."
    ) {
      throw new Error(
        "tavo config: tavo.config.ts must default-export defineConfig({...}).",
        { cause: error },
      );
    }
    throw error;
  }

  return normalizeTavoConfig(loaded?.config);
}

const tavoConfigCache = new Map<
  string,
  { mode: string; pending: Promise<TavoConfig> }
>();

/** Loads the root `tavo.config.ts` default export once for the current process. */
export async function loadTavoConfig(
  rootDir = ".",
  options: LoadTavoConfigOptions = {},
): Promise<TavoConfig> {
  const runtimeImport = new Function(
    "specifier",
    "return import(specifier);",
  ) as (specifier: string) => Promise<any>;
  const [pathModule, fsModule] = await Promise.all([
    runtimeImport("node:path"),
    runtimeImport("node:fs/promises"),
  ]);
  const resolvedRootDir = pathModule.resolve(rootDir);
  const processEnv = (
    globalThis as unknown as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process?.env;
  const mode =
    options.mode?.trim()
    || processEnv?.NODE_ENV?.trim()
    || "production";
  const cached = tavoConfigCache.get(resolvedRootDir);
  if (cached) {
    if (cached.mode !== mode) {
      throw new Error(
        `tavo config: ${resolvedRootDir} was already evaluated in `
        + `${cached.mode} mode and cannot be reevaluated in ${mode} mode `
        + "in the same process.",
      );
    }
    return cached.pending;
  }

  const pending = (async () => {
    loadServerEnv({ root: resolvedRootDir, mode });
    const absolute = pathModule.resolve(resolvedRootDir, "tavo.config.ts");
    try {
      await fsModule.access(absolute);
    } catch {
      throw new Error(
        `tavo config: expected ${absolute}. Every Tavo project must define `
        + "one root tavo.config.ts file.",
      );
    }
    return loadTypeScriptTavoConfig(absolute, resolvedRootDir, mode);
  })();
  tavoConfigCache.set(resolvedRootDir, { mode, pending });
  try {
    return await pending;
  } catch (error) {
    if (tavoConfigCache.get(resolvedRootDir)?.pending === pending) {
      tavoConfigCache.delete(resolvedRootDir);
    }
    throw error;
  }
}
