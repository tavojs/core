import type { Child, Component } from "../jsx.js";
import { h } from "../jsx.js";
import {
  getActiveComponent,
  getComponentCell,
  registerComponentCleanup,
} from "../runtime/dom/component-runtime.js";
import { createDeferredNode } from "./special.js";
import {
  createDeferredTimeoutError,
  getInitialDeferredState,
  hasSsrDocumentMarker,
  isDeferredTimeoutError,
  isPromiseLike,
  renderResolvedValue,
  unwrapDeferredValue,
  withDeferredTimeout,
  writeDeferredRegistryEntry,
  type DeferredRuntimeProps,
} from "./deferred-state.js";
import type { DeferredProps, DeferredState, DeferredValue } from "./types.js";

type DeferredCell<T> = {
  state: DeferredState<T>;
  runId: number;
  hasLastValue: boolean;
  lastValue: Promise<T> | T | null;
  lastSsrDocument: boolean;
  lastId: string | undefined;
  lastTimeoutMs: number | undefined;
  lastSignal: AbortSignal | undefined;
  lastSerialize: ((value: T) => unknown) | undefined;
  cancelCurrent: (() => void) | null;
  cleanupRegistered: boolean;
};

const deferredCellKey = Symbol("tavo.deferred.cell");

function syncDeferred<T>(
  cell: DeferredCell<T>,
  props: DeferredRuntimeProps<T>,
  rerender: (() => void) | undefined,
): void {
  const deferred = props.__deferred;
  const timedValue = props.__timedValue;
  const ssrDocument = props.__ssrDocument;
  if (
    cell.hasLastValue &&
    Object.is(cell.lastValue, timedValue) &&
    cell.lastSsrDocument === ssrDocument &&
    cell.lastId === deferred.id &&
    Object.is(cell.lastTimeoutMs, deferred.timeoutMs) &&
    cell.lastSignal === deferred.signal &&
    cell.lastSerialize === deferred.serialize
  ) {
    return;
  }
  cell.hasLastValue = true;
  cell.lastValue = timedValue;
  cell.lastSsrDocument = ssrDocument;
  cell.lastId = deferred.id;
  cell.lastTimeoutMs = deferred.timeoutMs;
  cell.lastSignal = deferred.signal;
  cell.lastSerialize = deferred.serialize;
  cell.cancelCurrent?.();
  cell.cancelCurrent = null;
  cell.runId += 1;

  if (ssrDocument && isPromiseLike(timedValue)) {
    return;
  }

  if (!isPromiseLike(timedValue)) {
    cell.state = {
      status: "resolved",
      data: timedValue,
      error: null,
    };
    return;
  }

  const currentRun = cell.runId;
  cell.state = {
    status: "pending",
    data: null,
    error: null,
  };

  let active = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const signal = deferred.signal;
  const removeAbort = () => signal?.removeEventListener("abort", abort);
  const cancel = () => {
    if (!active) {
      return;
    }
    active = false;
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    removeAbort();
  };
  cell.cancelCurrent = cancel;

  const canSettle = (): boolean => active && currentRun === cell.runId;
  const release = (): void => {
    cancel();
    if (cell.cancelCurrent === cancel) {
      cell.cancelCurrent = null;
    }
  };
  const resolve = (value: T): void => {
    if (!canSettle()) {
      return;
    }
    release();
    if (typeof window !== "undefined" && deferred.id) {
      writeDeferredRegistryEntry(deferred.id, {
        status: "resolved",
        data: deferred.serialize ? deferred.serialize(value) : value,
      });
    }
    cell.state = {
      status: "resolved",
      data: value,
      error: null,
    };
    rerender?.();
  };
  const reject = (error: unknown): void => {
    if (!canSettle()) {
      return;
    }
    release();
    if (typeof window !== "undefined" && deferred.id) {
      writeDeferredRegistryEntry(deferred.id, {
        status: "rejected",
        error:
          typeof error === "object" && error !== null && "message" in error
            ? String((error as { message?: unknown }).message)
            : String(error),
      });
    }
    cell.state = {
      status: "rejected",
      data: null,
      error,
    };
    rerender?.();
  };
  const abort = () =>
    reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));

  if (signal?.aborted) {
    abort();
    return;
  }
  signal?.addEventListener("abort", abort, { once: true });
  if (Number.isFinite(deferred.timeoutMs) && (deferred.timeoutMs ?? 0) > 0) {
    timer = setTimeout(
      () =>
        reject(
          createDeferredTimeoutError(deferred.timeoutMs as number, deferred.id),
        ),
      deferred.timeoutMs,
    );
  }
  timedValue.then(resolve, reject);
}

function DeferredRuntime<T>(props: DeferredRuntimeProps<T>): Child {
  const component = getActiveComponent();
  const cell = getComponentCell<DeferredCell<T>>(deferredCellKey, () => ({
    state: getInitialDeferredState(props, props.__deferred, props.__timedValue),
    runId: 0,
    hasLastValue: false,
    lastValue: null,
    lastSsrDocument: false,
    lastId: undefined,
    lastTimeoutMs: undefined,
    lastSignal: undefined,
    lastSerialize: undefined,
    cancelCurrent: null,
    cleanupRegistered: false,
  }));
  if (component && !cell.cleanupRegistered) {
    cell.cleanupRegistered = true;
    registerComponentCleanup(() => {
      cell.runId += 1;
      cell.cancelCurrent?.();
      cell.cancelCurrent = null;
    });
  }
  syncDeferred(cell, props, component?.rerender);
  const state = cell.state;
  const deferred = props.__deferred;

  if (state.status === "resolved") {
    return renderResolvedValue(props.children, state.data);
  }
  if (state.status === "rejected") {
    if (
      isDeferredTimeoutError(state.error) &&
      deferred.timeoutFallback !== undefined
    ) {
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

/** Async boundary that streams during SSR and settles Promise-backed state during CSR. */
export function Deferred<T>(props: DeferredProps<T>): Child {
  const deferred = unwrapDeferredValue(props.value, props);
  const ssrDocument = hasSsrDocumentMarker();
  const timedValue =
    typeof window === "undefined"
      ? withDeferredTimeout(
          deferred.value,
          deferred.timeoutMs,
          deferred.id,
          deferred.signal,
        )
      : deferred.value;

  if (typeof window === "undefined" && isPromiseLike(timedValue)) {
    return createDeferredNode({
      ...props,
      id: deferred.id,
      value: timedValue,
      serialize: deferred.serialize,
      deserialize: deferred.deserialize,
      timeoutMs: deferred.timeoutMs,
      timeoutFallback: deferred.timeoutFallback,
      signal: deferred.signal,
    });
  }

  return h(
    DeferredRuntime as unknown as Component,
    {
      ...props,
      __deferred: deferred,
      __timedValue: timedValue,
      __ssrDocument: ssrDocument,
    } as any,
  );
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
  },
): DeferredValue<T> {
  return {
    id: options?.id,
    promise,
    serialize: options?.serialize,
    deserialize: options?.deserialize,
    timeoutMs: options?.timeoutMs,
    timeoutFallback: options?.timeoutFallback,
    signal: options?.signal,
  };
}
