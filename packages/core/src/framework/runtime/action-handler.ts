import { emitInstrumentation } from "../../instrumentation.js";
import { runWithStoreSnapshotScope } from "../../store/index.js";
import { normalizePageRequest } from "../../ssr/request.js";
import type {
  PageRouteDefinition,
  PageRuntimeOptions
} from "../types.js";
import {
  actionResultToResponse,
  forbiddenActionResponse,
  isUnsafeActionMethod,
  matchesActionContentType,
  unsupportedActionContentTypeResponse,
  validateActionOrigin
} from "./actions.js";
import { createPageContext } from "./context.js";

type ActionHandlerOptions = {
  runtimeOptions?: PageRuntimeOptions;
  resolvePath(pathname: string): { route: PageRouteDefinition | null; params: Record<string, string> };
  ensureRouteLoaded(route: PageRouteDefinition): Promise<void>;
};

export function createRuntimeActionHandler(options: ActionHandlerOptions) {
  let requestSequence = 0;
  return async function handleAction(
    pathname: string,
    request: unknown
  ): Promise<Response | null> {
    const normalized = normalizePageRequest(pathname, request);
    const resolved = options.resolvePath(pathname);
    if (!resolved.route) return null;
    const route = resolved.route;
    await options.ensureRouteLoaded(route);
    if (!route.action) return null;
    const actionOptions = route.action.__tavo_action_options__;
    if (
      isUnsafeActionMethod(normalized.method)
      && actionOptions?.validateOrigin !== false
      && !validateActionOrigin(normalized.request, {
        rawRequest: normalized.rawRequest,
        trustedHosts: options.runtimeOptions?.trustedHosts
      })
    ) return forbiddenActionResponse();
    if (
      isUnsafeActionMethod(normalized.method)
      && actionOptions?.contentType
      && !matchesActionContentType(normalized.request, actionOptions.contentType)
    ) return unsupportedActionContentTypeResponse(actionOptions.contentType);
    const startedAt = Date.now();
    const requestId = `action-${++requestSequence}`;
    emitInstrumentation(options.runtimeOptions?.instrumentation, {
      name: "route.action",
      phase: "start",
      requestId,
      route: route.path
    });
    try {
      const { value: result } = await runWithStoreSnapshotScope(() => (
        route.action!(createPageContext(pathname, resolved.params, normalized))
      ));
      const response = actionResultToResponse(result, options.runtimeOptions);
      emitInstrumentation(options.runtimeOptions?.instrumentation, {
        name: "route.action",
        phase: "end",
        requestId,
        route: route.path,
        durationMs: Date.now() - startedAt,
        status: response.status
      });
      return response;
    } catch (error) {
      emitInstrumentation(options.runtimeOptions?.instrumentation, {
        name: "route.action",
        phase: normalized.request.signal.aborted ? "abort" : "error",
        requestId,
        route: route.path,
        durationMs: Date.now() - startedAt,
        error
      });
      throw error;
    }
  };
}
