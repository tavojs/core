import { TavoError } from "../diagnostics.js";
import { compilePluginGraph } from "../plugins/compiler.js";
import type {
  PluginCompileOptions,
  PluginResolveContext,
  TavoPluginInput,
  TavoPluginPhase,
} from "../plugins/types.js";
import type { TavoViteConfig } from "./types.js";
import { resolveUrlPolicy } from "../router/url-policy.js";

function orderPluginBuildItems(
  items: readonly {
    id: string;
    before?: readonly string[];
    after?: readonly string[];
  }[],
) {
  const byId = new Map(items.map((item) => [item.id, item]));
  const visited = new Set<string>();
  const output: (typeof items)[number][] = [];
  const visit = (item: (typeof items)[number]) => {
    if (visited.has(item.id)) return;
    for (const id of item.after ?? []) visit(byId.get(id)!);
    for (const candidate of items) {
      if ((candidate.before ?? []).includes(item.id)) visit(candidate);
    }
    visited.add(item.id);
    output.push(item);
  };
  for (const item of items) visit(item);
  return output;
}

function appAllows(
  graph: ReturnType<typeof compilePluginGraph>,
  kind: "alias" | "define",
  key: string,
  owner: string,
): boolean {
  return Boolean(
    graph.overrides.some(
      (override) =>
        override.kind === kind &&
        override.key === key &&
        `${override.replace.plugin}#${override.replace.instanceId ?? "default"}` ===
          owner &&
        override.with.owner === "app",
    ),
  );
}

/** Applies validated declarative plugin build contributions. */
export async function applyPluginBuildConfig<T extends TavoViteConfig>(
  config: T,
  plugins?: TavoPluginInput,
  options?: PluginCompileOptions,
): Promise<T> {
  const graph = compilePluginGraph(plugins);
  const urlPolicy = resolveUrlPolicy(options?.routing);
  const aliases = Object.fromEntries(
    Array.from(graph.buildAliases, ([key, contribution]) => [
      key,
      contribution.value,
    ]),
  );
  const defines = Object.fromEntries(
    Array.from(graph.buildDefines, ([key, contribution]) => [
      key,
      contribution.value,
    ]),
  );
  const vitePlugins: unknown[] = [];

  for (const item of graph.plugins) {
    if (!item.plugin.build) continue;
    const loaded = await item.plugin.build();
    const phase: TavoPluginPhase =
      "default" in loaded ? loaded.default : loaded;
    const implementations = phase.build?.plugins ?? {};
    const declarations = item.plugin.manifest.build?.plugins ?? [];
    const declared = new Set(declarations.map((entry) => entry.id));
    for (const { id } of orderPluginBuildItems(declarations)) {
      if (!(id in implementations)) {
        throw new TavoError(
          "TAVO_PLUGIN_007",
          `Plugin "${item.owner}" does not implement declared build plugin "${id}".`,
        );
      }
      vitePlugins.push(implementations[id]);
    }
    for (const id of Object.keys(implementations)) {
      if (!declared.has(id)) {
        throw new TavoError(
          "TAVO_PLUGIN_007",
          `Plugin "${item.owner}" implements undeclared build plugin "${id}".`,
        );
      }
    }
    const context: PluginResolveContext = {
      instanceId: item.instanceId,
      urlPolicy,
      resolve() {
        throw new TavoError(
          "TAVO_PLUGIN_008",
          `Build phase for plugin "${item.owner}" cannot resolve runtime capabilities.`,
        );
      },
      tryResolve() {
        return undefined;
      },
    };
    await phase.setup?.(context);
  }

  const currentResolve =
    config.resolve && typeof config.resolve === "object"
      ? (config.resolve as Record<string, unknown>)
      : {};
  const currentAlias = currentResolve.alias;
  const currentAliasKeys = new Set<string>();
  if (Array.isArray(currentAlias)) {
    for (const entry of currentAlias) {
      if (
        entry &&
        typeof entry === "object" &&
        typeof entry.find === "string"
      ) {
        currentAliasKeys.add(entry.find);
      }
    }
  } else if (currentAlias && typeof currentAlias === "object") {
    for (const key of Object.keys(currentAlias)) currentAliasKeys.add(key);
  }
  for (const key of currentAliasKeys) {
    const contribution = graph.buildAliases.get(key);
    if (contribution && !appAllows(graph, "alias", key, contribution.owner)) {
      throw new TavoError(
        "TAVO_PLUGIN_003",
        `Build alias "${key}" collides with application Vite config.`,
      );
    }
  }

  const currentDefines =
    config.define && typeof config.define === "object"
      ? (config.define as Record<string, unknown>)
      : {};
  for (const key of Object.keys(currentDefines)) {
    const contribution = graph.buildDefines.get(key);
    if (contribution && !appAllows(graph, "define", key, contribution.owner)) {
      throw new TavoError(
        "TAVO_PLUGIN_003",
        `Build define "${key}" collides with application Vite config.`,
      );
    }
  }

  const pluginAliasEntries = Object.entries(aliases).map(
    ([find, replacement]) => ({ find, replacement }),
  );
  const mergedAlias = Array.isArray(currentAlias)
    ? [...pluginAliasEntries, ...currentAlias]
    : currentAlias && typeof currentAlias === "object"
      ? { ...aliases, ...(currentAlias as Record<string, string>) }
      : aliases;
  const currentPlugins = Array.isArray(config.plugins)
    ? config.plugins.filter(Boolean)
    : config.plugins
      ? [config.plugins]
      : [];
  return {
    ...config,
    resolve: { ...currentResolve, alias: mergedAlias },
    define: { ...defines, ...currentDefines },
    plugins: [...currentPlugins, ...vitePlugins],
  } as T;
}
