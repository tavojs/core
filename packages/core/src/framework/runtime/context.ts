import type { RouterParams } from "../../router/index.js";
import type { NormalizedPageRequest } from "../../ssr/request.js";

export function createPageContext(
  pathname: string,
  params: RouterParams,
  request: NormalizedPageRequest,
  layers?: Record<string, unknown>
) {
  return {
    pathname,
    params,
    request: request.request,
    rawRequest: request.rawRequest,
    url: request.url,
    headers: request.headers,
    method: request.method,
    signal: request.request.signal,
    layers
  };
}
