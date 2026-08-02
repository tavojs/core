import type { Child, Component, PropsWithChildren } from "../jsx.js";
import { h } from "../jsx.js";
import {
  getActiveComponent,
  getComponentCell,
  registerComponentCleanup
} from "../runtime/dom/component-runtime.js";

export type LazyModule<P extends Record<string, unknown>> =
  | Component<P>
  | {
      default: Component<P>;
    };

export type LazyLoader<P extends Record<string, unknown>> = () => Promise<LazyModule<P>>;

export type LazyPendingState = {
  status: "idle" | "loading";
};

export type LazyErrorState = {
  status: "error";
  error: unknown;
};

export type LazyFallback = Child | ((state: LazyPendingState) => Child);
export type LazyErrorFallback = Child | ((state: LazyErrorState) => Child);

export type LazyOptions = {
  fallback?: LazyFallback;
  errorFallback?: LazyErrorFallback;
};

export type LazyStatus<P extends Record<string, unknown>> =
  | { status: "idle"; component: null; error: null }
  | { status: "loading"; component: null; error: null }
  | { status: "loaded"; component: Component<P>; error: null }
  | { status: "error"; component: null; error: unknown };

export type LazyComponent<P extends Record<string, unknown>> = Component<P> & {
  preload(): Promise<Component<P>>;
  getStatus(): LazyStatus<P>;
};

type LazyCell = {
  subscribed: boolean;
};

function isBrowserRuntime(): boolean {
  return typeof window !== "undefined" && typeof document !== "undefined";
}

function renderPendingFallback(fallback: LazyFallback | undefined, status: LazyPendingState["status"]): Child {
  if (typeof fallback === "function") {
    return (fallback as (state: LazyPendingState) => Child)({ status });
  }
  return fallback ?? null;
}

function renderErrorFallback(fallback: LazyErrorFallback | undefined, error: unknown): Child {
  if (typeof fallback === "function") {
    return (fallback as (state: LazyErrorState) => Child)({ status: "error", error });
  }
  return fallback ?? null;
}

function normalizeLazyModule<P extends Record<string, unknown>>(loaded: LazyModule<P>): Component<P> {
  if (typeof loaded === "function") {
    return loaded;
  }
  if (loaded && typeof loaded.default === "function") {
    return loaded.default;
  }
  throw new Error("tavo lazy: loader must resolve to a component or a module with a default component.");
}

/** Creates a component that loads its implementation with a dynamic import on first render. */
export function lazy<P extends Record<string, unknown> = Record<string, unknown>>(
  loader: LazyLoader<P>,
  options: LazyOptions = {}
): LazyComponent<P> {
  const cellKey = Symbol("tavo.lazy.cell");
  const listeners = new Set<() => void>();
  let pending: Promise<Component<P>> | null = null;
  let status: LazyStatus<P> = { status: "idle", component: null, error: null };

  function notify(): void {
    for (const listener of Array.from(listeners)) {
      listener();
    }
  }

  function load(): Promise<Component<P>> {
    if (status.status === "loaded") {
      return Promise.resolve(status.component);
    }
    if (pending) {
      return pending;
    }

    status = { status: "loading", component: null, error: null };
    pending = loader()
      .then((loaded) => {
        const component = normalizeLazyModule(loaded);
        status = { status: "loaded", component, error: null };
        return component;
      })
      .catch((error: unknown) => {
        status = { status: "error", component: null, error };
        throw error;
      })
      .finally(() => {
        pending = null;
        notify();
      });
    return pending;
  }

  function subscribeActiveComponent(): void {
    const active = getActiveComponent();
    if (!active) {
      return;
    }

    const cell = getComponentCell<LazyCell>(cellKey, () => ({ subscribed: false }));
    if (cell.subscribed) {
      return;
    }

    const rerender = active.rerender;
    listeners.add(rerender);
    cell.subscribed = true;
    registerComponentCleanup(() => {
      listeners.delete(rerender);
      cell.subscribed = false;
    });
  }

  const Lazy = ((props: PropsWithChildren<P>) => {
    if (status.status === "loaded") {
      return h(status.component as Component, props);
    }
    if (status.status === "error") {
      if (options.errorFallback !== undefined) {
        return renderErrorFallback(options.errorFallback, status.error);
      }
      throw status.error;
    }

    subscribeActiveComponent();
    if (isBrowserRuntime()) {
      void load().catch(() => {
        // The next render either throws into ErrorBoundary or renders errorFallback.
      });
    }

    return renderPendingFallback(options.fallback, status.status);
  }) as LazyComponent<P>;

  Lazy.preload = load;
  Lazy.getStatus = () => status;

  return Lazy;
}
