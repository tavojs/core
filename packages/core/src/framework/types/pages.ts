import type { Child, Component } from "../../jsx.js";
import type { AnyI18nService, I18nLocaleDirection } from "../../i18n/index.js";
import type { TavoInstrumentation } from "../../instrumentation.js";
import type {
  TavoPluginInput,
  TavoPluginRuntime,
} from "../../plugins/types.js";
import type { RouteConfig, Router, RouterParams } from "../../router/index.js";
import type { TrailingSlashPolicy } from "../../router/url-policy.js";
import type { ResponseHeaders } from "../../ssr/headers.js";
import type { Store } from "../../store/index.js";

export type AnyRecord = Record<string, unknown>;
export type AnyStore = Store<AnyRecord>;
export type GlobalRegistry = Map<string, AnyStore>;
export type GlobalServiceRegistry = Map<string, unknown>;

export type PageProps<
  TData = unknown,
  TParams extends RouterParams = RouterParams,
  TLayers extends Record<string, unknown> = Record<string, unknown>,
> = {
  pathname?: string;
  params: TParams;
  data?: TData;
  error?: unknown;
  layers?: RouteDataLayer[];
  layerData?: TLayers;
};

export type PagePendingProps<
  TParams extends RouterParams = RouterParams,
  TLayers extends Record<string, unknown> = Record<string, unknown>,
> = {
  pathname: string;
  params: TParams;
  layers: RouteDataLayer[];
  layerData: TLayers;
};

export type PageErrorProps<
  TParams extends RouterParams = RouterParams,
  TLayers extends Record<string, unknown> = Record<string, unknown>,
> = PagePendingProps<TParams, TLayers> & {
  data: unknown;
  error: unknown;
};

export type PageHead = {
  title?: string;
  unsafeHeadHtml?: string;
  status?: number;
  htmlAttributes?: Record<string, string | number | boolean>;
  bodyAttributes?: Record<string, string | number | boolean>;
};

export type PageHeadExport = PageHead | Child;
export type PageRevalidate = number | false;
export type PageRenderMode = "ssr" | "csr";
export type PageCachePolicy = {
  static: boolean;
  revalidate: number | null;
  vary: string[];
  tags: string[];
};
export type PageCacheTags =
  | string
  | string[]
  | ((
      context: PageLoadContext,
    ) => string | string[] | Promise<string | string[]>);
export type PageStaticParams = RouterParams[];

export type PageLoadContext = {
  pathname: string;
  params: RouterParams;
  request: Request;
  rawRequest?: unknown;
  url: URL;
  headers: Headers;
  method: string;
  signal: AbortSignal;
  layers?: Record<string, unknown>;
};

export type RuntimeEnvironment = "server" | "client";
export type LoaderRuntime = RuntimeEnvironment | "both";
export type PageLoaderOptions = { runtime?: LoaderRuntime };
export type PageLoader = ((
  context: PageLoadContext,
) => unknown | Promise<unknown>) & {
  __tavo_loader_options__?: PageLoaderOptions;
};

export type ActionResult = {
  body?: BodyInit | null;
  headers?: HeadersInit | ResponseHeaders;
  json?: unknown;
  redirect?: string;
  status?: number;
};
export type PageActionContext = PageLoadContext;
export type ActionContentType = "form-data" | "json";
export type PageActionOptions = {
  contentType?: ActionContentType;
  validateOrigin?: boolean;
};
export type PageAction = ((
  context: PageActionContext,
) =>
  | Response
  | ActionResult
  | void
  | Promise<Response | ActionResult | void>) & {
  __tavo_action_options__?: PageActionOptions;
};

type StripCatchAllName<T extends string> = T extends `...${infer Name}`
  ? Name
  : T;
type StripOptionalName<T extends string> = T extends `[...${infer Name}]`
  ? Name
  : T extends `[${infer Name}]`
    ? Name
    : T;
type SegmentParamName<T extends string> = T extends `[${infer Inner}]`
  ? StripCatchAllName<StripOptionalName<Inner>>
  : never;
type SegmentParamValue<T extends string> = T extends `[[...${string}]]`
  ? string | undefined
  : T extends `[[${string}]]`
    ? string | undefined
    : string;
type RouteParamsFromSegments<T extends string> =
  T extends `${infer Head}/${infer Tail}`
    ? (SegmentParamName<Head> extends never
        ? Record<never, never>
        : { [K in SegmentParamName<Head>]: SegmentParamValue<Head> }) &
        RouteParamsFromSegments<Tail>
    : SegmentParamName<T> extends never
      ? Record<never, never>
      : { [K in SegmentParamName<T>]: SegmentParamValue<T> };

export type RouteParamsFromPath<TPath extends string> =
  RouteParamsFromSegments<TPath>;
export type LoaderData<TLoader> = TLoader extends (
  ...args: any[]
) => infer TResult
  ? Awaited<TResult>
  : never;

export type MiddlewareResult = void | { redirect?: string; status?: number };
export type MiddlewareRuntime = RuntimeEnvironment | "both";
export type PageMiddlewareOptions = { runtime?: MiddlewareRuntime };
export type PageMiddleware = ((context: {
  to: string;
  from?: string;
  params: RouterParams;
  request: Request;
  rawRequest?: unknown;
  url: URL;
  headers: Headers;
  method: string;
  signal: AbortSignal;
}) => MiddlewareResult | Promise<MiddlewareResult>) & {
  __tavo_middleware_options__?: PageMiddlewareOptions;
};

export type PageModuleRecord = {
  default: Component<AnyRecord>;
  pending?: Component<AnyRecord>;
  error?: Component<AnyRecord>;
  action?: PageAction;
  load?: PageLoader;
  head?:
    | PageHeadExport
    | ((
        context: PageLoadContext & {
          data: unknown;
          error: unknown;
        },
      ) => PageHeadExport);
  middleware?: PageMiddleware | PageMiddleware[];
  /** Opts this module's route subtree out of server body rendering. */
  render?: "csr";
  layout?: boolean;
  prerender?: boolean;
  static?: boolean;
  revalidate?: PageRevalidate;
  vary?: string | string[];
  cacheTags?: PageCacheTags;
  generateStaticParams?: () => PageStaticParams | Promise<PageStaticParams>;
};
export type PageModule = PageModuleRecord | Component<AnyRecord>;
export type PageModuleLoader = (() => Promise<PageModule>) & {
  __tavo_loader__: true;
};
export type PageModuleSource = PageModule | PageModuleLoader;
export type PageModules = Record<string, PageModuleSource>;

export type PageRouteDefinition = {
  file: string;
  path: string;
  component: Component<AnyRecord>;
  pending?: Component<AnyRecord>;
  error?: Component<AnyRecord>;
  layouts: Component<AnyRecord>[];
  layoutLayers: Array<{
    kind: "root" | "layout";
    id: string;
    file: string;
    component: Component<AnyRecord>;
    load?: PageModuleRecord["load"];
    head?: PageModuleRecord["head"];
    middleware: PageMiddleware[];
    render?: PageModuleRecord["render"];
    layout?: PageModuleRecord["layout"];
    prerender?: boolean;
    static?: boolean;
    revalidate?: PageRevalidate;
    vary?: string | string[];
    cacheTags?: PageCacheTags;
  }>;
  load?: PageModuleRecord["load"];
  action?: PageModuleRecord["action"];
  head?: PageModuleRecord["head"];
  middleware: PageMiddleware[];
  cacheTags?: PageCacheTags;
  cacheTagResolvers: PageCacheTags[];
  generateStaticParams?: PageModuleRecord["generateStaticParams"];
  renderMode: PageRenderMode;
  cache: PageCachePolicy;
};

export type RouteDataLayer = {
  id: string;
  kind: "layout" | "page";
  data: unknown;
  error: unknown;
};
export type PagesManifest = {
  routes: PageRouteDefinition[];
  notFound?: Component<AnyRecord>;
  notFoundHead?: PageModuleRecord["head"];
  error?: Component<AnyRecord>;
  diagnostics: string[];
};
export type RoutesCatalogState = { routes: PageRouteDefinition[] };

export type PageRuntimeOptions = {
  routing?: { trailingSlash?: TrailingSlashPolicy };
  getPageProps?: () => AnyRecord;
  notFound?: Component<{ pathname: string }>;
  csrFallback?:
    | Child
    | ((context: { pathname: string; params: RouterParams }) => Child);
  csrActions?: CsrActionsOptions;
  middleware?: PageMiddleware[];
  allowExternalRedirects?: boolean;
  trustedHosts?: string[];
  i18n?: AnyI18nService;
  plugins?: TavoPluginInput;
  pluginRuntime?: TavoPluginRuntime;
  maxResolvedCacheEntries?: number;
  instrumentation?: TavoInstrumentation;
};

export type CsrActionContext = {
  pathname: string;
  search: string;
  form?: HTMLFormElement;
};
type CsrActionFormContext = CsrActionContext & { form: HTMLFormElement };
export type CsrActionsOptions = {
  enabled?: boolean;
  baseUrl?: string;
  resolveUrl?: (context: CsrActionContext) => string;
  credentials?: RequestCredentials;
  headers?:
    | HeadersInit
    | ((context: Omit<CsrActionFormContext, "search">) => HeadersInit);
};

export type PagesRuntimeResolved = {
  pathname: string;
  params: RouterParams;
  route: PageRouteDefinition | null;
  status: number;
  data: unknown;
  error: unknown;
  layers: RouteDataLayer[];
  layerData: Record<string, unknown>;
  head: PageHead;
  cache: PageCachePolicy;
  renderMode: PageRenderMode;
  node: Child;
  redirect?: string;
  i18n?: { locale: string; dir: I18nLocaleDirection };
};

export type PagesRuntimePending = {
  pathname: string;
  params: RouterParams;
  route: PageRouteDefinition;
  layers: RouteDataLayer[];
  layerData: Record<string, unknown>;
  node: Child;
};

export type PageResolveOptions = {
  onPending?: (pending: PagesRuntimePending) => void;
};

export type PagesRuntimeInspection = {
  routeCount: number;
  routes: Array<{
    path: string;
    renderMode: PageRenderMode;
    static: boolean;
    revalidate: number | null;
    tags: string[];
  }>;
  cacheEntries: number;
  inflightResolutions: number;
  loadedModules: number;
  diagnostics: string[];
};

export type PagesRuntime = {
  manifest: PagesManifest;
  routes: PageRouteDefinition[];
  routesStore: Store<RoutesCatalogState>;
  routeConfigs: RouteConfig[];
  router: Router;
  diagnostics: string[];
  pluginHead: string;
  pluginRuntime: TavoPluginRuntime;
  i18n?: AnyI18nService;
  renderPath(pathname: string): Child;
  renderResolved(resolved: PagesRuntimeResolved): Child;
  resolvePath(pathname: string): {
    route: PageRouteDefinition | null;
    params: RouterParams;
  };
  loadRouteModules(route: PageRouteDefinition): Promise<void>;
  resolvePathAsync(
    pathname: string,
    request?: unknown,
    fromPath?: string,
    options?: PageResolveOptions,
  ): Promise<PagesRuntimeResolved>;
  handleAction(pathname: string, request: unknown): Promise<Response | null>;
  invalidateCache(tags: string | string[]): number;
  clearCache(): void;
  inspect(): PagesRuntimeInspection;
};

export type PagesAppProps = PageRuntimeOptions & { modules: PageModules };
export type AutoPagesAppProps = PageRuntimeOptions & {
  modules?: PageModules;
  pattern?: string;
};
