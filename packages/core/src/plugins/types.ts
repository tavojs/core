import type { Child } from "../jsx.js";
import type {
  AnyRecord,
  PageMiddleware,
  PageModule,
  PageModules,
} from "../framework/types.js";
import type { Store } from "../store/index.js";
import type { TAVO_PLUGIN_API_VERSION } from "./declarations.js";
import type { PluginOverride } from "./configuration-types.js";

// The compiler imports its normalized representation from this internal module.
// The public plugin entrypoint deliberately exports only the ergonomic subset.
export type * from "./configuration-types.js";

export type MaybePromise<T> = T | Promise<T>;
export type PluginScope = "runtime" | "request";
export type PluginPhaseTarget = "client" | "server" | "build";

export type PluginCapabilityToken<
  T = unknown,
  TScope extends PluginScope = PluginScope,
> = {
  readonly kind: "capability";
  readonly provider: string;
  readonly name: string;
  readonly scope: TScope;
  readonly __tavoCapabilityType?: T;
};

export type PluginStoreToken<T extends AnyRecord = AnyRecord> = {
  readonly kind: "store";
  readonly provider: string;
  readonly name: string;
  readonly scope: "runtime";
  readonly hydrate: boolean;
  readonly validate?: (value: unknown) => value is T;
  readonly serialize?: (value: T) => unknown;
  readonly deserialize?: (value: unknown) => T;
  readonly __tavoStoreType?: T;
};

export type AnyPluginToken =
  | PluginCapabilityToken<any, any>
  | PluginStoreToken<any>;

export type PluginDependency = {
  id: string;
  instanceId?: string;
  version: string;
  optional?: boolean;
  capabilities?: readonly AnyPluginToken[];
};

export type PluginPageDeclaration = {
  id: string;
  path: string;
};

export type PluginEndpointMatcher =
  | { kind: "exact"; path: string }
  | { kind: "subtree"; path: string };

export type PluginEndpointDeclaration = {
  id: string;
  methods: readonly string[];
  match: PluginEndpointMatcher;
  validateOrigin?: boolean;
};

export type PluginMiddlewareTarget = "server" | "page";
export type PluginMiddlewareStage =
  | "server:before-handler"
  | "page:before-app"
  | "page:after-app";

export type PluginMiddlewareDeclaration = {
  id: string;
  target: PluginMiddlewareTarget;
  stage: PluginMiddlewareStage;
  before?: readonly string[];
  after?: readonly string[];
};

export type PluginHeadDeclaration = {
  id: string;
  key: string;
  cardinality: "singleton" | "multi";
  unsafeHeadHtml?: boolean;
};

export type PluginBuildItemDeclaration = {
  id: string;
  before?: readonly string[];
  after?: readonly string[];
};

export type PluginBuildDeclaration = {
  aliases?: Readonly<Record<string, string>>;
  defines?: Readonly<Record<string, string>>;
  plugins?: readonly PluginBuildItemDeclaration[];
};

export type PluginPermissionDeclaration = {
  name: "unsafeHeadHtml";
  /** Required permissions are part of the plugin's installation contract. */
  required?: boolean;
  reason: string;
};

export type PluginExposureDeclaration = {
  target: "page" | "server";
  from?: string;
  to: string;
  reason: string;
};

export type TavoPluginManifest = {
  provides?: readonly AnyPluginToken[];
  dependencies?: readonly PluginDependency[];
  stores?: readonly PluginStoreToken<any>[];
  pages?: readonly PluginPageDeclaration[];
  endpoints?: readonly PluginEndpointDeclaration[];
  middleware?: readonly PluginMiddlewareDeclaration[];
  head?: readonly PluginHeadDeclaration[];
  build?: PluginBuildDeclaration;
  /** Framework permissions enabled by installing this trusted plugin. */
  permissions?: readonly PluginPermissionDeclaration[];
  /** Default public mounts enabled by installing this trusted plugin. */
  exposure?: readonly PluginExposureDeclaration[];
};

export type PluginResolveContext = {
  readonly instanceId: string;
  resolve<T>(
    token: PluginCapabilityToken<T, "runtime"> | PluginStoreToken<any>,
  ): T;
  tryResolve<T>(
    token: PluginCapabilityToken<T, "runtime"> | PluginStoreToken<any>,
  ): T | undefined;
};

export type PluginRequestResolveContext = Omit<
  PluginResolveContext,
  "resolve" | "tryResolve"
> & {
  readonly request: Request;
  resolve<T>(
    token: PluginCapabilityToken<T, any> | PluginStoreToken<any>,
  ): Promise<T>;
  tryResolve<T>(
    token: PluginCapabilityToken<T, any> | PluginStoreToken<any>,
  ): Promise<T | undefined>;
};

export type PluginResourceFactory<T = unknown> = (
  context: PluginResolveContext,
) => MaybePromise<T>;

export type PluginRequestResourceFactory<T = unknown> = (
  context: PluginRequestResolveContext,
) => MaybePromise<T>;

export type PluginStoreFactory<T extends AnyRecord = AnyRecord> = (
  context: PluginResolveContext,
) => MaybePromise<T | Store<T>>;

export type PluginServerHandlerContext = PluginRequestResolveContext & {
  params: Record<string, string>;
};

export type PluginServerHandler = (
  context: PluginServerHandlerContext,
) => MaybePromise<Response>;

export type PluginServerMiddleware = (
  context: PluginServerHandlerContext,
) => MaybePromise<Response | void>;

export type PluginHeadImplementation =
  | Child
  | string
  | ((context: PluginResolveContext) => MaybePromise<Child | string>);

export type TavoPluginPhase = {
  capabilities?: Readonly<
    Record<string, PluginResourceFactory | PluginRequestResourceFactory>
  >;
  stores?: Readonly<Record<string, PluginStoreFactory>>;
  pages?: Readonly<Record<string, PageModule>>;
  endpoints?: Readonly<Record<string, PluginServerHandler>>;
  middleware?: Readonly<
    Record<string, PageMiddleware | PluginServerMiddleware>
  >;
  head?: Readonly<Record<string, PluginHeadImplementation>>;
  build?: {
    plugins?: Readonly<Record<string, unknown>>;
  };
  setup?: (context: PluginResolveContext) => MaybePromise<void>;
  dispose?: () => MaybePromise<void>;
};

export type PluginPhaseLoader = () => MaybePromise<
  TavoPluginPhase | { default: TavoPluginPhase }
>;

export type TavoPlugin = {
  id: string;
  version: string;
  apiVersion: typeof TAVO_PLUGIN_API_VERSION;
  manifest: TavoPluginManifest;
  client?: PluginPhaseLoader;
  server?: PluginPhaseLoader;
  build?: PluginPhaseLoader;
};

export type PluginDiagnosticCode =
  | "TAVO_PLUGIN_001"
  | "TAVO_PLUGIN_002"
  | "TAVO_PLUGIN_003"
  | "TAVO_PLUGIN_004"
  | "TAVO_PLUGIN_005"
  | "TAVO_PLUGIN_006"
  | "TAVO_PLUGIN_007"
  | "TAVO_PLUGIN_008"
  | "TAVO_PLUGIN_009";

export type PluginDiagnostic = {
  code: PluginDiagnosticCode;
  severity: "error" | "warning";
  phase: "compile" | "initialize" | "build" | "request" | "dispose";
  message: string;
  resource?: string;
  owners?: readonly string[];
  hint?: string;
};

export type CompiledPlugin = {
  owner: string;
  id: string;
  instanceId: string;
  version: string;
  plugin: TavoPlugin;
  dependencies: readonly string[];
  defaultBasePath: string;
};

export type CompiledPluginEndpoint = PluginEndpointDeclaration & {
  owner: string;
  path: string;
};

export type CompiledPluginPage = PluginPageDeclaration & {
  owner: string;
  path: string;
};

export type CompiledPluginBuildValue = {
  owner: string;
  value: string;
};

export type CompiledPluginGraph = {
  plugins: readonly CompiledPlugin[];
  diagnostics: readonly PluginDiagnostic[];
  capabilities: ReadonlyMap<string, string>;
  pages: readonly CompiledPluginPage[];
  endpoints: readonly CompiledPluginEndpoint[];
  middleware: readonly (PluginMiddlewareDeclaration & { owner: string })[];
  head: readonly (PluginHeadDeclaration & { owner: string })[];
  buildAliases: ReadonlyMap<string, CompiledPluginBuildValue>;
  buildDefines: ReadonlyMap<string, CompiledPluginBuildValue>;
  overrides: readonly PluginOverride[];
};

export type PluginGraphInspection = {
  valid: boolean;
  diagnostics: readonly PluginDiagnostic[];
  plugins: readonly {
    owner: string;
    id: string;
    instanceId: string;
    version: string;
    dependencies: readonly string[];
  }[];
  capabilities: readonly { key: string; owner: string }[];
  pages: readonly { owner: string; id: string; path: string }[];
  endpoints: readonly {
    owner: string;
    id: string;
    methods: readonly string[];
    kind: "exact" | "subtree";
    path: string;
  }[];
  middleware: readonly {
    owner: string;
    id: string;
    stage: PluginMiddlewareStage;
  }[];
  head: readonly {
    owner: string;
    id: string;
    key: string;
    cardinality: "singleton" | "multi";
  }[];
  buildAliases: readonly { key: string; owner: string; value: string }[];
  buildDefines: readonly { key: string; owner: string; value: string }[];
  mounts: readonly {
    owner: string;
    target: "page" | "server";
    from: string;
    to: string;
  }[];
  overrides: readonly PluginOverride[];
  permissions: readonly {
    owner: string;
    name: "unsafeHeadHtml";
    required: boolean;
    reason: string;
  }[];
  exposure: readonly {
    owner: string;
    target: "page" | "server";
    from: string;
    to: string;
    reason: string;
  }[];
};

export type PluginCompileOptions = {
  appRoutes?: readonly string[];
};

export type PluginRequestScope = {
  readonly request: Request;
  resolve<T>(
    token: PluginCapabilityToken<T, any> | PluginStoreToken<any>,
  ): Promise<T>;
  tryResolve<T>(
    token: PluginCapabilityToken<T, any> | PluginStoreToken<any>,
  ): Promise<T | undefined>;
  dispose(): Promise<void>;
};

export type PluginCapabilityResolver = {
  resolve<T>(
    token: PluginCapabilityToken<T, "runtime"> | PluginStoreToken<any>,
  ): T;
  tryResolve<T>(
    token: PluginCapabilityToken<T, "runtime"> | PluginStoreToken<any>,
  ): T | undefined;
};

export type PluginRuntimeServerRoute = {
  owner: string;
  id: string;
  methods: readonly string[];
  kind: "exact" | "subtree";
  path: string;
  handler: PluginServerHandler;
  validateOrigin: boolean;
};

export type TavoPluginRuntime = {
  graph: CompiledPluginGraph;
  routeModules: PageModules;
  pageMiddlewareBeforeApp: PageMiddleware[];
  pageMiddlewareAfterApp: PageMiddleware[];
  serverMiddleware: Array<{
    owner: string;
    id: string;
    handler: PluginServerMiddleware;
  }>;
  head: Child[];
  unsafeHeadHtml: string[];
  serverRoutes: PluginRuntimeServerRoute[];
  diagnostics: PluginDiagnostic[];
  capabilities: PluginCapabilityResolver;
  createRequestScope(request: Request): PluginRequestScope;
  serializeHydrationState(): Readonly<Record<string, unknown>>;
  hydrate(state: unknown): void;
  dispose(): Promise<void>;
};
