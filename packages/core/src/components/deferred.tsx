import type { Child, Component } from "../jsx.js";
import { h } from "../jsx.js";
import { createTavo, TavoController } from "../framework/mvc.js";
import type { Store } from "../store/index.js";
import { createDeferredNode } from "./special.js";
import { isSsrDocument } from "../runtime/ssr-document.js";
import type {
  DeferredProps,
  DeferredState,
  DeferredTimeoutError,
  DeferredValue
} from "./types.js";

function isPromiseLike<T>(value: Promise<T> | T): value is Promise<T> {
  return typeof value === "object" && value !== null && typeof (value as Promise<T>).then === "function";
}

function isDeferredValue<T>(value: DeferredProps<T>["value"]): value is DeferredValue<T> {
  return typeof value === "object" && value !== null && "promise" in value;
}

function createDeferredTimeoutError(timeoutMs: number, id?: string): DeferredTimeoutError {
  return {
    code: "TAVO_DEFERRED_TIMEOUT",
    id,
    timeoutMs,
    message:
      id && id.length > 0
        ? `tavo deferred: "${id}" timed out after ${timeoutMs}ms.`
        : `tavo deferred timed out after ${timeoutMs}ms.`
  };
}

function withDeferredTimeout<T>(
  value: Promise<T> | T,
  timeoutMs: number | undefined,
  id?: string,
  signal?: AbortSignal
): Promise<T> | T {
  if (!isPromiseLike(value)) {
    return value;
  }

  const hasTimeout = Number.isFinite(timeoutMs) && (timeoutMs ?? 0) > 0;
  if (!hasTimeout && !signal) {
    return value;
  }

  const timed = new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer !== null) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(signal?.reason ?? new DOMException("Aborted", "AbortError")));
    const timer = hasTimeout ? setTimeout(() => {
      finish(() => reject(createDeferredTimeoutError(timeoutMs as number, id)));
    }, timeoutMs) : null;
    if (signal?.aborted) {
      abort();
      return;
    }
    signal?.addEventListener("abort", abort, { once: true });

    value.then((resolved) => {
      finish(() => resolve(resolved));
    }).catch((error) => {
      finish(() => reject(error));
    });
  });
  timed.catch(() => {
    // Consumers still receive the rejection; this prevents intentional SSR timeouts
    // from being reported as unhandled before the streaming renderer observes them.
  });
  return timed;
}

function unwrapDeferredValue<T>(
  value: DeferredProps<T>["value"],
  props: DeferredProps<T>
): {
  id: string | undefined;
  value: Promise<T> | T;
  serialize: ((value: T) => unknown) | undefined;
  deserialize: ((value: unknown) => T) | undefined;
  timeoutMs: number | undefined;
  timeoutFallback: DeferredProps<T>["timeoutFallback"];
  signal: AbortSignal | undefined;
} {
  if (!isDeferredValue(value)) {
    return {
      id: props.id,
      value,
      serialize: props.serialize,
      deserialize: props.deserialize,
      timeoutMs: props.timeoutMs,
      timeoutFallback: props.timeoutFallback,
      signal: props.signal
    };
  }
  return {
    id: value.id ?? props.id,
    value: value.promise,
    serialize: value.serialize ?? props.serialize,
    deserialize: value.deserialize ?? props.deserialize,
    timeoutMs: value.timeoutMs ?? props.timeoutMs,
    timeoutFallback: value.timeoutFallback ?? props.timeoutFallback,
    signal: value.signal ?? props.signal
  };
}

function renderResolvedValue<T>(children: DeferredProps<T>["children"], value: T): Child {
  const child = Array.isArray(children) && children.length === 1 ? children[0] : children;
  return typeof child === "function" ? child(value) : child;
}

type DeferredRegistryEntry = {
  status: "resolved" | "rejected";
  data?: unknown;
  error?: unknown;
};

type DeferredWindow = Window & {
  __TAVO_DEFERRED__?: Record<string, DeferredRegistryEntry>;
};

function getDeferredRegistry(target: DeferredWindow): Record<string, DeferredRegistryEntry> {
  const existing = target.__TAVO_DEFERRED__;
  if (existing && Object.getPrototypeOf(existing) === null) {
    return existing;
  }
  const safe = Object.assign(Object.create(null) as Record<string, DeferredRegistryEntry>, existing ?? {});
  target.__TAVO_DEFERRED__ = safe;
  return safe;
}

function writeDeferredRegistryEntry(id: string, entry: DeferredRegistryEntry): void {
  const registry = getDeferredRegistry(window as DeferredWindow);
  Object.defineProperty(registry, id, {
    configurable: true,
    enumerable: true,
    value: entry,
    writable: true
  });
}

function readHydratedDeferredValue<T>(
  id: string | undefined,
  deserialize?: (value: unknown) => T
): DeferredState<T> | null {
  if (typeof window === "undefined" || !id) {
    return null;
  }
  const registry = (window as DeferredWindow).__TAVO_DEFERRED__;
  if (!registry || !Object.prototype.hasOwnProperty.call(registry, id)) {
    return null;
  }
  const entry = registry[id];
  if (entry.status === "resolved") {
    return {
      status: "resolved",
      data: deserialize ? deserialize(entry.data) : (entry.data as T),
      error: null
    };
  }
  return {
    status: "rejected",
    data: null,
    error: entry.error ?? null
  };
}

function hasSsrDocumentMarker(): boolean {
  return isSsrDocument();
}

function isDeferredTimeoutError(error: unknown): error is DeferredTimeoutError {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "TAVO_DEFERRED_TIMEOUT"
  );
}

function getInitialDeferredState<T>(
  _props: DeferredProps<T>,
  deferred: ReturnType<typeof unwrapDeferredValue<T>>,
  timedValue: Promise<T> | T
): DeferredState<T> {
  const hydrated = readHydratedDeferredValue(deferred.id, deferred.deserialize);
  if (hydrated) {
    return hydrated;
  }
  if (isPromiseLike(timedValue)) {
    return {
      status: "pending",
      data: null,
      error: null
    };
  }
  return {
    status: "resolved",
    data: timedValue,
    error: null
  };
}

type DeferredRuntimeProps<T> = DeferredProps<T> & {
  __deferred: ReturnType<typeof unwrapDeferredValue<T>>;
  __timedValue: Promise<T> | T;
  __ssrDocument: boolean;
};

class DeferredController<T> extends TavoController {
  declare model: Store<DeferredState<T>>;
  declare props: DeferredRuntimeProps<T>;
  private runId = 0;
  private lastValue: Promise<T> | T | null = null;
  private lastSsrDocument = false;

  onMount() {
    this.sync();
  }

  onPropsChange() {
    this.sync();
  }

  onDestroy() {
    this.runId += 1;
  }

  private sync() {
    const deferred = this.props.__deferred;
    const timedValue = this.props.__timedValue;
    const ssrDocument = this.props.__ssrDocument;
    if (Object.is(this.lastValue, timedValue) && this.lastSsrDocument === ssrDocument) {
      return;
    }
    this.lastValue = timedValue;
    this.lastSsrDocument = ssrDocument;

    if (ssrDocument && isPromiseLike(timedValue)) {
      return;
    }

    if (!isPromiseLike(timedValue)) {
      this.model.setState({
        status: "resolved",
        data: timedValue,
        error: null
      });
      return;
    }

    const currentRun = this.runId + 1;
    this.runId = currentRun;
    this.model.setState({
      status: "pending",
      data: null,
      error: null
    });

    timedValue.then((value) => {
      if (currentRun !== this.runId) {
        return;
      }
      if (typeof window !== "undefined" && deferred.id) {
        writeDeferredRegistryEntry(deferred.id, {
          status: "resolved",
          data: deferred.serialize ? deferred.serialize(value) : value
        });
      }
      this.model.setState({
        status: "resolved",
        data: value,
        error: null
      });
    }).catch((error) => {
      if (currentRun !== this.runId) {
        return;
      }
      if (typeof window !== "undefined" && deferred.id) {
        writeDeferredRegistryEntry(deferred.id, {
          status: "rejected",
          error: typeof error === "object" && error !== null && "message" in error
            ? String((error as { message?: unknown }).message)
            : String(error)
        });
      }
      this.model.setState({
        status: "rejected",
        data: null,
        error
      });
    });
  }
}

const DeferredRuntime = createTavo<DeferredRuntimeProps<unknown>, DeferredState<unknown>, DeferredController<unknown>>({
  model: (props) => getInitialDeferredState(props, props.__deferred, props.__timedValue),
  controller: DeferredController as typeof DeferredController<unknown>,
  view: ({ props, state }) => {
    const deferred = props.__deferred;

    if (state.status === "resolved") {
      return renderResolvedValue(props.children, state.data);
    }
    if (state.status === "rejected") {
      if (isDeferredTimeoutError(state.error) && deferred.timeoutFallback !== undefined) {
        return typeof deferred.timeoutFallback === "function"
          ? deferred.timeoutFallback(state.error)
          : deferred.timeoutFallback;
      }
      if (typeof props.errorFallback === "function") {
        return props.errorFallback(state.error);
      }
      return props.errorFallback ?? props.fallback ?? null;
    }
    return props.fallback ?? null;
  }
});

/** Progressive SSR boundary that renders stable fallback UI during pure CSR rendering. */
export function Deferred<T>(props: DeferredProps<T>): Child {
  const deferred = unwrapDeferredValue(props.value, props);

  if (typeof window !== "undefined" && !hasSsrDocumentMarker() && isPromiseLike(deferred.value)) {
    return props.fallback ?? null;
  }

  const timedValue = withDeferredTimeout(
    deferred.value,
    deferred.timeoutMs,
    deferred.id,
    deferred.signal
  );

  if (typeof window === "undefined" && isPromiseLike(timedValue)) {
    return createDeferredNode({
      ...props,
      id: deferred.id,
      value: timedValue,
      serialize: deferred.serialize,
      deserialize: deferred.deserialize,
      timeoutMs: deferred.timeoutMs,
      timeoutFallback: deferred.timeoutFallback,
      signal: deferred.signal
    });
  }

  return h(DeferredRuntime as unknown as Component, {
    ...props,
    __deferred: deferred,
    __timedValue: timedValue,
    __ssrDocument: hasSsrDocumentMarker()
  } as any);
}

/** Creates a reusable deferred wrapper so nested SSR trees can share one async unit by id. */
export function createDeferredValue<T>(
  promise: Promise<T>,
  options?: {
    id?: string;
    serialize?: (value: T) => unknown;
    deserialize?: (value: unknown) => T;
    timeoutMs?: number;
    timeoutFallback?: DeferredProps<T>["timeoutFallback"];
    signal?: AbortSignal;
  }
): DeferredValue<T> {
  return {
    id: options?.id,
    promise,
    serialize: options?.serialize,
    deserialize: options?.deserialize,
    timeoutMs: options?.timeoutMs,
    timeoutFallback: options?.timeoutFallback,
    signal: options?.signal
  };
}
