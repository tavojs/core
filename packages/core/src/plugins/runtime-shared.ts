import { TavoError } from "../diagnostics.js";
import type { AnyRecord } from "../framework/types.js";
import type { Store } from "../store/index.js";
import { normalizePath, ownedTokenKey, tokenKey } from "./internal.js";
import type {
  AnyPluginToken,
  CompiledPlugin,
  CompiledPluginGraph,
  PluginCapabilityResolver,
  PluginCapabilityToken,
  PluginPhaseLoader,
  PluginStoreToken,
  TavoPlugin,
  TavoPluginManifest,
  TavoPluginPhase,
} from "./types.js";
import type { ResolvedUrlPolicy } from "../router/url-policy.js";

export function unwrapPhase(
  value: TavoPluginPhase | { default: TavoPluginPhase },
): TavoPluginPhase {
  return "default" in value ? value.default : value;
}

export function phaseTarget(): "client" | "server" {
  return typeof window === "undefined" ? "server" : "client";
}

export function phaseLoader(plugin: TavoPlugin): PluginPhaseLoader | undefined {
  return phaseTarget() === "server" ? plugin.server : plugin.client;
}

export function assertPhaseKeys(
  owner: string,
  manifest: TavoPluginManifest,
  phase: TavoPluginPhase,
): void {
  const declared = {
    capabilities: new Set(
      (manifest.provides ?? [])
        .filter((token) => token.kind === "capability")
        .map((token) => token.name),
    ),
    stores: new Set((manifest.stores ?? []).map((token) => token.name)),
    pages: new Set((manifest.pages ?? []).map((item) => item.id)),
    endpoints: new Set((manifest.endpoints ?? []).map((item) => item.id)),
    middleware: new Set((manifest.middleware ?? []).map((item) => item.id)),
    head: new Set((manifest.head ?? []).map((item) => item.id)),
  };
  for (const kind of Object.keys(declared) as Array<keyof typeof declared>) {
    const implemented = new Set(Object.keys(phase[kind] ?? {}));
    for (const key of declared[kind])
      if (!implemented.has(key))
        throw new TavoError(
          "TAVO_PLUGIN_007",
          `Plugin "${owner}" does not implement declared ${kind} "${key}".`,
        );
    for (const key of implemented)
      if (!declared[kind].has(key))
        throw new TavoError(
          "TAVO_PLUGIN_007",
          `Plugin "${owner}" implements undeclared ${kind} "${key}".`,
        );
  }
}

export function routePathToFile(owner: string, path: string): string {
  const segments = normalizePath(path)
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (segment.startsWith(":")) return `[${segment.slice(1)}]`;
      return segment;
    });
  const suffix = segments.length === 0 ? "index" : segments.join("/");
  return `/src/pages/__plugins/${owner.replace(/[^a-zA-Z0-9_-]/g, "_")}/${suffix}.tsx`;
}

export type RuntimeState = {
  urlPolicy: ResolvedUrlPolicy;
  values: Map<string, unknown>;
  requestFactories: Map<string, (context: any) => unknown>;
  phases: Map<string, TavoPluginPhase>;
  disposers: Array<() => Promise<void>>;
};

export function serializePluginStores(
  graph: CompiledPluginGraph,
  state: RuntimeState,
): Readonly<Record<string, unknown>> {
  const output: Record<string, unknown> = {};
  for (const plugin of graph.plugins) {
    for (const token of plugin.plugin.manifest.stores ?? []) {
      if (!token.hydrate) continue;
      const store = state.values.get(ownedTokenKey(plugin.owner, token)) as
        | Store<AnyRecord>
        | undefined;
      if (!store) continue;
      const value = store.getState();
      if (!token.validate?.(value))
        throw new TavoError(
          "TAVO_PLUGIN_007",
          `Hydrated store "${plugin.owner}:${token.name}" produced invalid state.`,
        );
      output[`${plugin.owner}:${token.name}`] = token.serialize!(value);
    }
  }
  return output;
}

export function hydratePluginStores(
  graph: CompiledPluginGraph,
  state: RuntimeState,
  payload: unknown,
): void {
  if (payload === undefined || payload === null) return;
  if (typeof payload !== "object" || Array.isArray(payload))
    throw new TavoError(
      "TAVO_PLUGIN_007",
      "Plugin hydration state must be an object.",
    );
  const values = payload as Record<string, unknown>;
  for (const plugin of graph.plugins) {
    for (const token of plugin.plugin.manifest.stores ?? []) {
      if (!token.hydrate) continue;
      const key = `${plugin.owner}:${token.name}`;
      if (!(key in values)) continue;
      const next = token.deserialize!(values[key]);
      if (!token.validate?.(next))
        throw new TavoError(
          "TAVO_PLUGIN_007",
          `Hydration state for store "${key}" is invalid.`,
        );
      const store = state.values.get(ownedTokenKey(plugin.owner, token)) as
        | Store<AnyRecord>
        | undefined;
      if (!store)
        throw new TavoError(
          "TAVO_PLUGIN_007",
          `Hydrated store "${key}" is not initialized.`,
        );
      store.setState(next);
    }
  }
}

export function readDocumentPluginState(): unknown {
  if (typeof document === "undefined") return undefined;
  const script = document.getElementById("__TAVO_STATE__");
  if (!script?.textContent) return undefined;
  try {
    return (JSON.parse(script.textContent) as { pluginState?: unknown })
      .pluginState;
  } catch {
    return undefined;
  }
}

export function resolveOwnerForToken(
  graph: CompiledPluginGraph,
  consumer: CompiledPlugin | undefined,
  token: AnyPluginToken,
): string {
  if (consumer?.id === token.provider) {
    const ownTokens = [
      ...(consumer.plugin.manifest.provides ?? []),
      ...(consumer.plugin.manifest.stores ?? []),
    ];
    if (ownTokens.some((candidate) => tokenKey(candidate) === tokenKey(token)))
      return consumer.owner;
    throw new TavoError(
      "TAVO_PLUGIN_004",
      `Plugin "${consumer.owner}" attempted to resolve undeclared local capability "${token.name}".`,
    );
  }
  if (consumer) {
    const dependency = consumer.dependencies
      .map((owner) => graph.plugins.find((plugin) => plugin.owner === owner))
      .find((plugin) => plugin?.id === token.provider);
    const requirement = consumer.plugin.manifest.dependencies?.find(
      (candidate) =>
        candidate.id === token.provider &&
        (!candidate.instanceId ||
          candidate.instanceId === dependency?.instanceId),
    );
    if (
      dependency &&
      requirement?.capabilities?.some(
        (candidate) => tokenKey(candidate) === tokenKey(token),
      )
    )
      return dependency.owner;
    throw new TavoError(
      "TAVO_PLUGIN_004",
      `Plugin "${consumer.owner}" attempted to resolve undeclared provider "${token.provider}".`,
    );
  }
  const candidates = graph.plugins.filter(
    (plugin) => plugin.id === token.provider,
  );
  return (
    (
      candidates.find((plugin) => plugin.instanceId === "default") ??
      (candidates.length === 1 ? candidates[0] : undefined)
    )?.owner ??
    (() => {
      throw new TavoError(
        "TAVO_PLUGIN_004",
        `Capability provider "${token.provider}" is missing or ambiguous.`,
      );
    })()
  );
}

export function runtimeResolver(
  graph: CompiledPluginGraph,
  state: RuntimeState,
  consumer?: CompiledPlugin,
): PluginCapabilityResolver {
  return {
    resolve<T>(
      token: PluginCapabilityToken<T, "runtime"> | PluginStoreToken<any>,
    ): T {
      const owner = resolveOwnerForToken(graph, consumer, token);
      const key = ownedTokenKey(owner, token);
      if (!state.values.has(key))
        throw new TavoError(
          "TAVO_PLUGIN_004",
          `Runtime capability "${token.provider}:${token.name}" is unavailable.`,
        );
      return state.values.get(key) as T;
    },
    tryResolve<T>(
      token: PluginCapabilityToken<T, "runtime"> | PluginStoreToken<any>,
    ): T | undefined {
      try {
        return this.resolve(token);
      } catch {
        return undefined;
      }
    },
  };
}

export function disposable(value: unknown): (() => Promise<void>) | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as {
    dispose?: () => unknown;
    [Symbol.asyncDispose]?: () => PromiseLike<void>;
    [Symbol.dispose]?: () => void;
  };
  if (typeof candidate[Symbol.asyncDispose] === "function")
    return async () => {
      await candidate[Symbol.asyncDispose]!();
    };
  if (typeof candidate[Symbol.dispose] === "function")
    return async () => {
      candidate[Symbol.dispose]!();
    };
  if (typeof candidate.dispose === "function")
    return async () => {
      await candidate.dispose!();
    };
  return undefined;
}
