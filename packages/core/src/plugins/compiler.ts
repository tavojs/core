import {
  inspectInternal,
  type InternalCompiledPluginGraph,
} from "./compiler-graph.js";
import { inspectDeclaredAuthority } from "./authority.js";
import { ownerOf, pluginError } from "./internal.js";
import type {
  CompiledPluginGraph,
  PluginCompileOptions,
  PluginGraphInspection,
  TavoPluginInput,
} from "./types.js";

function immutableMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  const map = new Map(source);
  return Object.freeze({
    get size() {
      return map.size;
    },
    get: map.get.bind(map),
    has: map.has.bind(map),
    forEach: map.forEach.bind(map),
    entries: map.entries.bind(map),
    keys: map.keys.bind(map),
    values: map.values.bind(map),
    [Symbol.iterator]: map[Symbol.iterator].bind(map),
  });
}

function freezeGraph(graph: InternalCompiledPluginGraph): CompiledPluginGraph {
  const { mounts: _internalMounts, ...publicGraph } = graph;
  return Object.freeze({
    ...publicGraph,
    plugins: Object.freeze(
      graph.plugins.map((item) =>
        Object.freeze({
          ...item,
          dependencies: Object.freeze([...item.dependencies]),
        }),
      ),
    ),
    diagnostics: Object.freeze([...graph.diagnostics]),
    capabilities: immutableMap(graph.capabilities),
    pages: Object.freeze(graph.pages.map((item) => Object.freeze({ ...item }))),
    endpoints: Object.freeze(
      graph.endpoints.map((item) =>
        Object.freeze({ ...item, methods: Object.freeze([...item.methods]) }),
      ),
    ),
    middleware: Object.freeze(
      graph.middleware.map((item) => Object.freeze({ ...item })),
    ),
    head: Object.freeze(graph.head.map((item) => Object.freeze({ ...item }))),
    buildAliases: immutableMap(graph.buildAliases),
    buildDefines: immutableMap(graph.buildDefines),
    overrides: Object.freeze(
      graph.overrides.map((item) =>
        Object.freeze({
          ...item,
          replace: Object.freeze({ ...item.replace }),
          with: Object.freeze({ ...item.with }),
        }),
      ),
    ),
  });
}

/** Compiles and validates an immutable plugin ownership graph. */
export function compilePluginGraph(
  config: TavoPluginInput = [],
  options?: PluginCompileOptions,
): CompiledPluginGraph {
  const result = inspectInternal(config, options);
  const firstError = result.diagnostics.find(
    (item) => item.severity === "error",
  );
  if (firstError) throw pluginError(firstError);
  return freezeGraph(result.graph);
}

/** Returns a serializable inspection without executing plugin code. */
export function inspectPluginGraph(
  config: TavoPluginInput = [],
  options?: PluginCompileOptions,
): PluginGraphInspection {
  const { graph, diagnostics } = inspectInternal(config, options);
  const authority = inspectDeclaredAuthority(graph, graph.mounts);
  return {
    valid: !diagnostics.some((item) => item.severity === "error"),
    diagnostics,
    plugins: graph.plugins.map(
      ({ owner, id, instanceId, version, dependencies }) => ({
        owner,
        id,
        instanceId,
        version,
        dependencies,
      }),
    ),
    capabilities: Array.from(graph.capabilities, ([key, owner]) => ({
      key,
      owner,
    })),
    pages: graph.pages.map(({ owner, id, path }) => ({ owner, id, path })),
    endpoints: graph.endpoints.map((endpoint) => ({
      owner: endpoint.owner,
      id: endpoint.id,
      methods: endpoint.methods,
      kind: endpoint.match.kind,
      path: endpoint.path,
    })),
    middleware: graph.middleware.map((entry) => ({
      owner: entry.owner,
      id: entry.id,
      stage: entry.stage,
    })),
    head: graph.head.map((entry) => ({
      owner: entry.owner,
      id: entry.id,
      key: entry.key,
      cardinality: entry.cardinality,
    })),
    buildAliases: Array.from(graph.buildAliases, ([key, value]) => ({
      key,
      ...value,
    })),
    buildDefines: Array.from(graph.buildDefines, ([key, value]) => ({
      key,
      ...value,
    })),
    mounts: graph.mounts.map((mount) => ({
      owner: ownerOf(mount.plugin, mount.instanceId ?? "default"),
      target: mount.kind,
      from: mount.from ?? "/",
      to: mount.to,
    })),
    overrides: graph.overrides,
    permissions: authority.permissions,
    exposure: authority.exposure,
  };
}
