import type { Child, Component } from "../jsx.js";
import { h } from "../jsx.js";
import { createTavo, TavoController } from "../framework/mvc.js";
import {
  createPagesManifestDetailed,
  isPageModuleLoader,
} from "../framework/manifest.js";
import { createPagesRuntime } from "../framework/runtime.js";
import type {
  PageModuleSource,
  PageModules,
  PagesRuntimePending,
  PagesRuntimeResolved
} from "../framework/types.js";
import { compilePattern, matchCompiledPattern, normalizePath, parsePageFile } from "../framework/path-utils.js";
import { RouterProvider } from "../router/react.js";
import {
  applyResolvedHead,
  consumeInitialResolvedState,
  ensureRouteListener,
  getCurrentPathname,
  getPendingRoute,
  getResolvedPathname,
  getResolvedRoute,
  getRouteStatus,
  setActiveRouteResolver,
  setActivePagesRuntime,
  setActiveRouter,
  setAvailableRoutes,
  setResolvedPath,
  setRouteStatus,
  subscribePathname,
  subscribePendingRoute,
  subscribeResolvedRoute,
  subscribeRouteStatus
} from "./state.js";
import type { AutoPagesAppProps, RuntimeContextValue, RouteStatus } from "./types.js";
import type { Store } from "../store/index.js";
import { TavoError } from "../diagnostics.js";
import {
  createAutoPagesRuntimeStateInternal,
  type AutoPagesRuntimeState
} from "./runtime-state.js";

export type { AutoPagesRuntimeState } from "./runtime-state.js";

/** View that resolves and renders current route output from auto-pages runtime state. */
type AutoPagesViewProps = {
  runtime: ReturnType<typeof createPagesRuntime>;
  initialResolved?: PagesRuntimeResolved | null;
  resolver: RuntimeContextValue;
};

type AutoPagesViewModel = {
  location: string;
  resolved: PagesRuntimeResolved | null;
  pending: PagesRuntimePending | null;
  skippedInitialResolve: boolean;
  requestedPathname: string | null;
};

class AutoPagesViewController extends TavoController {
  declare model: Store<AutoPagesViewModel>;
  declare props: AutoPagesViewProps;

  onMount() {
    this.cleanup(subscribePathname((pathname) => {
      this.model.patch({
        location: pathname,
        resolved: getResolvedRoute(pathname),
        pending: getPendingRoute(pathname)
      });
      this.resolveCurrent(pathname);
    }));
    this.cleanup(subscribeResolvedRoute((resolved) => {
      this.model.patch((state) => ({
        resolved,
        requestedPathname:
          resolved?.pathname === state.requestedPathname ? null : state.requestedPathname
      }));
    }));
    this.cleanup(subscribePendingRoute((pending) => {
      this.model.patch({ pending });
    }));
    this.resolveCurrent(this.model.getState().location);
  }

  onPropsChange() {
    this.resolveCurrent(this.model.getState().location);
  }

  private resolveCurrent(location: string) {
    const state = this.model.getState();
    if (
      (state.resolved?.pathname === location && !state.resolved.redirect) ||
      state.requestedPathname === location
    ) {
      return;
    }
    if (
      !state.skippedInitialResolve &&
      this.props.initialResolved &&
      this.props.initialResolved.pathname === location
    ) {
      this.model.patch({ skippedInitialResolve: true });
      return;
    }
    this.model.patch({ requestedPathname: location });
    this.props.resolver.resolvePath(location);
  }
}

const AutoPagesView = createTavo<AutoPagesViewProps, AutoPagesViewModel, AutoPagesViewController>({
  model: (props) => ({
    location: getCurrentPathname(),
    resolved: getResolvedRoute(getCurrentPathname()),
    pending: getPendingRoute(getCurrentPathname()),
    skippedInitialResolve: false,
    requestedPathname: null
  }),
  controller: AutoPagesViewController,
  view: ({ props, state }) => {
    const location = state.location;
    const resolved = state.resolved;
    const pending = state.pending;

    if (pending?.pathname === location) {
      return pending.node;
    }
    if (!resolved && props.initialResolved && props.initialResolved.pathname === location) {
      return props.initialResolved.node;
    }
    if (!resolved) {
      return null;
    }
    if (resolved.redirect) {
      return null;
    }

    return resolved.node;
  }
});

/** Connects auto-pages route loading state to router accessibility chrome. */
type AutoPagesRouterShellProps = {
  runtime: ReturnType<typeof createPagesRuntime>;
  notFoundView: Child;
  initialResolved?: PagesRuntimeResolved | null;
  resolver: RuntimeContextValue;
};

type AutoPagesRouterShellModel = {
  status: RouteStatus;
};

class AutoPagesRouterShellController extends TavoController {
  declare model: Store<AutoPagesRouterShellModel>;

  onMount() {
    this.cleanup(subscribeRouteStatus((status) => {
      this.model.patch({ status });
    }));
  }
}

const AutoPagesRouterShell = createTavo<
  AutoPagesRouterShellProps,
  AutoPagesRouterShellModel,
  AutoPagesRouterShellController
>({
  model: () => ({
    status: getRouteStatus()
  }),
  controller: AutoPagesRouterShellController,
  view: ({ props, state }) => {
    const busy = state.status.status === "loading" || state.status.status === "prefetching";

    return h(RouterProvider as unknown as Component, {
      router: props.runtime.router,
      notFound: props.notFoundView,
      busy,
      contentId: "tavo-route-content",
      children: h(AutoPagesView as unknown as Component, {
        runtime: props.runtime,
        initialResolved: props.initialResolved,
        resolver: props.resolver
      })
    });
  }
});

/** Discovers page modules via bundler glob support using the framework convention. */
export function discoverPagesModules(pattern = "/src/pages/**/*.{js,jsx,ts,tsx}"): PageModules {
  const defaultPattern = "/src/pages/**/*.{js,jsx,ts,tsx}";

  if (pattern !== defaultPattern) {
    throw new TavoError(
      "TAVO_PAGES_003",
      `tavo pages: dynamic patterns are not supported for auto-discovery. ` +
        `Use "${defaultPattern}" or pass modules explicitly.`,
      { details: { pattern, supportedPattern: defaultPattern } }
    );
  }

  try {
    // Vite-style macro: must be direct `import.meta.glob(<literal>)`.
    // @ts-expect-error - `glob` is injected by Vite-like bundlers.
    const discovered = import.meta.glob("/src/pages/**/*.{js,jsx,ts,tsx}") as Record<
      string,
      () => Promise<unknown>
    >;
    const wrapped: PageModules = {};
    for (const [file, loader] of Object.entries(discovered)) {
      const lazyLoader = (async () => (await loader()) as PageModuleSource) as PageModules[string];
      (lazyLoader as { __tavo_loader__?: true }).__tavo_loader__ = true;
      wrapped[file] = lazyLoader;
    }
    return wrapped;
  } catch {
    throw new TavoError(
      "TAVO_PAGES_004",
      "tavo pages: import.meta.glob is unavailable. Use a Vite-like bundler or pass modules explicitly.",
      { hint: "Use the Tavo Vite configuration helper or pass a modules object to bootTavo()." }
    );
  }
}

/** Preloads only the page/layout modules needed to hydrate the current pathname. */
export async function prepareModulesForPath(
  modules: PageModules,
  pathname: string,
  options?: Pick<AutoPagesAppProps, "i18n">
): Promise<PageModules> {
  const manifest = createPagesManifestDetailed(modules);
  const routePathname = normalizePath(options?.i18n?.resolvePath(pathname).pathname ?? pathname);
  const route =
    manifest.routes.find((candidate) => {
      const compiled = compilePattern(candidate.path);
      return compiled.dynamic ? matchCompiledPattern(compiled, routePathname) !== null : candidate.path === routePathname;
    }) ?? null;

  const filesToLoad = new Set<string>();
  if (route) {
    filesToLoad.add(route.file);
    for (const layer of route.layoutLayers) {
      filesToLoad.add(layer.file);
    }
  } else {
    for (const file of Object.keys(modules)) {
      if (parsePageFile(file).fileStem === "404") {
        filesToLoad.add(file);
      }
    }
  }

  for (const file of filesToLoad) {
    const source = modules[file];
    if (source && isPageModuleLoader(source)) {
      modules[file] = await source();
    }
  }

  return modules;
}

export function createAutoPagesRuntimeState(props: AutoPagesAppProps | undefined): AutoPagesRuntimeState {
  return createAutoPagesRuntimeStateInternal(props, discoverPagesModules);
}

class AutoPagesAppController extends TavoController {
  declare model: Store<AutoPagesRuntimeState>;
  declare props: AutoPagesAppProps;

  onMount() {
    const { runtime, initialResolved, resolver } = this.model.getState();
    setActiveRouter(runtime.router);
    setActiveRouteResolver(resolver);
    setActivePagesRuntime(runtime);
    setAvailableRoutes(runtime.routes);
    ensureRouteListener(this.props.csrActions);
    const consumedInitialResolved = consumeInitialResolvedState();
    const resolvedForHydration =
      consumedInitialResolved?.pathname === getResolvedPathname()
        ? consumedInitialResolved
        : initialResolved?.pathname === getResolvedPathname()
          ? initialResolved
          : null;
    if (resolvedForHydration) {
      const routePath =
        "routePath" in resolvedForHydration
          ? resolvedForHydration.routePath
          : resolvedForHydration.route?.path;
      const route = runtime.routes.find((candidate) => candidate.path === routePath) ?? null;
      const hydratedResolved = {
        ...resolvedForHydration,
        route,
        node: runtime.renderResolved({
          ...resolvedForHydration,
          route,
          node: null
        })
      };
      setResolvedPath(hydratedResolved);
      setRouteStatus({
        pathname: resolvedForHydration.pathname,
        status: resolvedForHydration.redirect ? "redirecting" : "ready",
        error: resolvedForHydration.error,
        redirect: resolvedForHydration.redirect
      });
      applyResolvedHead(hydratedResolved);
    } else {
      resolver.resolvePath(getResolvedPathname()).catch(() => {
        // Ignore boot resolve errors to keep runtime resilient.
      });
    }
    return () => {
      this.model.getState().dispose();
      setActiveRouteResolver(null);
      setActivePagesRuntime(null);
      setActiveRouter(null);
    };
  }

  afterRender() {
    const { runtime } = this.model.getState();
    setAvailableRoutes(runtime.routes);
  }
}

/** Top-level auto-pages app that wires runtime, navigation state, and rendering. */
type AutoPagesAppInternalProps = AutoPagesAppProps & {
  runtimeState?: AutoPagesRuntimeState;
};

export const AutoPagesApp = createTavo<AutoPagesAppInternalProps, AutoPagesRuntimeState, AutoPagesAppController>({
  model: (props) => props.runtimeState ?? createAutoPagesRuntimeState(props),
  controller: AutoPagesAppController,
  view: ({ props, state }) => {
  const runtime = state.runtime;
  const initialResolved = state.initialResolved;
  const resolver = state.resolver;
  setAvailableRoutes(runtime.routes);

  const notFoundView =
    props?.notFound === undefined
      ? null
      : h(props.notFound as unknown as Component, {
          pathname: getResolvedPathname()
        });

  return h(AutoPagesRouterShell as unknown as Component, {
      runtime,
      notFoundView,
      initialResolved,
      resolver
  });
  }
});
