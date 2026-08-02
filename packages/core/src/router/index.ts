export { createRouter } from "./core.js";
export { Link, RouterProvider } from "./react.js";
export {
  getAvailableRoutes,
  getCurrentPathname,
  getResolvedRoute,
  getRouteStatus,
  navigate,
  prefetchRoute,
  subscribeAvailableRoutes,
  subscribePathname,
  subscribeRouteStatus,
} from "../auto-pages/state.js";
export {
  defineAction,
  defineLoader,
  defineMiddleware,
  defineRoutePage,
  defineServerLoader,
  defineServerMiddleware,
} from "../framework/define.js";
export { notFound } from "../framework/not-found.js";
export {
  isClientRuntime,
  isServerRuntime,
} from "../framework/runtime/rendering.js";

export type { RouteConfig, Router, RouterNavigateOptions, RouterParams } from "./types.js";
export type { LinkProps } from "./react.js";
export type {
  RouteStatus,
  RouteStatusState,
} from "../auto-pages/types.js";
export type {
  LoaderData,
  MiddlewareResult,
  MiddlewareRuntime,
  PageAction,
  PageActionContext,
  PageActionOptions,
  PageHead,
  PageHeadExport,
  PageCachePolicy,
  PageCacheTags,
  PageLoadContext,
  PageLoader,
  PageLoaderOptions,
  PageMiddleware,
  PageMiddlewareOptions,
  PageErrorProps,
  PageProps,
  PagePendingProps,
  PageRenderMode,
  PageRevalidate,
  PageRouteDefinition,
  PageStaticParams,
  RouteParamsFromPath,
} from "../framework/types.js";
export type { TypedPageModule } from "../framework/define.js";
