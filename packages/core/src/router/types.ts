import type { Component } from "../jsx.js";
import type { ResolvedUrlPolicy } from "./url-policy.js";

export type RouterParams = Record<string, string>;

export type RouteConfig = {
  path: string;
  component: Component<{ params: RouterParams }>;
};

export type RouterNavigateOptions = {
  replace?: boolean;
  scroll?: boolean;
};

export type Router = {
  navigate(to: string, options?: RouterNavigateOptions): void;
  getPathname(): string;
  match(pathname: string): { route: RouteConfig | null; params: RouterParams };
  /** Returns the canonical form for known route URLs; unknown URLs are unchanged. */
  canonicalize(to: string): string;
  readonly urlPolicy: ResolvedUrlPolicy;
};

export type CreateRouterOptions = {
  routing?: { trailingSlash?: import("./url-policy.js").TrailingSlashPolicy };
  /** Maps localized/public paths to the pathname used by the route manifest. */
  resolveRoutePathname?: (pathname: string) => string;
};
