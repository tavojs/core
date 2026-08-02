import type { Child, ClassName, VNode } from "../jsx.js";

export type RefObject<T> = { current: T };

export type ErrorBoundaryFallback = Child | ((error: unknown) => Child);

export type ContextProviderProps<T> = {
  value: T;
  children?: Child;
};

export type ErrorBoundaryProps = {
  children?: Child;
  fallback: ErrorBoundaryFallback;
  resetKey?: unknown;
};

export type TavoContext<T> = {
  readonly id: symbol;
  readonly defaultValue: T;
  Provider: (props: ContextProviderProps<T>) => ContextProviderVNode;
};

export type DeferredState<T> =
  | { status: "pending"; data: null; error: null }
  | { status: "resolved"; data: T; error: null }
  | { status: "rejected"; data: null; error: unknown };

export type DeferredRender<T> = (value: T) => Child;
export type DeferredErrorFallback = Child | ((error: unknown) => Child);
export type DeferredTimeoutFallback = Child | ((error: unknown) => Child);

export type DeferredTimeoutError = {
  code: "TAVO_DEFERRED_TIMEOUT";
  id?: string;
  timeoutMs: number;
  message: string;
};

export type DeferredProps<T> = {
  value: Promise<T> | T | DeferredValue<T>;
  fallback?: Child;
  children: DeferredRender<T> | Child;
  id?: string;
  as?: string;
  errorFallback?: DeferredErrorFallback;
  serialize?: (value: T) => unknown;
  deserialize?: (value: unknown) => T;
  timeoutMs?: number;
  timeoutFallback?: DeferredTimeoutFallback;
  signal?: AbortSignal;
};

export type DeferredValue<T> = {
  id?: string;
  promise: Promise<T>;
  serialize?: (value: T) => unknown;
  deserialize?: (value: unknown) => T;
  timeoutMs?: number;
  timeoutFallback?: DeferredTimeoutFallback;
  signal?: AbortSignal;
};

export type ContextProviderVNode = VNode & {
  type: symbol;
  props: {
    context: TavoContext<unknown>;
    value: unknown;
    children: Child[];
    key?: string | number;
  };
};

export type ErrorBoundaryVNode = VNode & {
  type: symbol;
  props: {
    fallback: ErrorBoundaryFallback;
    resetKey?: unknown;
    children: Child[];
    key?: string | number;
  };
};

export type DeferredVNode = VNode & {
  type: symbol;
  props: {
    value: Promise<unknown> | unknown | DeferredValue<unknown>;
    fallback?: Child;
    children: Child[];
    id?: string;
    as?: string;
    errorFallback?: DeferredErrorFallback;
    serialize?: (value: unknown) => unknown;
    deserialize?: (value: unknown) => unknown;
    timeoutMs?: number;
    timeoutFallback?: DeferredTimeoutFallback;
    signal?: AbortSignal;
    key?: string | number;
  };
};

export type HeadProps = {
  title?: string;
  unsafeHeadHtml?: string;
  children?: Child;
};

export type FontDisplay = "auto" | "block" | "swap" | "fallback" | "optional";

export type FontProps = {
  href?: string;
  src?: string;
  family?: string;
  local?: string[];
  weight?: string | number;
  style?: "normal" | "italic" | "oblique";
  display?: FontDisplay;
  preload?: boolean;
  preconnect?: string[];
  crossOrigin?: "anonymous" | "use-credentials";
  type?: string;
  variable?: `--${string}`;
  fallback?: string;
};

export type ScriptProps = {
  src?: string;
  type?: string;
  async?: boolean;
  defer?: boolean;
  module?: boolean;
  noModule?: boolean;
  preload?: boolean;
  content?: string;
  json?: unknown;
  id?: string;
  nonce?: string;
  integrity?: string;
  crossOrigin?: "anonymous" | "use-credentials";
  referrerPolicy?:
    | "no-referrer"
    | "no-referrer-when-downgrade"
    | "origin"
    | "origin-when-cross-origin"
    | "same-origin"
    | "strict-origin"
    | "strict-origin-when-cross-origin"
    | "unsafe-url";
  fetchPriority?: "high" | "low" | "auto";
};

export type SeoOpenGraph = {
  title?: string;
  description?: string;
  type?: string;
  url?: string;
  image?: string;
  imageAlt?: string;
  siteName?: string;
  locale?: string;
};

export type SeoTwitter = {
  card?: "summary" | "summary_large_image" | "app" | "player";
  title?: string;
  description?: string;
  image?: string;
  creator?: string;
  site?: string;
};

export type SeoProps = {
  title?: string;
  description?: string;
  canonical?: string;
  robots?: string;
  noIndex?: boolean;
  noFollow?: boolean;
  keywords?: string | string[];
  author?: string;
  themeColor?: string;
  openGraph?: SeoOpenGraph;
  twitter?: SeoTwitter;
};

export type ImageFormat = "webp" | "avif" | "jpeg" | "png" | "original";

export type ImageProps = {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  widths?: number[];
  sizes?: string;
  quality?: number;
  format?: ImageFormat;
  priority?: boolean;
  unoptimized?: boolean;
  loading?: "lazy" | "eager";
  decoding?: "async" | "sync" | "auto";
  fetchPriority?: "high" | "low" | "auto";
  srcset?: string;
  className?: ClassName;
  style?: string | Record<string, unknown>;
  [key: string]: unknown;
};
