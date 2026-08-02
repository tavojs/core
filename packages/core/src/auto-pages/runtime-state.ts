import { createPagesRuntime } from "../framework/runtime.js";
import type { PageModules, PagesRuntimeResolved } from "../framework/types.js";
import { normalizeRedirectTarget } from "../security.js";
import { hydrateStoresFromDocumentState } from "../store/index.js";
import {
  applyResolvedHead,
  clearPendingPath,
  clearPendingPaths,
  getResolvedPathname,
  navigate,
  peekInitialResolvedState,
  setPendingPath,
  setResolvedPath,
  setRouteStatus
} from "./state.js";
import type { AutoPagesAppProps, RuntimeContextValue } from "./types.js";

export type AutoPagesRuntimeState = {
  runtime: ReturnType<typeof createPagesRuntime>;
  initialResolved: PagesRuntimeResolved | null;
  resolver: RuntimeContextValue;
  dispose(): void;
};

type DiscoverPagesModules = (pattern?: string) => PageModules;

function createClientLoadRequest(pathname: string, signal?: AbortSignal): Request | undefined {
  if (typeof window === "undefined" || typeof Request === "undefined") {
    return undefined;
  }
  try {
    return new Request(new URL(pathname, window.location.href), {
      method: "GET",
      signal
    });
  } catch {
    return undefined;
  }
}

export function createAutoPagesRuntimeStateInternal(
  props: AutoPagesAppProps | undefined,
  discoverPagesModules: DiscoverPagesModules
): AutoPagesRuntimeState {
  hydrateStoresFromDocumentState();
  const runtime = createPagesRuntime(props?.modules ?? discoverPagesModules(props?.pattern), {
    getPageProps: props?.getPageProps,
    notFound: props?.notFound,
    csrFallback: props?.csrFallback,
    middleware: props?.middleware,
    allowExternalRedirects: props?.allowExternalRedirects,
    i18n: props?.i18n,
    plugins: props?.plugins
  });

  const initialResolved = (() => {
    const serialized = peekInitialResolvedState();
    if (!serialized || serialized.pathname !== getResolvedPathname()) {
      return null;
    }
    const route = runtime.routes.find((candidate) => candidate.path === serialized.routePath) ?? null;
    return {
      ...serialized,
      route,
      node: runtime.renderResolved({
        ...serialized,
        route,
        node: null
      })
    };
  })();

  const pendingResolutions = new Map<string, Promise<void>>();
  const prefetchControllers = new Map<string, AbortController>();
  let navigationController: AbortController | null = null;
  const runtimeState = {
    runtime,
    initialResolved,
    resolver: null as unknown as RuntimeContextValue,
    dispose() {
      navigationController?.abort();
      navigationController = null;
      for (const controller of prefetchControllers.values()) {
        controller.abort();
      }
      prefetchControllers.clear();
      pendingResolutions.clear();
      clearPendingPaths();
    }
  };
  const resolver: RuntimeContextValue = {
    resolvePath: async (
      pathname: string,
      fromPath?: string,
      options?: { prefetch?: boolean; signal?: AbortSignal }
    ): Promise<void> => {
      const resolutionKey = `${options?.prefetch ? "prefetch" : "navigate"}:${fromPath ?? ""}:${pathname}`;
      const pendingResolution = pendingResolutions.get(resolutionKey);
      if (pendingResolution) {
        return pendingResolution;
      }

      const controller = new AbortController();
      const externalSignal = options?.signal;
      const abortFromExternal = () => controller.abort(externalSignal?.reason);
      if (externalSignal?.aborted) {
        abortFromExternal();
      } else {
        externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
      }
      if (options?.prefetch) {
        prefetchControllers.get(pathname)?.abort();
        prefetchControllers.set(pathname, controller);
      } else {
        navigationController?.abort();
        clearPendingPaths();
        navigationController = controller;
        prefetchControllers.get(pathname)?.abort();
        prefetchControllers.delete(pathname);
      }
      const currentInitialResolved = runtimeState.initialResolved;
      if (!options?.prefetch && !fromPath && currentInitialResolved?.pathname === pathname) {
        setResolvedPath(currentInitialResolved);
        setRouteStatus({
          pathname,
          status: currentInitialResolved.redirect ? "redirecting" : "ready",
          error: currentInitialResolved.error,
          redirect: currentInitialResolved.redirect
        });
        applyResolvedHead(currentInitialResolved);
        externalSignal?.removeEventListener("abort", abortFromExternal);
        if (navigationController === controller) {
          navigationController = null;
        }
        return;
      }

      const resolution = Promise.resolve().then(async () => {
        if (!options?.prefetch) {
          clearPendingPath(pathname);
        }
        setRouteStatus({
          pathname,
          status: options?.prefetch ? "prefetching" : "loading",
          error: null
        });
        try {
          const resolved = await runtime.resolvePathAsync(
            pathname,
            createClientLoadRequest(pathname, controller.signal),
            fromPath,
            options?.prefetch
              ? undefined
              : {
                  onPending(pending) {
                    controller.signal.throwIfAborted();
                    setPendingPath(pending);
                  }
                }
          );
          controller.signal.throwIfAborted();
          setResolvedPath(resolved, { active: !options?.prefetch && !resolved.redirect });
          setRouteStatus({
            pathname,
            status: resolved.redirect ? "redirecting" : "ready",
            error: resolved.error,
            redirect: resolved.redirect
          });
          if (options?.prefetch) {
            return;
          }
          clearPendingPath(pathname);
          if (resolved.redirect) {
            const redirect = normalizeRedirectTarget(resolved.redirect, {
              allowExternal: props?.allowExternalRedirects
            });
            navigate(redirect, { replace: true });
            return;
          }
          applyResolvedHead(resolved);
        } catch (error) {
          if (!options?.prefetch) {
            clearPendingPath(pathname);
          }
          if (controller.signal.aborted) {
            setRouteStatus({ pathname, status: "idle", error: null });
            return;
          }
          setRouteStatus({
            pathname,
            status: "error",
            error
          });
        } finally {
          externalSignal?.removeEventListener("abort", abortFromExternal);
          if (navigationController === controller) {
            navigationController = null;
          }
          if (prefetchControllers.get(pathname) === controller) {
            prefetchControllers.delete(pathname);
          }
          pendingResolutions.delete(resolutionKey);
        }
      });

      pendingResolutions.set(resolutionKey, resolution);
      return resolution;
    }
  };
  runtimeState.resolver = resolver;

  return runtimeState;
}
