import type { PageModules, PageRuntimeOptions, RenderPagesResponse } from "../framework/index.js";
import type { RenderDocumentOptions } from "../server.js";

export type ImageFormat = "webp" | "avif" | "jpeg" | "png" | "original";

export type RemoteImagePattern = {
  protocol?: "https:" | "http:";
  hostname: string;
  port?: string;
  pathname?: string;
};

export type ImageOptimizerOptions = {
  enabled?: boolean;
  allowRemote?: boolean;
  remotePatterns?: Array<string | RemoteImagePattern>;
  publicDir?: string;
  quality?: number;
  cacheMaxAge?: number;
  defaultFormat?: ImageFormat;
  sizes?: number[];
  timeoutMs?: number;
  maxBytes?: number;
  memoryCacheMaxEntries?: number;
  maxConcurrentTransforms?: number;
  maxPendingTransforms?: number;
  allowInsecureRemote?: boolean;
  resolveHostname?: (hostname: string) => Promise<Array<{ address: string }>>;
};

export type SsrStaticCacheEntry = {
  response: RenderPagesResponse;
  expiresAt: number | null;
  tags: string[];
};

export type SsrStaticCache = {
  get(key: string): SsrStaticCacheEntry | null | Promise<SsrStaticCacheEntry | null>;
  set(key: string, entry: SsrStaticCacheEntry): void | Promise<void>;
  delete(key: string): void | Promise<void>;
  invalidateTags?(tags: string[]): number | Promise<number>;
  clear?(): void | Promise<void>;
};

export type NodeHandlerOptions = PageRuntimeOptions & {
  modules: PageModules;
  /** Public origin used when Node runs behind TLS termination, e.g. https://app.example.com. */
  canonicalOrigin?: string;
  document?: RenderDocumentOptions;
  stream?: boolean;
  images?: ImageOptimizerOptions;
  staticCache?: SsrStaticCache;
  maxRequestBodyBytes?: number;
};

export type FetchHandlerOptions = PageRuntimeOptions & {
  modules: PageModules;
  document?: RenderDocumentOptions;
  stream?: boolean;
  images?: ImageOptimizerOptions;
  staticCache?: SsrStaticCache;
};

export type ViteAutoPagesDevServerOptions = {
  root?: string;
  pagesDir?: string;
  cssEntries?: string[];
  mode?: string;
  images?: ImageOptimizerOptions;
  port?: number;
  host?: string;
};

export type RunningDevServer = {
  close(): Promise<void>;
  url: string;
};

export type ViteDevServerLike = {
  middlewares: (
    req: unknown,
    res: unknown,
    next: (error?: unknown) => void
  ) => void;
  transformRequest(
    url: string,
    options?: { ssr?: boolean }
  ): Promise<null | { code: string }>;
  pluginContainer?: {
    resolveId(
      id: string,
      importer?: string,
      options?: { ssr?: boolean }
    ): Promise<string | null | { id: string }>;
  };
  ssrLoadModule(id: string): Promise<unknown>;
  ssrFixStacktrace(error: unknown): void;
  close(): Promise<void>;
};
