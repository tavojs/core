import type { Child, ClassName } from "../jsx.js";
import { h } from "../jsx.js";
import { createTavo, TavoController } from "../framework/mvc.js";
import { getService, hasService } from "../framework/services.js";
import { DEFAULT_I18N_SERVICE_NAME, type AnyI18nService } from "../i18n/index.js";
import { createStore, type Store } from "../store/index.js";
import { createRouter } from "./core.js";
import { normalizePath } from "./path.js";
import {
  applyRouterScroll,
  ensureRouterScrollRestoration
} from "./scroll.js";
import type { Router } from "./types.js";

type RouterState = {
  router: Router | null;
  pathname: string;
};

const activeRouterStore = createStore<RouterState>({
  router: null,
  pathname: "/"
});

function setActiveRouterState(router: Router | null, pathname: string): void {
  activeRouterStore.setState((previous) => {
    if (previous.router === router && previous.pathname === pathname) {
      return previous;
    }
    return { router, pathname };
  });
}

const liveRegionStyle = {
  position: "absolute",
  width: "1px",
  height: "1px",
  padding: 0,
  margin: "-1px",
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0
} as const;

function announceLabel(pathname: string, busy?: boolean): string {
  if (busy) {
    return pathname === "/" ? "Loading home page" : `Loading ${pathname}`;
  }
  return pathname === "/" ? "Home" : `Navigated to ${pathname}`;
}

function focusRouteTarget(contentId?: string): void {
  if (typeof document === "undefined") {
    return;
  }
  const region = contentId
    ? document.getElementById(contentId)
    : (document.querySelector("[data-tavo-route-region='true']") as HTMLElement | null);
  const target = (region?.querySelector(
    "[data-tavo-route-focus], main, h1, [role='main']"
  ) as HTMLElement | null) ?? region;
  if (!target || typeof target.focus !== "function") {
    return;
  }
  const previousTabIndex = target.getAttribute("tabindex");
  if (!target.hasAttribute("tabindex")) {
    target.setAttribute("tabindex", "-1");
  }
  try {
    target.focus({ preventScroll: true });
  } catch {
    target.focus();
  }
  if (previousTabIndex === null) {
    queueMicrotask(() => {
      if (target.getAttribute("tabindex") === "-1") {
        target.removeAttribute("tabindex");
      }
    });
  }
}

function withRouterChrome(
  announcement: string,
  content: Child,
  options?: {
    busy?: boolean;
    contentId?: string;
  }
): Child {
  return [
    h("div", {
      "aria-live": "polite",
      "aria-atomic": "true",
      role: "status",
      style: liveRegionStyle
    }, announcement),
    h(
      "div",
      {
        id: options?.contentId,
        "data-tavo-route-region": "true",
        "data-tavo-route-busy": options?.busy ? "true" : undefined,
        "aria-busy": options?.busy ? "true" : undefined,
        tabindex: -1
      },
      content
    )
  ];
}

type RouterProviderProps = {
  router: Router;
  notFound?: Child;
  children?: Child;
  busy?: boolean;
  contentId?: string;
  pathname?: string;
};

type RouterProviderModel = {
  pathname: string;
  focusedPath: string | null;
};

class RouterProviderController extends TavoController {
  declare model: Store<RouterProviderModel>;
  declare props: RouterProviderProps;

  onMount() {
    if (typeof window === "undefined") {
      return;
    }
    ensureRouterScrollRestoration();
    const sync = () => {
      const pathname = this.props.router.getPathname();
      if (this.model.getState().pathname !== pathname) {
        this.model.patch({ pathname });
      }
      setActiveRouterState(this.props.router, pathname);
    };
    sync();
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("popstate", sync);
    };
  }

  afterRender() {
    setActiveRouterState(this.props.router, this.model.getState().pathname);
  }

  onPropsChange(props: RouterProviderProps) {
    const pathname =
      typeof window === "undefined"
        ? normalizePath(props.pathname ?? props.router.getPathname())
        : props.router.getPathname();
    if (this.model.getState().pathname !== pathname) {
      this.model.patch({ pathname });
    }
    setActiveRouterState(props.router, pathname);
  }

  onLayout() {
    if (typeof window === "undefined") {
      return;
    }
    const { focusedPath, pathname } = this.model.getState();
    if (focusedPath === null) {
      this.model.patch({ focusedPath: pathname });
      return;
    }
    if (this.props.busy || focusedPath === pathname) {
      return;
    }
    this.model.patch({ focusedPath: pathname });
    focusRouteTarget(this.props.contentId);
    applyRouterScroll(pathname);
  }
}

/** Provides router context and renders either explicit children or matched route view. */
export const RouterProvider = createTavo<RouterProviderProps, RouterProviderModel, RouterProviderController>({
  model: (props) => ({
    pathname:
      typeof window === "undefined"
        ? normalizePath(props.pathname ?? props.router.getPathname())
        : props.router.getPathname(),
    focusedPath: null
  }),
  controller: RouterProviderController,
  view: ({ props, state }) => {
  // Make the router policy available while descendants are rendered on the server too.
  setActiveRouterState(props.router, state.pathname);
  const hasChildren =
    Array.isArray(props.children) ? props.children.length > 0 : props.children !== undefined;
  const announcement = announceLabel(state.pathname, props.busy);
  const match = props.router.match(state.pathname);

  if (hasChildren) {
    return withRouterChrome(
      announcement,
      props.children,
      {
        busy: props.busy,
        contentId: props.contentId
      }
    );
  }

  if (match.route) {
    const Matched = match.route.component;
    return withRouterChrome(
      announcement,
      Matched({ params: match.params }),
      {
        busy: props.busy,
        contentId: props.contentId
      }
    );
  }

  return withRouterChrome(
    announcement,
    props.notFound ?? null,
    {
      busy: props.busy,
      contentId: props.contentId
    }
  );
  }
});

export type LinkProps = Record<string, unknown> & {
  to: string;
  replace?: boolean;
  scroll?: boolean;
  className?: ClassName;
  children?: Child;
  target?: string;
  rel?: string;
  download?: string | boolean;
  "aria-current"?: string | boolean;
  onClick?: (event: MouseEvent) => void;
};

function resolveLinkUrl(to: string): URL | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return new URL(to, window.location.href);
  } catch {
    return null;
  }
}

function pathnameFromLinkTarget(to: string): string {
  const url = resolveLinkUrl(to);
  if (url) {
    return normalizePath(url.pathname);
  }
  const [withoutHash] = to.split("#", 1);
  const [pathname] = withoutHash.split("?", 1);
  return normalizePath(pathname || "/");
}

function shouldHandleLinkClick(
  event: MouseEvent,
  to: string,
  target?: string,
  download?: unknown,
): boolean {
  if (event.defaultPrevented || event.button !== 0) {
    return false;
  }
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return false;
  }
  if (target && target.toLowerCase() !== "_self") {
    return false;
  }
  if (download !== undefined && download !== null && download !== false) {
    return false;
  }
  const url = resolveLinkUrl(to);
  if (!url || url.origin !== window.location.origin) {
    return false;
  }
  if (url.pathname === window.location.pathname && url.search === window.location.search && url.hash) {
    return false;
  }
  return true;
}

function getActiveI18nService(): AnyI18nService | undefined {
  return hasService(DEFAULT_I18N_SERVICE_NAME)
    ? getService<AnyI18nService>(DEFAULT_I18N_SERVICE_NAME)
    : undefined;
}

function isNonRouteLinkTarget(to: string): boolean {
  const value = to.trimStart();
  return value.startsWith("//") || /^[a-z][a-z\d+.-]*:/i.test(value);
}

function localizeLinkTarget(to: string, i18n: AnyI18nService | undefined): string {
  if (!i18n || to.startsWith("#") || isNonRouteLinkTarget(to)) {
    return to;
  }
  const url = resolveLinkUrl(to);
  if (url) {
    if (typeof window !== "undefined" && url.origin !== window.location.origin) {
      return to;
    }
    return `${i18n.localizePath(url.pathname)}${url.search}${url.hash}`;
  }
  const [withoutHash, hash = ""] = to.split("#", 2);
  const [pathname = "/", search = ""] = withoutHash.split("?", 2);
  return `${i18n.localizePath(pathname || "/")}${search ? `?${search}` : ""}${hash ? `#${hash}` : ""}`;
}

function resolveActivePath(pathname: string, i18n: AnyI18nService | undefined): string {
  return normalizePath(i18n?.resolvePath(pathname).pathname ?? pathname);
}

/** Anchor component with SPA navigation behavior and browser fallback semantics. */
export const Link = createTavo<LinkProps, RouterState>({
  model: () => activeRouterStore,
  view: ({ props, state }) => {
    const {
      to,
      replace,
      scroll,
      children,
      onClick,
      target,
      download,
      ...anchorProps
    } = props;
    const i18n = getActiveI18nService();
    const nonRouteTarget = isNonRouteLinkTarget(to);
    const localizedHref = nonRouteTarget ? to : localizeLinkTarget(to, i18n);
    const href = nonRouteTarget
      ? to
      : state.router?.canonicalize(localizedHref) ?? localizedHref;
    const currentPath = resolveActivePath(state.pathname, i18n);
    const targetPath = resolveActivePath(pathnameFromLinkTarget(href), i18n);
    const ariaCurrent = Object.prototype.hasOwnProperty.call(props, "aria-current")
      ? props["aria-current"]
      : currentPath === targetPath ? "page" : undefined;
    return h(
      "a",
      {
        ...anchorProps,
        href,
        target,
        download,
        "aria-current": ariaCurrent,
        onClick(event: MouseEvent) {
          onClick?.(event);
          if (!state.router || !shouldHandleLinkClick(event, href, target, download)) {
            return;
          }
          event.preventDefault();
          const url = resolveLinkUrl(href);
          state.router.navigate(url ? `${url.pathname}${url.search}${url.hash}` : href, {
            replace,
            scroll
          });
        }
      },
      children
    );
  }
});

export { createRouter };
