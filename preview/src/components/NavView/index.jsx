import { createTavo } from "@tavojs/core";
import {
  subscribeAvailableRoutes,
  subscribePathname,
  subscribeRouteStatus,
} from "@tavojs/core/router";

function labelFromPath(path) {
  if (path === "/") {
    return "Home";
  }
  const last = path.split("/").filter(Boolean).pop() ?? "Page";
  return last.charAt(0).toUpperCase() + last.slice(1);
}

function normalizePath(path) {
  if (!path) {
    return "/";
  }
  return path.startsWith("/") ? path : `/${path}`;
}

function splitPath(path) {
  return normalizePath(path).split("/").filter(Boolean);
}

function matchesRoutePath(pattern, pathname) {
  const routeParts = splitPath(pattern);
  const pathParts = splitPath(pathname);

  let index = 0;
  for (; index < routeParts.length; index += 1) {
    const routePart = routeParts[index];
    const pathPart = pathParts[index];

    if (routePart === "*") {
      return true;
    }
    if (routePart.startsWith("*?")) {
      return true;
    }
    if (routePart.startsWith(":?")) {
      continue;
    }
    if (routePart.startsWith(":")) {
      if (pathPart === undefined) {
        return false;
      }
      continue;
    }
    if (routePart !== pathPart) {
      return false;
    }
  }

  return index === pathParts.length;
}

function toNavLinks(routes) {
  const staticPaths = routes.map((route) => route.path);

  const unique = Array.from(new Set(staticPaths));
  return unique.map((path) => ({
    path,
    href: path
      .replace(/:\?([A-Za-z0-9_]+)/g, "$1")
      .replace(/:([A-Za-z0-9_]+)/g, "demo")
      .replace(/\*\?([A-Za-z0-9_]+)/g, "$1/one/two")
      .replace(/\*/g, "catch/all"),
    label: labelFromPath(path),
  }));
}

class NavController {
  syncRoute(pathname = this.page.pathname, routeStatus = this.page.status) {
    this.model.patch({
      pathname,
      routeStatus,
    });
  }

  syncLinks() {
    this.model.patch({
      links: toNavLinks(this.router.routes),
    });
  }

  onInit() {
    this.syncRoute();
    this.syncLinks();
    this.cleanup(
      subscribePathname((pathname) => {
        this.syncRoute(pathname);
      }),
    );
    this.cleanup(
      subscribeRouteStatus((status) => {
        this.model.patch({
          routeStatus: status.status,
        });
      }),
    );
    this.cleanup(
      subscribeAvailableRoutes(() => {
        this.syncLinks();
      }),
    );
  }
}

export const NavView = createTavo({
  model: () => ({
    pathname: "/",
    routeStatus: "idle",
    links: [],
  }),
  controller: NavController,
  view: ({ state, controller }) => {
    return (
      <nav className="tavo-nav">
        {state.links.map((link) => (
          <a
            key={link.href}
            href={link.href}
            title={`${link.path} -> ${link.href}`}
            className={
              matchesRoutePath(link.path, state.pathname)
                ? "tavo-nav-link tavo-nav-link--active"
                : "tavo-nav-link"
            }
            onClick={(event) => {
              event.preventDefault();
              controller?.router.navigate(link.href);
            }}
            onMouseEnter={() => controller?.router.prefetch(link.href)}
            onFocus={() => controller?.router.prefetch(link.href)}
          >
            <span>{link.label}</span>
            <code>{link.href}</code>
          </a>
        ))}
        <span className="tavo-badge">route: {state.routeStatus}</span>
      </nav>
    );
  },
});
