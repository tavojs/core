import type { Component } from "../jsx.js";
import type {
  PageAction,
  PageActionOptions,
  PageErrorProps,
  PageLoadContext,
  PageLoader,
  PageLoaderOptions,
  PageMiddleware,
  PageMiddlewareOptions,
  PageModuleRecord,
  PagePendingProps,
  PageProps,
  RouteParamsFromPath
} from "./types.js";

export type TypedPageModule<TPath extends string, TData = unknown> = Omit<
  PageModuleRecord,
  "default" | "pending" | "error" | "prerender"
> & {
  default: Component<PageProps<TData, RouteParamsFromPath<TPath>>>;
  pending?: Component<PagePendingProps<RouteParamsFromPath<TPath>>>;
  error?: Component<PageErrorProps<RouteParamsFromPath<TPath>>>;
};

/** Defines a page module with a filename path hint for typed params and loader data. */
export function defineRoutePage<TPath extends string, TData = unknown>(
  path: TPath,
  page: TypedPageModule<TPath, TData>
): TypedPageModule<TPath, TData> {
  void path;
  return page;
}

/** Defines a route loader while preserving its return type for app-level helpers. */
export function defineLoader<T>(
  loader: (context: PageLoadContext) => T | Promise<T>,
  options?: PageLoaderOptions
): (context: PageLoadContext) => T | Promise<T> {
  if (options) {
    (loader as PageLoader).__tavo_loader_options__ = options;
  }
  return loader;
}

/** Defines a route loader that only runs during server-side route resolution. */
export function defineServerLoader<T>(
  loader: (context: PageLoadContext) => T | Promise<T>
): (context: PageLoadContext) => T | Promise<T> {
  return defineLoader(loader, { runtime: "server" });
}

/** Defines a server route action for non-GET requests while preserving handler types. */
export function defineAction<T extends PageAction>(
  action: T,
  options?: PageActionOptions
): T {
  if (options) {
    action.__tavo_action_options__ = options;
  }
  return action;
}

/** Defines route middleware with a stable signature. */
export function defineMiddleware<T extends PageMiddleware | PageMiddleware[]>(
  middleware: T,
  options?: PageMiddlewareOptions
): T {
  if (options) {
    const middlewares = Array.isArray(middleware) ? middleware : [middleware];
    for (const fn of middlewares) {
      fn.__tavo_middleware_options__ = options;
    }
  }
  return middleware;
}

/** Defines route middleware that only runs during server-side route resolution. */
export function defineServerMiddleware<T extends PageMiddleware | PageMiddleware[]>(middleware: T): T {
  return defineMiddleware(middleware, { runtime: "server" });
}
