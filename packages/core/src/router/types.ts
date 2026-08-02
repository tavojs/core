import type { Component } from "../jsx.js";

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
};
