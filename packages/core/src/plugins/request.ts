import { TavoError } from "../diagnostics.js";
import {
  forbiddenActionResponse,
  isUnsafeActionMethod,
  validateActionOrigin,
} from "../framework/runtime/actions.js";
import { diagnostic } from "./internal.js";
import { createRequestScope, type InternalRequestScope } from "./request-scope.js";
import type { PluginRuntimeServerRoute, TavoPluginRuntime } from "./types.js";

export { createRequestScope };

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
