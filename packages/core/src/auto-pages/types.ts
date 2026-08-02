import type { Root } from "../dom.js";
import type {
  AutoPagesAppProps,
  CsrActionContext,
  CsrActionsOptions,
  PageCachePolicy,
  PageModules,
  PageRouteDefinition,
  PagesRuntimeInspection,
  PagesRuntimePending,
  PagesRuntimeResolved,
} from "../framework/types.js";
import type { StoreSnapshotState } from "../store/index.js";
import type {
  createNodeRequestHandler,
  NodeHandlerOptions,
} from "../ssr/index.js";

export type NavigationState = {
  pathname: string;
};

export type RoutesState = {
  routes: PageRouteDefinition[];
};

export type ResolutionState = {
  byPath: Record<string, PagesRuntimeResolved>;
  pendingByPath: Record<string, PagesRuntimePending>;
  activePathname: string;
};

export type RouteStatus = {
  pathname: string;
  status:
    | "idle"
    | "loading"
    | "prefetching"
    | "ready"
    | "redirecting"
    | "error";
  error: unknown;
  redirect?: string;
};

export type RouteStatusState = {
  byPath: Record<string, RouteStatus>;
};

export type AutoPagesInspection = {
  pathname: string;
  route: string | null;
  status: RouteStatus["status"];
  params: Record<string, string | undefined>;
  runtime: PagesRuntimeInspection | null;
};

export type ResolveTavoActionUrlOptions = {
  search?: string;
  form?: HTMLFormElement;
};

export type RuntimeContextValue = {
  resolvePath(
    pathname: string,
    fromPath?: string,
    options?: { prefetch?: boolean; signal?: AbortSignal },
  ): Promise<void>;
};

export type AutoPagesHydrationResolved = Omit<
  PagesRuntimeResolved,
  "route" | "node"
> & {
  routePath: string | null;
};

export type AutoPagesDocumentState = {
  autoPagesResolved?: AutoPagesHydrationResolved;
  storeState?: StoreSnapshotState;
  pluginState?: Record<string, unknown>;
};

type BootTavoSharedOptions = AutoPagesAppProps & {
  modules?: PageModules;
  pattern?: string;
};

type BootTavoClientOptions =
  BootTavoSharedOptions & {
    root?: Element | null;
    rootSelector?: string;
    hydrate?: boolean;
  };

type BootTavoServerOptions =
  BootTavoSharedOptions & {
    serverFile?: string;
    node?: Omit<NodeHandlerOptions, "modules"> & {
      modules?: PageModules;
    };
  };

export type BootTavoOptions = BootTavoClientOptions & BootTavoServerOptions;

export type BootTavoResult =
  | { mode: "client"; root: Root }
  | {
      mode: "server";
      handle: ReturnType<typeof createNodeRequestHandler>;
      modules: PageModules;
    }
  | { mode: "none" };

export type TavoBootMode = "server" | "ssr" | "csr" | "none";

export type { AutoPagesAppProps, CsrActionContext, CsrActionsOptions };
