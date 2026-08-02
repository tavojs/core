import { createStore } from "../store/index.js";
import type {
  CsrActionsOptions,
  PageRouteDefinition,
  PagesRuntime,
  PagesRuntimePending,
  PagesRuntimeResolved
} from "../framework/types.js";
import { createRouterHistoryState, prepareRouterScrollNavigation } from "../router/scroll.js";
import type { RouterNavigateOptions } from "../router/index.js";
import type {
  AutoPagesDocumentState,
  AutoPagesHydrationResolved,
  AutoPagesInspection,
  ResolutionState,
  RouteStatus,
  RouteStatusState,
  RoutesState,
  NavigationState,
  RuntimeContextValue,
} from "./types.js";
import {
  configureCsrActions as configureCsrActionsInternal,
  ensureFormInterceptor,
  resetCsrActions
} from "./csr-actions.js";

export { resolveTavoActionUrl } from "./csr-actions.js";

/** Reads current browser pathname with a safe server fallback. */
function resolvePathname(): string {
  if (typeof window === "undefined") {
    return "/";
  }
  return window.location.pathname || "/";
}

/** Resolves a target navigation path into a normalized browser pathname. */
function resolveNavigationTargetPathname(to: string): string {
  if (!to) {
    return "/";
  }
  if (typeof window === "undefined") {
    const [pathname] = to.split(/[?#]/, 1);
    return pathname || "/";
  }
  try {
    return new URL(to, window.location.href).pathname || "/";
  } catch {
    const [pathname] = to.split(/[?#]/, 1);
    return pathname || "/";
  }
}

function resolveSameOriginUrl(to: string): string {
  if (typeof window === "undefined") {
    return to || "/";
  }
  const url = new URL(to || "/", window.location.href);
  if (url.origin !== window.location.origin) {
    throw new Error("tavo router: URL-only history updates must stay on the current origin.");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

function createRoutePopStateEvent(): Event {
  return window.PopStateEvent ? new window.PopStateEvent("popstate") : new window.Event("popstate");
}

const navigationStore = createStore<NavigationState>({
  pathname: resolvePathname(),
});
const routesStore = createStore<RoutesState>({ routes: [] });
const resolutionStore = createStore<ResolutionState>({
  byPath: {},
  pendingByPath: {},
  activePathname: resolvePathname(),
});
const routeStatusStore = createStore<RouteStatusState>({ byPath: {} });

let activeRouter: {
  navigate(to: string, options?: RouterNavigateOptions): void;
} | null = null;
let activeResolver: RuntimeContextValue | null = null;
let activePagesRuntime: PagesRuntime | null = null;
let routeListenerWindow: Window | null = null;
let linkInterceptorDocument: Document | null = null;
let consumedInitialResolved = false;

function readDocumentState(): AutoPagesDocumentState | null {
  if (typeof document === "undefined") {
    return null;
  }
  const script = document.getElementById("__TAVO_STATE__");
  if (!script || script.textContent == null) {
    return null;
  }
  try {
    return JSON.parse(script.textContent) as AutoPagesDocumentState;
  } catch {
    return null;
  }
}

/** Returns the current resolved pathname used by auto-pages state. */
export function getResolvedPathname(): string {
  return resolvePathname();
}

/** Initializes singleton browser state for a newly mounted auto-pages root. */
export function initializeAutoPagesClientState(): void {
  const pathname = resolvePathname();
  activeRouter = null;
  activeResolver = null;
  activePagesRuntime = null;
  resetCsrActions();
  consumedInitialResolved = false;
  navigationStore.setState({ pathname });
  routesStore.setState({ routes: [] });
  resolutionStore.setState({
    byPath: {},
    pendingByPath: {},
    activePathname: pathname
  });
  routeStatusStore.setState({ byPath: {} });
}

/** Synchronizes internal pathname store with browser location. */
function syncPathnameFromLocation(): void {
  navigationStore.setState((previous) => {
    const pathname = resolvePathname();
    if (previous.pathname === pathname) {
      return previous;
    }
    return { pathname };
  });
}

/** Returns true when an anchor click should be handled by the client router. */
function shouldInterceptAnchorClick(event: MouseEvent, anchor: HTMLAnchorElement): boolean {
  if (event.defaultPrevented || event.button !== 0) {
    return false;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if (anchor.hasAttribute("download")) {
    return false;
  }
  const target = anchor.getAttribute("target");
  if (target && target !== "_self") {
    return false;
  }
  const href = anchor.getAttribute("href");
  if (!href || href.startsWith("#")) {
    return false;
  }

  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) {
    return false;
  }
  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) {
    return false;
  }

  return true;
}

/** Attaches a delegated document click listener to convert internal anchors to SPA navigation. */
function ensureLinkInterceptor(): void {
  if (
    typeof document === "undefined"
    || linkInterceptorDocument === document
  ) {
    return;
  }
  linkInterceptorDocument = document;

  document.addEventListener("click", (event) => {
    const mouseEvent = event as MouseEvent;
    const target = mouseEvent.target as Element | null;
    const anchor = target?.closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor || !shouldInterceptAnchorClick(mouseEvent, anchor)) {
      return;
    }

    const url = new URL(anchor.href, window.location.href);
    mouseEvent.preventDefault();
    navigate(`${url.pathname}${url.search}${url.hash}`);
  });
}

/** Attaches a one-time popstate listener to keep pathname state fresh. */
export function ensureRouteListener(csrActions?: CsrActionsOptions): void {
  configureCsrActions(csrActions);
  if (typeof window === "undefined") {
    return;
  }
  syncPathnameFromLocation();
  if (routeListenerWindow !== window) {
    routeListenerWindow = window;
    window.addEventListener("popstate", syncPathnameFromLocation);
  }
  ensureLinkInterceptor();
  ensureFormInterceptor();
}

/** Stores the active CSR action config for helpers and delegated form submissions. */
export function configureCsrActions(csrActions?: CsrActionsOptions): void {
  configureCsrActionsInternal(csrActions, navigate);
}

/** Stores the active router instance for imperative navigation calls. */
export function setActiveRouter(
  router: {
    navigate(to: string, options?: RouterNavigateOptions): void;
  } | null,
): void {
  activeRouter = router;
}

/** Stores the active auto-pages resolver used by prefetch and status APIs. */
export function setActiveRouteResolver(resolver: RuntimeContextValue | null): void {
  activeResolver = resolver;
}

export function setActivePagesRuntime(runtime: PagesRuntime | null): void {
  activePagesRuntime = runtime;
}

/** Returns the currently mounted pages runtime for framework integrations. */
export function getActivePagesRuntime(): PagesRuntime | null {
  return activePagesRuntime;
}

/** Returns a privacy-safe snapshot for first-party development tools. */
export function getAutoPagesInspection(): AutoPagesInspection {
  const pathname = getCurrentPathname();
  const resolved = getResolvedRoute(pathname);
  return {
    pathname,
    route: resolved?.route?.path ?? null,
    status: getRouteStatus(pathname).status,
    params: { ...(resolved?.params ?? {}) },
    runtime: activePagesRuntime?.inspect() ?? null,
  };
}

/** Updates the reactive route catalog available to app consumers. */
export function setAvailableRoutes(routes: PageRouteDefinition[]): void {
  routesStore.setState((previous) => {
    if (previous.routes.length === routes.length && previous.routes.every((route, index) => Object.is(route, routes[index]))) {
      return previous;
    }
    return { routes };
  });
}

/** Merges a newly resolved page result into cached resolution state. */
export function mergeResolved(state: ResolutionState, resolved: PagesRuntimeResolved, options?: { active?: boolean }): ResolutionState {
  return {
    byPath: {
      ...state.byPath,
      [resolved.pathname]: resolved,
    },
    pendingByPath: state.pendingByPath,
    activePathname: options?.active === false ? state.activePathname : resolved.pathname,
  };
}

/** Commits a resolved page payload into reactive resolution storage. */
export function setResolvedPath(resolved: PagesRuntimeResolved, options?: { active?: boolean }): void {
  resolutionStore.setState((state) => mergeResolved(state, resolved, options));
}

/** Publishes a route-specific pending view while its page loader is running. */
export function setPendingPath(pending: PagesRuntimePending): void {
  resolutionStore.patch((state) => ({
    pendingByPath: {
      ...state.pendingByPath,
      [pending.pathname]: pending
    }
  }));
}

/** Removes a route-specific pending view after resolution, cancellation, or failure. */
export function clearPendingPath(pathname: string): void {
  resolutionStore.patch((state) => {
    if (!(pathname in state.pendingByPath)) return state;
    const pendingByPath = { ...state.pendingByPath };
    delete pendingByPath[pathname];
    return { pendingByPath };
  });
}

/** Removes all transient pending views when the pages runtime is disposed. */
export function clearPendingPaths(): void {
  resolutionStore.patch({ pendingByPath: {} });
}

/** Reads the serialized SSR route payload once so hydration can reuse it without refetching. */
export function consumeInitialResolvedState(): AutoPagesHydrationResolved | null {
  if (consumedInitialResolved) {
    return null;
  }
  consumedInitialResolved = true;
  return readDocumentState()?.autoPagesResolved ?? null;
}

/** Reads the serialized SSR route payload without consuming it. */
export function peekInitialResolvedState(): AutoPagesHydrationResolved | null {
  return readDocumentState()?.autoPagesResolved ?? null;
}

/** Updates route loading/prefetch status for developer-facing route state. */
export function setRouteStatus(status: RouteStatus): void {
  routeStatusStore.patch((state) => ({
    byPath: {
      ...state.byPath,
      [status.pathname]: status,
    },
  }));
}

export { applyResolvedHead } from "./resolved-head.js";

/** Reads the resolved route payload for one pathname or the current active location. */
export function getResolvedRoute(pathname = getCurrentPathname()): PagesRuntimeResolved | null {
  const state = resolutionStore.getState();
  return state.byPath[pathname] ?? state.byPath[state.activePathname] ?? null;
}

/** Reads a route-specific pending view without falling back to the active page. */
export function getPendingRoute(pathname = getCurrentPathname()): PagesRuntimePending | null {
  return resolutionStore.getState().pendingByPath[pathname] ?? null;
}

/** Subscribes to resolved route changes for one pathname or the active location. */
export function subscribeResolvedRoute(listener: (resolved: PagesRuntimeResolved | null) => void, pathname?: string): () => void {
  return resolutionStore.subscribe((state) => {
    listener(state.byPath[pathname ?? state.activePathname] ?? null);
  });
}

/** Subscribes to pending-view changes for one pathname or the current location. */
export function subscribePendingRoute(listener: (pending: PagesRuntimePending | null) => void, pathname?: string): () => void {
  return resolutionStore.subscribe((state) => {
    listener(state.pendingByPath[pathname ?? getCurrentPathname()] ?? null);
  });
}

/** Navigates using active router when available, with history fallback. */
export function navigate(to: string, options?: RouterNavigateOptions): void {
  const targetPathname = resolveNavigationTargetPathname(to);
  navigationStore.setState((previous) => {
    if (previous.pathname === targetPathname) {
      return previous;
    }
    return { pathname: targetPathname };
  });

  if (activeRouter) {
    activeRouter.navigate(to, options);
    syncPathnameFromLocation();
    return;
  }
  if (typeof window === "undefined") {
    return;
  }

  prepareRouterScrollNavigation(to, options);
  const state = createRouterHistoryState(options);
  if (options?.replace) {
    window.history.replaceState(state, "", to);
  } else {
    window.history.pushState(state, "", to);
  }
  window.dispatchEvent(createRoutePopStateEvent());
  syncPathnameFromLocation();
}

/** Updates the browser URL without resolving or rendering another route. */
export function updateBrowserUrl(to: string, options?: { replace?: boolean }): void {
  if (typeof window === "undefined") {
    return;
  }
  const target = resolveSameOriginUrl(to);
  if (options?.replace) {
    window.history.replaceState({}, "", target);
  } else {
    window.history.pushState({}, "", target);
  }
}

/** Prefetches a route by resolving its loaders without changing browser location. */
export async function prefetchRoute(pathname: string, options?: { signal?: AbortSignal }): Promise<void> {
  if (!activeResolver) {
    setRouteStatus({ pathname, status: "idle", error: null });
    return;
  }
  await activeResolver.resolvePath(pathname, getCurrentPathname(), {
    prefetch: true,
    signal: options?.signal,
  });
}

/** Reads current pathname from the reactive navigation store. */
export function getCurrentPathname(): string {
  return navigationStore.getState().pathname;
}

/** Subscribes to pathname changes. */
export function subscribePathname(listener: (pathname: string) => void): () => void {
  return navigationStore.subscribe((state) => {
    listener(state.pathname);
  });
}

/** Reads current available routes from the reactive route store. */
export function getAvailableRoutes(): PageRouteDefinition[] {
  return routesStore.getState().routes;
}

/** Subscribes to route catalog updates. */
export function subscribeAvailableRoutes(listener: (routes: PageRouteDefinition[]) => void): () => void {
  return routesStore.subscribe((state) => {
    listener(state.routes);
  });
}

/** Reads current route status state for a pathname. */
export function getRouteStatus(pathname = getCurrentPathname()): RouteStatus {
  return (
    routeStatusStore.getState().byPath[pathname] ?? {
      pathname,
      status: "idle",
      error: null,
    }
  );
}

/** Subscribes to route status changes for one pathname or all routes. */
export function subscribeRouteStatus(listener: (status: RouteStatus, all: RouteStatusState) => void, pathname?: string): () => void {
  return routeStatusStore.subscribe((state) => {
    const status = pathname
      ? (state.byPath[pathname] ?? {
          pathname,
          status: "idle" as const,
          error: null,
        })
      : (state.byPath[state.byPath[getCurrentPathname()]?.pathname ?? getCurrentPathname()] ?? {
          pathname: getCurrentPathname(),
          status: "idle" as const,
          error: null,
        });
    listener(status, state);
  });
}
