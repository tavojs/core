import { TavoError } from "../diagnostics.js";
import {
  forbiddenActionResponse,
  isUnsafeActionMethod,
  validateActionOrigin,
} from "../framework/runtime/actions.js";
import { diagnostic, ownedTokenKey } from "./internal.js";
import {
  disposable,
  resolveOwnerForToken,
  runtimeResolver,
  type RuntimeState,
} from "./runtime-shared.js";
import type {
  CompiledPlugin,
  CompiledPluginGraph,
  PluginCapabilityToken,
  PluginRequestScope,
  PluginRuntimeServerRoute,
  PluginStoreToken,
  TavoPluginRuntime,
} from "./types.js";

type InternalRequestScope = PluginRequestScope & {
  contextFor(owner: string): {
    request: Request;
    params: Record<string, string>;
    instanceId: string;
    resolve: PluginRequestScope["resolve"];
    tryResolve: PluginRequestScope["tryResolve"];
  };
};

export function createRequestScope(
  graph: CompiledPluginGraph,
  state: RuntimeState,
  request: Request,
): InternalRequestScope {
  const values = new Map<string, unknown>();
  const pending = new Map<string, Promise<unknown>>();
  const resolving = new Set<string>();
  const disposers: Array<() => Promise<void>> = [];
  const resolveFor = async <T>(
    consumer: CompiledPlugin | undefined,
    token: PluginCapabilityToken<T, any> | PluginStoreToken<any>,
  ): Promise<T> => {
    const owner = resolveOwnerForToken(graph, consumer, token);
    const key = ownedTokenKey(owner, token);
    if (token.scope === "runtime")
      return runtimeResolver(graph, state, consumer).resolve(token as any) as T;
    if (values.has(key)) return values.get(key) as T;
    if (pending.has(key)) return pending.get(key) as Promise<T>;
    if (resolving.has(key))
      throw new TavoError(
        "TAVO_PLUGIN_005",
        `Request capability cycle detected at "${token.provider}:${token.name}".`,
      );
    const factory = state.requestFactories.get(key);
    if (!factory)
      throw new TavoError(
        "TAVO_PLUGIN_004",
        `Request capability "${token.provider}:${token.name}" is unavailable.`,
      );
    const provider = graph.plugins.find((item) => item.owner === owner);
    const providerResolve = <V>(
      candidate: PluginCapabilityToken<V, any> | PluginStoreToken<any>,
    ) => resolveFor(provider, candidate);
    const providerTryResolve = async <V>(
      candidate: PluginCapabilityToken<V, any> | PluginStoreToken<any>,
    ) => {
      try {
        return await providerResolve(candidate);
      } catch {
        return undefined;
      }
    };
    resolving.add(key);
    const promise = Promise.resolve(
      factory({
        request,
        instanceId: provider?.instanceId ?? "default",
        resolve: providerResolve,
        tryResolve: providerTryResolve,
      }),
    ).then((value) => {
      values.set(key, value);
      const dispose = disposable(value);
      if (dispose) disposers.push(dispose);
      return value;
    });
    pending.set(key, promise);
    try {
      return (await promise) as T;
    } finally {
      pending.delete(key);
      resolving.delete(key);
    }
  };
  const resolve = <T>(
    token: PluginCapabilityToken<T, any> | PluginStoreToken<any>,
  ) => resolveFor<T>(undefined, token);
  const tryResolve = async <T>(
    token: PluginCapabilityToken<T, any> | PluginStoreToken<any>,
  ): Promise<T | undefined> => {
    try {
      return await resolveFor<T>(undefined, token);
    } catch {
      return undefined;
    }
  };
  return {
    request,
    resolve,
    tryResolve,
    async dispose() {
      for (const dispose of disposers.reverse()) await dispose();
    },
    contextFor(owner) {
      const consumer = graph.plugins.find((plugin) => plugin.owner === owner);
      if (!consumer)
        throw new TavoError(
          "TAVO_PLUGIN_004",
          `Request context owner "${owner}" is unavailable.`,
        );
      return {
        request,
        params: {},
        instanceId: consumer.instanceId,
        resolve: (token) => resolveFor(consumer, token),
        tryResolve: async (token) => {
          try {
            return await resolveFor(consumer, token);
          } catch {
            return undefined;
          }
        },
      };
    },
  };
}

function routeMatches(
  route: PluginRuntimeServerRoute,
  request: Request,
): boolean {
  if (!route.methods.includes(request.method.toUpperCase())) return false;
  const pathname = new URL(request.url).pathname;
  return route.kind === "exact"
    ? pathname === route.path
    : pathname === route.path || pathname.startsWith(`${route.path}/`);
}

function responseWithScopeDisposal(
  response: Response,
  dispose: () => Promise<void>,
): Response {
  if (!response.body) return response;
  const reader = response.body.getReader();
  let finished = false;
  const finish = async () => {
    if (finished) return;
    finished = true;
    await dispose();
  };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          await finish();
          controller.close();
        } else {
          controller.enqueue(chunk.value);
        }
      } catch (error) {
        await finish().catch(() => undefined);
        controller.error(error);
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason);
      } finally {
        await finish();
      }
    },
  });
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

/** Handles plugin middleware and the single most-specific terminal endpoint. */
export async function handlePluginRequest(
  runtime: TavoPluginRuntime,
  request: Request,
  options?: { trustedHosts?: string[]; rawRequest?: unknown },
): Promise<Response | null> {
  const scope = runtime.createRequestScope(request) as InternalRequestScope;
  let responseOwnsScope = false;
  const recordDisposalFailure = () => {
    runtime.diagnostics.push(
      diagnostic("TAVO_PLUGIN_009", "Plugin request scope disposal failed.", {
        phase: "dispose",
      }),
    );
  };
  const returnResponse = async (response: Response): Promise<Response> => {
    responseOwnsScope = true;
    if (!response.body) {
      await scope.dispose();
      return response;
    }
    return responseWithScopeDisposal(response, async () => {
      await scope.dispose().catch(recordDisposalFailure);
    });
  };
  try {
    for (const middleware of runtime.serverMiddleware) {
      const response = await middleware.handler(
        scope.contextFor(middleware.owner),
      );
      if (response) return await returnResponse(response);
    }
    const route = runtime.serverRoutes.find((candidate) =>
      routeMatches(candidate, request),
    );
    if (!route) return null;
    if (
      route.validateOrigin &&
      isUnsafeActionMethod(request.method) &&
      !validateActionOrigin(request, options)
    )
      return await returnResponse(forbiddenActionResponse());
    return await returnResponse(
      await route.handler(scope.contextFor(route.owner)),
    );
  } catch (cause) {
    runtime.diagnostics.push(
      diagnostic("TAVO_PLUGIN_009", "Plugin request handling failed.", {
        phase: "request",
        owners: [],
      }),
    );
    throw new TavoError("TAVO_PLUGIN_009", "Plugin request handling failed.", {
      cause,
    });
  } finally {
    if (!responseOwnsScope) {
      try {
        await scope.dispose();
      } catch (cause) {
        recordDisposalFailure();
        throw new TavoError(
          "TAVO_PLUGIN_009",
          "Plugin request scope disposal failed.",
          { cause },
        );
      }
    }
  }
}
