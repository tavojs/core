import { TavoError } from "../diagnostics.js";
import { ownedTokenKey } from "./internal.js";
import {
  assertRuntimeActive,
  disposable,
  drainDisposers,
  resolveOwnerForToken,
  runtimeResolver,
  type RuntimeState,
} from "./runtime-shared.js";
import type {
  CompiledPlugin,
  CompiledPluginGraph,
  PluginCapabilityToken,
  PluginRequestScope,
  PluginStoreToken,
} from "./types.js";

export type InternalRequestScope = PluginRequestScope & {
  contextFor(owner: string): {
    request: Request;
    params: Record<string, string>;
    instanceId: string;
    urlPolicy: PluginRequestScope["urlPolicy"];
    resolve: PluginRequestScope["resolve"];
    tryResolve: PluginRequestScope["tryResolve"];
  };
};

type Resolution = {
  active: boolean;
  promise: Promise<unknown>;
  dependencies: Map<Resolution, number>;
};

function reaches(from: Resolution, target: Resolution, seen = new Set<Resolution>()): boolean {
  if (from === target) return true;
  if (seen.has(from)) return false;
  seen.add(from);
  for (const dependency of from.dependencies.keys()) {
    if (reaches(dependency, target, seen)) return true;
  }
  return false;
}

function disposedScopeError(): TavoError {
  return new TavoError("TAVO_PLUGIN_009", "Plugin request scope has been disposed.");
}

export function createRequestScope(
  graph: CompiledPluginGraph,
  state: RuntimeState,
  request: Request,
): InternalRequestScope {
  assertRuntimeActive(state);
  const values = new Map<string, unknown>();
  const pending = new Map<string, Resolution>();
  const disposers: Array<() => Promise<void>> = [];
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const resolveFor = async <T>(
    consumer: CompiledPlugin | undefined,
    token: PluginCapabilityToken<T, any> | PluginStoreToken<any>,
    requester?: Resolution,
  ): Promise<T> => {
    if (disposed) throw disposedScopeError();
    assertRuntimeActive(state);
    const owner = resolveOwnerForToken(graph, consumer, token);
    const key = ownedTokenKey(owner, token);
    if (token.scope === "runtime")
      return runtimeResolver(graph, state, consumer).resolve(token as any) as T;
    if (values.has(key)) return values.get(key) as T;
    let resolution = pending.get(key);
    if (!resolution) {
      const factory = state.requestFactories.get(key);
      if (!factory)
        throw new TavoError(
          "TAVO_PLUGIN_004",
          `Request capability "${token.provider}:${token.name}" is unavailable.`,
        );
      const provider = graph.plugins.find((item) => item.owner === owner);
      const current: Resolution = {
        active: true,
        promise: Promise.resolve(),
        dependencies: new Map(),
      };
      const providerResolve = <V>(candidate: PluginCapabilityToken<V, any> | PluginStoreToken<any>) =>
        resolveFor<V>(provider, candidate, current);
      // Install pending state before executing the factory, including synchronous
      // factories, so failures unwind and retries receive a fresh dependency node.
      current.promise = Promise.resolve().then(() => {
        if (disposed || state.disposed) throw disposedScopeError();
        return factory({
          request,
          instanceId: provider?.instanceId ?? "default",
          urlPolicy: state.urlPolicy,
          resolve: providerResolve,
          tryResolve: async <V>(candidate: PluginCapabilityToken<V, any> | PluginStoreToken<any>) => {
            try { return await providerResolve(candidate); } catch { return undefined; }
          },
        });
      }).then(async (value) => {
        const dispose = disposable(value);
        if (disposed || state.disposed) {
          if (dispose) await dispose();
          throw disposedScopeError();
        }
        values.set(key, value);
        if (dispose) disposers.push(dispose);
        return value;
      }).finally(() => {
        current.active = false;
        current.dependencies.clear();
        pending.delete(key);
      });
      pending.set(key, current);
      resolution = current;
    }
    // The graph follows provider-to-provider dependencies, rather than treating
    // every concurrent request for a shared pending value as a cycle.
    const parent = requester?.active ? requester : undefined;
    if (parent) {
      if (reaches(resolution, parent))
        throw new TavoError(
          "TAVO_PLUGIN_005",
          `Request capability cycle detected at "${token.provider}:${token.name}".`,
        );
      parent.dependencies.set(resolution, (parent.dependencies.get(resolution) ?? 0) + 1);
    }
    try {
      const value = await resolution.promise as T;
      if (disposed || state.disposed) throw disposedScopeError();
      return value;
    } finally {
      if (parent) {
        const remaining = (parent.dependencies.get(resolution) ?? 1) - 1;
        if (remaining) parent.dependencies.set(resolution, remaining);
        else parent.dependencies.delete(resolution);
      }
    }
  };
  return {
    request,
    urlPolicy: state.urlPolicy,
    resolve: (token) => resolveFor(undefined, token),
    tryResolve: async (token) => {
      try { return await resolveFor(undefined, token); } catch { return undefined; }
    },
    dispose() {
      if (!disposal) {
        disposed = true;
        values.clear();
        disposal = Promise.resolve().then(() => drainDisposers(disposers, "Plugin request scope disposal failed."));
      }
      return disposal;
    },
    contextFor(owner) {
      const consumer = graph.plugins.find((plugin) => plugin.owner === owner);
      if (!consumer)
        throw new TavoError("TAVO_PLUGIN_004", `Request context owner "${owner}" is unavailable.`);
      return {
        request,
        params: {},
        instanceId: consumer.instanceId,
        urlPolicy: state.urlPolicy,
        resolve: (token) => resolveFor(consumer, token),
        tryResolve: async (token) => {
          try { return await resolveFor(consumer, token); } catch { return undefined; }
        },
      };
    },
  };
}
