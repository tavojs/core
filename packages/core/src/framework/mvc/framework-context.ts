import {
  getActivePagesRuntime,
  getAvailableRoutes,
  getCurrentPathname,
  getPendingRoute,
  getResolvedRoute,
  getRouteStatus,
  navigate as navigateRoute,
  prefetchRoute,
  updateBrowserUrl,
} from "../../auto-pages/state.js";
import { TavoError } from "../../diagnostics.js";
import type { RouterNavigateOptions } from "../../router/index.js";
import {
  getGlobalStore,
  hasGlobalStore,
  listGlobalStores,
} from "../global-store.js";
import {
  getService,
  hasService,
  listServices,
  tryGetService,
} from "../services.js";
import type { MvcControllerFrameworkContext } from "../types.js";

export function createControllerFrameworkContext(): MvcControllerFrameworkContext {
  const getPage = () => {
    const pending = getPendingRoute();
    if (pending) {
      return {
        pathname: pending.pathname,
        route: pending.route,
        status: getRouteStatus().status,
        data: undefined,
        params: pending.params,
        error: null,
        layers: pending.layers,
        layerData: pending.layerData,
      };
    }
    const resolved = getResolvedRoute();
    return {
      pathname: getCurrentPathname(),
      route: resolved?.route ?? null,
      status: getRouteStatus().status,
      data: resolved?.data,
      params: resolved?.params ?? {},
      error: resolved?.error,
      layers: resolved?.layers ?? [],
      layerData: resolved?.layerData ?? {},
    };
  };
  return {
    get router() {
      return {
        navigate(to: string, options?: RouterNavigateOptions) {
          navigateRoute(to, options);
        },
        pushUrl(to: string) {
          updateBrowserUrl(to);
        },
        replaceUrl(to: string) {
          updateBrowserUrl(to, { replace: true });
        },
        prefetch(pathname: string, options?: { signal?: AbortSignal }) {
          return prefetchRoute(pathname, options);
        },
        get routes() {
          return getAvailableRoutes();
        },
      };
    },
    get stores() {
      return {
        get: getGlobalStore,
        has: hasGlobalStore,
        list: listGlobalStores,
      };
    },
    get services() {
      return {
        get: getService,
        tryGet: tryGetService,
        has: hasService,
        list: listServices,
      };
    },
    get capabilities() {
      const resolver = getActivePagesRuntime()?.pluginRuntime.capabilities;
      if (!resolver) {
        return {
          resolve() {
            throw new TavoError(
              "TAVO_PLUGIN_004",
              "Plugin capabilities require an active pages runtime.",
            );
          },
          tryResolve() {
            return undefined;
          },
        };
      }
      return resolver;
    },
    get page() {
      return getPage();
    },
  };
}
