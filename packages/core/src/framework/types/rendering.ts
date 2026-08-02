import type { RouterParams } from "../../router/index.js";
import type { RenderDocumentOptions } from "../../server.js";
import type { ResponseHeaders } from "../../ssr/headers.js";
import type {
  PageRuntimeOptions,
  PagesRuntimeResolved,
  RouteDataLayer
} from "./pages.js";

export type AppRuntimeContext = {
  pathname: string;
  params: RouterParams;
  data: unknown;
  error: unknown;
  layers: RouteDataLayer[];
  layerData: Record<string, unknown>;
  request?: unknown;
};

export type RenderPagesDocumentAsyncOptions = PageRuntimeOptions & {
  request?: unknown;
  fromPath?: string;
  document?: RenderDocumentOptions;
};
export type RenderPagesDocumentOptions = PageRuntimeOptions & {
  document?: RenderDocumentOptions;
};
export type RenderPagesResponse = {
  html: string;
  status: number;
  headers: ResponseHeaders;
  redirect?: string;
  resolved: PagesRuntimeResolved;
};
export type RenderPagesStreamResponse = {
  stream: ReadableStream<Uint8Array>;
  status: number;
  headers: ResponseHeaders;
  redirect?: string;
  resolved: PagesRuntimeResolved;
};
