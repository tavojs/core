import type {
  SelectorListener,
  StatePatch,
  StateUpdater,
  Store,
  StoreInitializer,
  StoreInitializerSet,
  StoreListener,
  StorePath,
  StoreSetValue,
  StoreSelector,
  StoreWatchListener,
  Unsubscribe
} from "./types.js";
import { createWatchSelector, setPathValue } from "./path.js";
import {
  createStoreSnapshotId,
  registerStore,
  setStoreMetadata
} from "./registry.js";
import {
  hydrateStoreFromDocument,
  notifyStoreWrite,
  readScopedStoreState,
  writeScopedStoreState
} from "./snapshots.js";

export type * from "./types.js";
export {
  beginStoreSnapshotScope,
  hydrateStoresFromDocumentState,
  readActiveStoreSnapshotState,
  restoreActiveStoreSnapshotState,
  runWithStoreSnapshotScope,
  setStoreWriteObserver,
  type StoreSnapshotState
} from "./snapshots.js";

type SelectorSubscription<T extends Record<string, unknown>, S = unknown> = {
  selector: StoreSelector<T, S>;
  isEqual: (left: S, right: S) => boolean;
  selected: S;
  notify(nextState: T, previousState: T): void;
};

export function shallowEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== "object"
    || left === null
    || typeof right !== "object"
    || right === null
  ) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) return false;
    if (!Object.is(
      (left as Record<string, unknown>)[key],
      (right as Record<string, unknown>)[key]
    )) return false;
  }
  return true;
}

export function createStore<T extends Record<string, unknown>>(
  initialState: T | StoreInitializer<T>
): Store<T> {
  const storeId = createStoreSnapshotId();
  let state: T;
  let initialized = false;
  let storeApi: Store<T>;
  const listeners = new Set<StoreListener<T>>();
  const subscriptions = new Set<SelectorSubscription<T, any>>();

  function emit(nextState: T, previousState: T): void {
    for (const listener of listeners) listener(nextState, previousState);
    for (const subscription of subscriptions) {
      subscription.notify(nextState, previousState);
    }
  }

  function getState(): T {
    if (!initialized) {
      throw new Error(
        "tavo store: get() is not available while the initial state is being created."
      );
    }
    return readScopedStoreState(storeApi, state);
  }

  function applyState(
    next: StateUpdater<T>,
    method: "setState" | "set" | "patch"
  ): T {
    if (!initialized) {
      throw new Error(
        "tavo store: set() is not available while the initial state is being created."
      );
    }
    notifyStoreWrite(storeApi as Store<Record<string, unknown>>, method);
    const previous = getState();
    const nextState = typeof next === "function"
      ? (next as (previous: T) => T)(previous)
      : next;
    if (Object.is(nextState, previous)) return previous;
    if (writeScopedStoreState(storeApi, nextState)) {
      emit(nextState, previous);
      return nextState;
    }
    state = nextState;
    emit(state, previous);
    return state;
  }

  function setState(next: StateUpdater<T>): T {
    return applyState(next, "setState");
  }

  function set<S>(target: StorePath, value: StoreSetValue<T, S>): T {
    return applyState((previous) => setPathValue(previous, target, value), "set");
  }

  function patch(partial: StatePatch<T>): T {
    const previous = getState();
    const nextPartial = typeof partial === "function" ? partial(previous) : partial;
    return applyState({ ...previous, ...nextPartial }, "patch");
  }

  function subscribe(
    listener: StoreListener<T>,
    options?: { immediate?: boolean }
  ): Unsubscribe {
    listeners.add(listener);
    if (options?.immediate) {
      const current = getState();
      listener(current, current);
    }
    return () => { listeners.delete(listener); };
  }

  function subscribeSelector<S>(
    selector: StoreSelector<T, S>,
    listener: SelectorListener<S, T>,
    options?: { immediate?: boolean; isEqual?: (a: S, b: S) => boolean }
  ): Unsubscribe {
    const isEqual = options?.isEqual ?? Object.is;
    const current = getState();
    const subscription: SelectorSubscription<T, S> = {
      selector,
      isEqual,
      selected: selector(current),
      notify(nextState) {
        const nextSelected = selector(nextState);
        if (isEqual(nextSelected, subscription.selected)) return;
        const previousSelected = subscription.selected;
        subscription.selected = nextSelected;
        listener(nextSelected, previousSelected, nextState);
      }
    };
    if (options?.immediate) {
      listener(subscription.selected, subscription.selected, current);
    }
    subscriptions.add(subscription);
    return () => { subscriptions.delete(subscription); };
  }

  function watch<S>(
    target: StorePath | StoreSelector<T, S>,
    listener: StoreWatchListener<S, T>,
    options?: { immediate?: boolean; isEqual?: (a: S, b: S) => boolean }
  ): Unsubscribe {
    const isEqual = options?.isEqual ?? Object.is;
    const current = getState();
    const selector = createWatchSelector(target, current);
    const subscription: SelectorSubscription<T, S> = {
      selector,
      isEqual,
      selected: selector(current),
      notify(nextState, previousState) {
        const nextSelected = selector(nextState);
        if (isEqual(nextSelected, subscription.selected)) return;
        const previousSelected = subscription.selected;
        subscription.selected = nextSelected;
        listener(nextSelected, previousSelected, nextState, previousState);
      }
    };
    if (options?.immediate) {
      listener(subscription.selected, subscription.selected, current, current);
    }
    subscriptions.add(subscription);
    return () => { subscriptions.delete(subscription); };
  }

  if (typeof initialState === "function") {
    state = (initialState as StoreInitializer<T>)(
      patch as StoreInitializerSet<T>,
      getState
    );
  } else {
    state = initialState;
  }
  state = hydrateStoreFromDocument(storeId, state);
  initialized = true;
  storeApi = {
    getState,
    setState,
    set,
    patch,
    subscribe,
    subscribeSelector,
    watch
  };
  const normalized = storeApi as Store<Record<string, unknown>>;
  setStoreMetadata(normalized, storeId);
  registerStore(storeId, normalized);
  return storeApi;
}
