import type { RouterParams } from "../../router/index.js";
import type { NormalizedPageRequest } from "../../ssr/request.js";
import type {
  PageHead,
  RouteDataLayer
} from "../types.js";
import { mergeHead, normalizeHead } from "./head.js";
import type { RuntimeRouteEntry } from "./routes.js";

type ResolveHeadOptions = {
  pathname: string;
  params: RouterParams;
  request: NormalizedPageRequest;
  entry?: RuntimeRouteEntry;
  layers: RouteDataLayer[];
  data: unknown;
  error: unknown;
  locale?: string;
  applyLocale(locale?: string): void;
};

function headContext(
  options: ResolveHeadOptions,
  data: unknown,
  error: unknown
) {
  return {
    pathname: options.pathname,
    params: options.params,
    request: options.request.request,
    rawRequest: options.request.rawRequest,
    url: options.request.url,
    headers: options.request.headers,
    method: options.request.method,
    signal: options.request.request.signal,
    data,
    error
  };
}

export function resolveRouteHead(options: ResolveHeadOptions): PageHead {
  let head: PageHead = {};
  for (const layout of options.entry?.layoutHeadLayers ?? []) {
    const result = options.layers.find(
      (layer) => layer.kind === "layout" && layer.id === layout.id
    );
    options.applyLocale(options.locale);
    const computed = typeof layout.head === "function"
      ? layout.head(headContext(options, result?.data, result?.error))
      : layout.head;
    head = mergeHead(head, normalizeHead(computed));
  }
  const pageHead = options.entry?.pageHead;
  if (pageHead) {
    options.applyLocale(options.locale);
    const computed = typeof pageHead === "function"
      ? pageHead(headContext(options, options.data, options.error))
      : pageHead;
    head = mergeHead(head, normalizeHead(computed));
  }
  return head;
}

export function resolveStaticCsrHead(
  entry?: RuntimeRouteEntry
): PageHead {
  let head: PageHead = {};
  for (const layout of entry?.layoutHeadLayers ?? []) {
    if (layout.head && typeof layout.head !== "function") {
      head = mergeHead(head, normalizeHead(layout.head));
    }
  }
  if (entry?.pageHead && typeof entry.pageHead !== "function") {
    head = mergeHead(head, normalizeHead(entry.pageHead));
  }
  return head;
}
