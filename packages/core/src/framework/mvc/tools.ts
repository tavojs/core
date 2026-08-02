import {
  observeIntersection,
  observeMutation,
  observeResize
} from "../../observers/index.js";
import type {
  MvcControllerTools,
  TavoAction
} from "../types.js";
import type { Unsubscribe } from "../../store/index.js";

export function createControllerAction<TResult, TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<TResult> | TResult,
  notify: () => void
): TavoAction<TResult, TArgs> {
  let pending = false;
  let error: unknown = null;
  let result: TResult | null = null;
  let runId = 0;
  const update = (next: Partial<{
    pending: boolean;
    error: unknown;
    result: TResult | null;
  }>) => {
    if ("pending" in next) pending = next.pending ?? false;
    if ("error" in next) error = next.error;
    if ("result" in next) result = next.result ?? null;
    notify();
  };
  return {
    get pending() { return pending; },
    get error() { return error; },
    get result() { return result; },
    async run(...args: TArgs): Promise<TResult> {
      const currentRun = runId + 1;
      runId = currentRun;
      update({ pending: true, error: null });
      try {
        const value = await fn(...args);
        if (currentRun === runId) update({ pending: false, result: value, error: null });
        return value;
      } catch (caught) {
        if (currentRun === runId) update({ pending: false, error: caught });
        throw caught;
      }
    },
    reset() {
      runId += 1;
      update({ pending: false, error: null, result: null });
    }
  };
}

export type ManagedControllerTools = MvcControllerTools & {
  flushCleanups(): void;
  notify(): void;
};

export function createControllerTools(
  idBase: string,
  notify: () => void
): ManagedControllerTools {
  const cleanups = new Set<Unsubscribe>();
  let nextId = 0;
  function cleanup(fn: Unsubscribe): Unsubscribe {
    let active = true;
    const wrapped = () => {
      if (!active) return;
      active = false;
      cleanups.delete(wrapped);
      fn();
    };
    cleanups.add(wrapped);
    return wrapped;
  }
  return {
    cleanup,
    notify,
    createId(prefix = "id") {
      const id = `${prefix}-${idBase}-${nextId}`;
      nextId += 1;
      return id;
    },
    action(fn) {
      return createControllerAction(fn, notify);
    },
    setTimeout(fn, delay) {
      let unsubscribe: Unsubscribe = () => {};
      const handle = globalThis.setTimeout(() => {
        unsubscribe();
        fn();
      }, delay);
      unsubscribe = cleanup(() => globalThis.clearTimeout(handle));
      return unsubscribe;
    },
    setInterval(fn, delay) {
      const handle = globalThis.setInterval(fn, delay);
      return cleanup(() => globalThis.clearInterval(handle));
    },
    listen(store, listener, options) {
      return cleanup(store.subscribe(listener, options));
    },
    scheduleLayoutEffect(fn) {
      let active = true;
      let layoutCleanup: Unsubscribe | void;
      const unsubscribe = cleanup(() => {
        active = false;
        layoutCleanup?.();
        layoutCleanup = undefined;
      });
      queueMicrotask(() => {
        if (active) layoutCleanup = fn() ?? undefined;
      });
      return unsubscribe;
    },
    scheduleAfterRender(fn) {
      let active = true;
      const unsubscribe = cleanup(() => { active = false; });
      queueMicrotask(() => {
        if (active) {
          fn();
          unsubscribe();
        }
      });
      return unsubscribe;
    },
    scheduleOnMount(fn) {
      let active = true;
      let mountCleanup: Unsubscribe | void;
      const unsubscribe = cleanup(() => {
        active = false;
        mountCleanup?.();
        mountCleanup = undefined;
      });
      queueMicrotask(() => {
        if (active) mountCleanup = fn() ?? undefined;
      });
      return unsubscribe;
    },
    select(store, selector, listener, options) {
      return cleanup(store.subscribeSelector(selector, listener, options));
    },
    watch(store, target, listener, options) {
      return cleanup((store.watch as any)(target, listener, options));
    },
    listenExternal(store, listener, options) {
      const isEqual = options?.isEqual ?? Object.is;
      let previous = store.getSnapshot();
      if (options?.immediate) listener(previous, previous);
      return cleanup(store.subscribe(() => {
        const next = store.getSnapshot();
        if (isEqual(next, previous)) return;
        const last = previous;
        previous = next;
        listener(next, last);
      }));
    },
    observeResize(target, listener, options) {
      return cleanup(observeResize(target, listener, options));
    },
    observeIntersection(target, listener, options) {
      return cleanup(observeIntersection(target, listener, options));
    },
    observeMutation(target, listener, options) {
      return cleanup(observeMutation(target, listener, options));
    },
    flushCleanups() {
      const pending = Array.from(cleanups);
      cleanups.clear();
      for (const fn of pending) fn();
    }
  };
}
