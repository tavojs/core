import type { ExactTavoConfig, TavoViteConfig, TavoViteConfigEnv, TavoViteConfigExport, ViteEsbuildOptions } from "./types.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyPluginBuildConfig } from "./plugin-build.js";
import { createSvgComponentPlugin } from "./svg-component.js";
import { createServerOnlyGuardPlugin } from "./server-only.js";
import { createRouteServerExportsPlugin } from "./route-server-exports.js";
import { createI18nSplitPlugin } from "./i18n-split.js";
import { loadTavoConfig } from "./load.js";

export type { ExactTavoConfig, TavoConfig, TavoViteConfig, TavoViteConfigEnv, TavoViteConfigExport, ViteEsbuildOptions } from "./types.js";
export { defineConfig } from "./define.js";

type ViteAlias = { find: string | RegExp; replacement: string } | Record<string, string>;

const packageRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const localSourceRoot = path.join(packageRootDir, "src");

/** Returns true when this local package includes source files that Vite can alias to during linked development. */
function hasLocalFrameworkSource(): boolean {
  return fs.existsSync(path.join(localSourceRoot, "index.tsx"));
}

/** Converts Vite alias config into a flat list that can be appended safely. */
function normalizeAliases(value: unknown): ViteAlias[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value as ViteAlias[];
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([find, replacement]) => ({ find, replacement }));
  }
  return [];
}

function normalizeVitePlugins(value: unknown): unknown[] {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

/** Adds source aliases for linked local framework development so SSR uses one coherent module graph. */
function withTavoSourceAliases<T extends TavoViteConfig>(config: T): T {
  if (!hasLocalFrameworkSource()) {
    return config;
  }

  const existingResolve = config.resolve && typeof config.resolve === "object" ? (config.resolve as Record<string, unknown>) : {};
  const alias = normalizeAliases(existingResolve.alias);
  const sourceAliases: ViteAlias[] = [
    {
      find: "@tavojs/core/dev",
      replacement: path.join(localSourceRoot, "dev.browser.ts"),
    },
    {
      find: "@tavojs/core/router",
      replacement: path.join(localSourceRoot, "router", "index.ts"),
    },
    {
      find: "@tavojs/core/server",
      replacement: path.join(localSourceRoot, "server.ts"),
    },
    {
      find: "@tavojs/core/server-only",
      replacement: path.join(localSourceRoot, "server-only.ts"),
    },
    {
      find: "@tavojs/core/config",
      replacement: path.join(localSourceRoot, "config", "browser.ts"),
    },
    {
      find: "@tavojs/core/plugin",
      replacement: path.join(localSourceRoot, "plugins", "index.ts"),
    },
    {
      find: "@tavojs/core/jsx-runtime",
      replacement: path.join(localSourceRoot, "jsx-runtime.ts"),
    },
    {
      find: "@tavojs/core/jsx-dev-runtime",
      replacement: path.join(localSourceRoot, "jsx-dev-runtime.ts"),
    },
    {
      find: /^@tavojs\/core$/,
      replacement: path.join(localSourceRoot, "index.browser.ts"),
    },
  ];

  return {
    ...config,
    resolve: {
      ...existingResolve,
      alias: [...sourceAliases, ...alias],
    },
  } as T;
}

/** Checks whether a Vite config result should be resolved asynchronously. */
function isPromiseLike(value: unknown): value is Promise<TavoViteConfig> {
  return Boolean(value && typeof value === "object" && "then" in value);
}

/** Lets Tavo.js plugins extend Vite config while keeping app config in `tavo.config`. */
async function withTavoPluginViteConfig<T extends TavoViteConfig>(config: T, env: TavoViteConfigEnv): Promise<T> {
  const root = typeof config.root === "string" ? config.root : ".";
  const tavoConfig = await loadTavoConfig(root, { mode: env.mode });
  const resolved = await applyPluginBuildConfig(config, tavoConfig.plugins, {
    routing: tavoConfig.routing,
  });
  const define = resolved.define && typeof resolved.define === "object"
    ? resolved.define as Record<string, unknown>
    : {};
  return {
    ...resolved,
    define: {
      ...define,
      "__TAVO_TRAILING_SLASH__": JSON.stringify(
        tavoConfig.routing?.trailingSlash ?? "preserve",
      ),
    },
  } as T;
}

/** Applies Tavo.js's JSX runtime settings to a plain Vite config object. */
function withTavoViteDefaults<T extends TavoViteConfig>(
  config: T,
): T & {
  esbuild: ViteEsbuildOptions & {
    jsx: "automatic";
    jsxImportSource: "@tavojs/core";
  };
} {
  const esbuild = config.esbuild && typeof config.esbuild === "object" ? config.esbuild : {};
  const withAliases = withTavoSourceAliases(config);
  const build = withAliases.build && typeof withAliases.build === "object" ? (withAliases.build as Record<string, unknown>) : {};

  return {
    ...withAliases,
    plugins: [
      createRouteServerExportsPlugin(),
      createServerOnlyGuardPlugin(),
      createSvgComponentPlugin(),
      createI18nSplitPlugin(),
      ...normalizeVitePlugins(withAliases.plugins),
    ],
    build: {
      ...build,
      emptyOutDir: build.emptyOutDir ?? true,
    },
    esbuild: {
      ...esbuild,
      jsx: "automatic",
      jsxImportSource: "@tavojs/core",
    },
  } as T & {
    esbuild: ViteEsbuildOptions & {
      jsx: "automatic";
      jsxImportSource: "@tavojs/core";
    };
  };
}

/** Defines a Vite config with the JSX runtime settings required by Tavo.js. */
export function defineTavoViteConfig(config: TavoViteConfigExport = {}): TavoViteConfigExport {
  if (typeof config === "function") {
    return (env: TavoViteConfigEnv) => {
      const result = config(env);

      return isPromiseLike(result)
        ? result.then((resolved) => withTavoPluginViteConfig(resolved, env)).then(withTavoViteDefaults)
        : withTavoPluginViteConfig(result, env).then(withTavoViteDefaults);
    };
  }

  const env: TavoViteConfigEnv = {};
  return isPromiseLike(config)
    ? config.then((resolved) => withTavoPluginViteConfig(resolved, env)).then(withTavoViteDefaults)
    : withTavoPluginViteConfig(config, env).then(withTavoViteDefaults);
}
