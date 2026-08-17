import { TavoError } from "../diagnostics.js";
import type { AnyRecord, PageModule } from "../framework/types.js";
import { renderToString } from "../render/static.js";
import { createStore, type Store } from "../store/index.js";
import { compilePluginGraph } from "./compiler.js";
import { isPromiseLike, ownedTokenKey } from "./internal.js";
import { createRequestScope } from "./request.js";
import {
  assertPhaseKeys,
  disposable,
  hydratePluginStores,
  phaseLoader,
  readDocumentPluginState,
  routePathToFile,
  runtimeResolver,
  serializePluginStores,
  unwrapPhase,
  type RuntimeState,
} from "./runtime-shared.js";
import type {
  CompiledPluginGraph,
  PluginCompileOptions,
  PluginResolveContext,
  TavoPluginPhase,
  TavoPluginRuntime,
  TavoPluginInput,
} from "./types.js";
import { resolveUrlPolicy } from "../router/url-policy.js";

async function initializeRuntime(
  graph: CompiledPluginGraph,
  options?: PluginCompileOptions,
): Promise<TavoPluginRuntime> {
  const urlPolicy = resolveUrlPolicy(options?.routing);
  const state: RuntimeState = {
    urlPolicy,
    values: new Map(),
    requestFactories: new Map(),
    phases: new Map(),
    disposers: [],
  };
  const runtime: TavoPluginRuntime = {
    graph,
    routeModules: {},
    pageMiddlewareBeforeApp: [],
    pageMiddlewareAfterApp: [],
    serverMiddleware: [],
    head: [],
    unsafeHeadHtml: [],
    serverRoutes: [],
    diagnostics: [...graph.diagnostics],
    capabilities: runtimeResolver(graph, state),
    createRequestScope(request) {
      return createRequestScope(graph, state, request);
    },
    serializeHydrationState() {
      return serializePluginStores(graph, state);
    },
    hydrate(payload) {
      hydratePluginStores(graph, state, payload);
    },
    async dispose() {
      for (const dispose of state.disposers.splice(0).reverse())
        await dispose();
    },
  };
  try {
    for (const plugin of graph.plugins) {
      const loader = phaseLoader(plugin.plugin);
      const phase = loader ? unwrapPhase(await loader()) : {};
      assertPhaseKeys(plugin.owner, plugin.plugin.manifest, phase);
      state.phases.set(plugin.owner, phase);
      const context: PluginResolveContext = {
        instanceId: plugin.instanceId,
        urlPolicy,
        ...runtimeResolver(graph, state, plugin),
      };
      for (const token of plugin.plugin.manifest.provides ?? []) {
        if (token.kind !== "capability") continue;
        const factory = phase.capabilities?.[token.name];
        if (!factory) continue;
        const key = ownedTokenKey(plugin.owner, token);
        if (token.scope === "request")
          state.requestFactories.set(key, factory as any);
        else {
          const value = await (
            factory as (context: PluginResolveContext) => unknown
          )(context);
          state.values.set(key, value);
          const dispose = disposable(value);
          if (dispose) state.disposers.push(dispose);
        }
      }
      for (const token of plugin.plugin.manifest.stores ?? []) {
        const value = await phase.stores![token.name]!(context);
        const store =
          value && typeof (value as Store<AnyRecord>).getState === "function"
            ? value
            : createStore(value as AnyRecord);
        state.values.set(ownedTokenKey(plugin.owner, token), store);
      }
      for (const page of graph.pages.filter(
        (candidate) => candidate.owner === plugin.owner,
      )) {
        runtime.routeModules[routePathToFile(plugin.owner, page.path)] = phase
          .pages![page.id] as PageModule;
      }
      for (const entry of graph.middleware.filter(
        (candidate) => candidate.owner === plugin.owner,
      )) {
        const implementation = phase.middleware![entry.id]!;
        if (entry.target === "page") {
          const target =
            entry.stage === "page:before-app"
              ? runtime.pageMiddlewareBeforeApp
              : runtime.pageMiddlewareAfterApp;
          target.push(implementation as any);
        } else
          runtime.serverMiddleware.push({
            owner: plugin.owner,
            id: entry.id,
            handler: implementation as any,
          });
      }
      for (const entry of graph.head.filter(
        (candidate) => candidate.owner === plugin.owner,
      )) {
        const implementation = phase.head![entry.id]!;
        const value =
          typeof implementation === "function"
            ? await implementation(context)
            : implementation;
        if (typeof value === "string") {
          if (!entry.unsafeHeadHtml)
            throw new TavoError(
              "TAVO_PLUGIN_007",
              `Plugin "${plugin.owner}" head "${entry.id}" returned raw HTML without declaring unsafeHeadHtml.`,
            );
          runtime.unsafeHeadHtml.push(value);
        } else runtime.head.push(value);
      }
      for (const entry of graph.endpoints.filter(
        (candidate) => candidate.owner === plugin.owner,
      )) {
        runtime.serverRoutes.push({
          owner: plugin.owner,
          id: entry.id,
          methods: entry.methods,
          kind: entry.match.kind,
          path: entry.path,
          handler: phase.endpoints![entry.id]!,
          validateOrigin: entry.validateOrigin !== false,
        });
      }
      await phase.setup?.(context);
      if (phase.dispose)
        state.disposers.push(async () => {
          await phase.dispose!();
        });
    }
    runtime.hydrate(readDocumentPluginState());
    return runtime;
  } catch (cause) {
    await runtime.dispose().catch(() => undefined);
    if (cause instanceof TavoError) throw cause;
    throw new TavoError(
      "TAVO_PLUGIN_008",
      "Plugin runtime initialization failed.",
      { cause },
    );
  }
}

function initializeRuntimeSync(graph: CompiledPluginGraph): TavoPluginRuntime {
  let result: TavoPluginRuntime | undefined;
  let error: unknown;
  let synchronous = true;
  initializeRuntime(graph).then(
    (value) => {
      result = value;
    },
    (cause) => {
      error = cause;
    },
  );
  synchronous = false;
  if (!result && !error) {
    throw new TavoError(
      "TAVO_PLUGIN_008",
      "Synchronous plugin runtime creation cannot load phase modules or factories asynchronously. Use createPluginRuntimeAsync().",
    );
  }
  if (error) throw error;
  void synchronous;
  return result!;
}

// A genuinely synchronous path is kept separate because Promise callbacks never run inline.
function createRuntimeSync(graph: CompiledPluginGraph, options?: PluginCompileOptions): TavoPluginRuntime {
  const urlPolicy = resolveUrlPolicy(options?.routing);
  const state: RuntimeState = {
    urlPolicy,
    values: new Map(),
    requestFactories: new Map(),
    phases: new Map(),
    disposers: [],
  };
  const runtime: TavoPluginRuntime = {
    graph,
    routeModules: {},
    pageMiddlewareBeforeApp: [],
    pageMiddlewareAfterApp: [],
    serverMiddleware: [],
    head: [],
    unsafeHeadHtml: [],
    serverRoutes: [],
    diagnostics: [...graph.diagnostics],
    capabilities: runtimeResolver(graph, state),
    createRequestScope(request) {
      return createRequestScope(graph, state, request);
    },
    serializeHydrationState() {
      return serializePluginStores(graph, state);
    },
    hydrate(payload) {
      hydratePluginStores(graph, state, payload);
    },
    async dispose() {
      for (const dispose of state.disposers.splice(0).reverse())
        await dispose();
    },
  };
  try {
    for (const plugin of graph.plugins) {
      const loaded = phaseLoader(plugin.plugin)?.() ?? {};
      if (isPromiseLike(loaded))
        throw new TavoError(
          "TAVO_PLUGIN_008",
          `Plugin "${plugin.owner}" phase is async. Use createPluginRuntimeAsync().`,
        );
      const phase = unwrapPhase(
        loaded as TavoPluginPhase | { default: TavoPluginPhase },
      );
      assertPhaseKeys(plugin.owner, plugin.plugin.manifest, phase);
      state.phases.set(plugin.owner, phase);
      const context: PluginResolveContext = {
        instanceId: plugin.instanceId,
        urlPolicy,
        ...runtimeResolver(graph, state, plugin),
      };
      for (const token of plugin.plugin.manifest.provides ?? []) {
        if (token.kind !== "capability") continue;
        const factory = phase.capabilities![token.name]!;
        const key = ownedTokenKey(plugin.owner, token);
        if (token.scope === "request")
          state.requestFactories.set(key, factory as any);
        else {
          const value = factory(context as any);
          if (isPromiseLike(value))
            throw new TavoError(
              "TAVO_PLUGIN_008",
              `Plugin "${plugin.owner}" capability "${token.name}" is async.`,
            );
          state.values.set(key, value);
          const dispose = disposable(value);
          if (dispose) state.disposers.push(dispose);
        }
      }
      for (const token of plugin.plugin.manifest.stores ?? []) {
        const value = phase.stores![token.name]!(context);
        if (isPromiseLike(value))
          throw new TavoError(
            "TAVO_PLUGIN_008",
            `Plugin "${plugin.owner}" store "${token.name}" is async.`,
          );
        state.values.set(
          ownedTokenKey(plugin.owner, token),
          value && typeof (value as Store<AnyRecord>).getState === "function"
            ? value
            : createStore(value as AnyRecord),
        );
      }
      for (const page of graph.pages.filter(
        (candidate) => candidate.owner === plugin.owner,
      ))
        runtime.routeModules[routePathToFile(plugin.owner, page.path)] = phase
          .pages![page.id] as PageModule;
      for (const entry of graph.middleware.filter(
        (candidate) => candidate.owner === plugin.owner,
      )) {
        if (entry.target === "page") {
          const target =
            entry.stage === "page:before-app"
              ? runtime.pageMiddlewareBeforeApp
              : runtime.pageMiddlewareAfterApp;
          target.push(phase.middleware![entry.id]! as any);
        } else
          runtime.serverMiddleware.push({
            owner: plugin.owner,
            id: entry.id,
            handler: phase.middleware![entry.id]! as any,
          });
      }
      for (const entry of graph.head.filter(
        (candidate) => candidate.owner === plugin.owner,
      )) {
        const implementation = phase.head![entry.id]!;
        const value =
          typeof implementation === "function"
            ? implementation(context)
            : implementation;
        if (isPromiseLike(value))
          throw new TavoError(
            "TAVO_PLUGIN_008",
            `Plugin "${plugin.owner}" head "${entry.id}" is async.`,
          );
        if (typeof value === "string") {
          if (!entry.unsafeHeadHtml)
            throw new TavoError(
              "TAVO_PLUGIN_007",
              `Plugin "${plugin.owner}" head "${entry.id}" returned raw HTML without declaring unsafeHeadHtml.`,
            );
          runtime.unsafeHeadHtml.push(value);
        } else runtime.head.push(value);
      }
      for (const entry of graph.endpoints.filter(
        (candidate) => candidate.owner === plugin.owner,
      ))
        runtime.serverRoutes.push({
          owner: plugin.owner,
          id: entry.id,
          methods: entry.methods,
          kind: entry.match.kind,
          path: entry.path,
          handler: phase.endpoints![entry.id]!,
          validateOrigin: entry.validateOrigin !== false,
        });
      const setup = phase.setup?.(context);
      if (isPromiseLike(setup))
        throw new TavoError(
          "TAVO_PLUGIN_008",
          `Plugin "${plugin.owner}" setup is async.`,
        );
      if (phase.dispose)
        state.disposers.push(async () => {
          await phase.dispose!();
        });
    }
    runtime.hydrate(readDocumentPluginState());
    return runtime;
  } catch (cause) {
    void runtime.dispose();
    if (cause instanceof TavoError) throw cause;
    throw new TavoError(
      "TAVO_PLUGIN_008",
      "Plugin runtime initialization failed.",
      { cause },
    );
  }
}

/** Creates a synchronous runtime for synchronous phase modules and factories. */
export function createPluginRuntime(
  config: TavoPluginInput = [],
  options?: PluginCompileOptions,
): TavoPluginRuntime {
  return createRuntimeSync(compilePluginGraph(config, options), options);
}

/** Creates an async-capable plugin runtime. */
export async function createPluginRuntimeAsync(
  config: TavoPluginInput = [],
  options?: PluginCompileOptions,
): Promise<TavoPluginRuntime> {
  return initializeRuntime(compilePluginGraph(config, options), options);
}

/** Serializes validated plugin head contributions. */
export function renderPluginHead(runtime: TavoPluginRuntime): string {
  return `${runtime.unsafeHeadHtml.join("")}${runtime.head.map((node) => renderToString(node)).join("")}`;
}
