import type { Child } from "../../jsx.js";
import type { ElementTarget } from "../../observers/index.js";
import type {
  RouterNavigateOptions,
  RouterParams,
} from "../../router/index.js";
import type {
  ExternalStore,
  SelectorListener,
  Store,
  StoreListener,
  StorePath,
  StoreSelector,
  StoreWatchListener,
  Unsubscribe,
} from "../../store/index.js";
import type { PluginCapabilityResolver } from "../../plugins/index.js";
import type { ServiceIdentifier } from "../services.js";
import type {
  AnyRecord,
  PageRouteDefinition,
  RouteDataLayer,
} from "./pages.js";

type MvcContext<P extends AnyRecord, S extends AnyRecord, C> = {
  props: P;
  state: S;
  model: Store<S>;
  controller: C | null;
};

export type MvcControllerHooks<P extends AnyRecord> = {
  onInit?: () => void;
  onMount?: () => void | Unsubscribe;
  onLayout?: () => void | Unsubscribe;
  afterRender?: () => void;
  onDestroy?: () => void;
  onPropsChange?: (props: P) => void;
};

export type TavoAction<TResult, TArgs extends unknown[]> = {
  readonly pending: boolean;
  readonly error: unknown;
  readonly result: TResult | null;
  run(...args: TArgs): Promise<TResult>;
  reset(): void;
};

export type MvcControllerTools = {
  cleanup(fn: Unsubscribe): Unsubscribe;
  createId(prefix?: string): string;
  setTimeout(fn: () => void, delay?: number): Unsubscribe;
  setInterval(fn: () => void, delay?: number): Unsubscribe;
  scheduleLayoutEffect(fn: () => void | Unsubscribe): Unsubscribe;
  scheduleAfterRender(fn: () => void): Unsubscribe;
  scheduleOnMount(fn: () => void | Unsubscribe): Unsubscribe;
  action<TResult, TArgs extends unknown[]>(
    fn: (...args: TArgs) => Promise<TResult> | TResult,
  ): TavoAction<TResult, TArgs>;
  listen<T extends AnyRecord>(
    store: Store<T>,
    listener: StoreListener<T>,
    options?: { immediate?: boolean },
  ): Unsubscribe;
  select<T extends AnyRecord, S>(
    store: Store<T>,
    selector: StoreSelector<T, S>,
    listener: SelectorListener<S, T>,
    options?: { immediate?: boolean; isEqual?: (a: S, b: S) => boolean },
  ): Unsubscribe;
  watch<T extends AnyRecord, S>(
    store: Store<T>,
    target: StorePath | StoreSelector<T, S>,
    listener: StoreWatchListener<S, T>,
    options?: { immediate?: boolean; isEqual?: (a: S, b: S) => boolean },
  ): Unsubscribe;
  listenExternal<T>(
    store: ExternalStore<T>,
    listener: (snapshot: T, previousSnapshot: T) => void,
    options?: { immediate?: boolean; isEqual?: (a: T, b: T) => boolean },
  ): Unsubscribe;
  observeResize<T extends Element>(
    target: ElementTarget<T>,
    listener: ResizeObserverCallback,
    options?: ResizeObserverOptions,
  ): Unsubscribe;
  observeIntersection<T extends Element>(
    target: ElementTarget<T>,
    listener: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ): Unsubscribe;
  observeMutation<T extends Node>(
    target: T | { current: T | null },
    listener: MutationCallback,
    options?: MutationObserverInit,
  ): Unsubscribe;
};

export type MvcControllerFrameworkContext = {
  readonly router: {
    navigate(to: string, options?: RouterNavigateOptions): void;
    pushUrl(to: string): void;
    replaceUrl(to: string): void;
    prefetch(
      pathname: string,
      options?: { signal?: AbortSignal },
    ): Promise<void>;
    routes: PageRouteDefinition[];
  };
  readonly stores: {
    get<T extends AnyRecord>(name: string): Store<T>;
    has(name: string): boolean;
    list(): string[];
  };
  readonly services: {
    get<T>(name: ServiceIdentifier<T>): T;
    tryGet<T>(name: ServiceIdentifier<T>): T | undefined;
    has(name: ServiceIdentifier): boolean;
    list(): string[];
  };
  readonly capabilities: PluginCapabilityResolver;
  readonly page: {
    pathname: string;
    route: PageRouteDefinition | null;
    status:
      | "idle"
      | "loading"
      | "prefetching"
      | "ready"
      | "redirecting"
      | "error";
    data: unknown;
    params: RouterParams;
    error: unknown;
    layers: RouteDataLayer[];
    layerData: Record<string, unknown>;
  };
};

export type MvcControllerContext<P extends AnyRecord, S extends AnyRecord> = {
  model: Store<S>;
  props: P;
} & MvcControllerTools &
  MvcControllerFrameworkContext;

export type MvcComponentDefinition<
  P extends AnyRecord,
  S extends AnyRecord,
  C,
> = {
  model?: (props: P) => S | Store<S>;
  controller?: new (ctx: MvcControllerContext<P, S>) => C;
  createController?: (ctx: MvcControllerContext<P, S>) => C;
  view: (ctx: MvcContext<P, S, C>) => Child;
};
