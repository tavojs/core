import { createWatchSelector, setPathValue } from "./path.js";
import { createStoreNotifier } from "./notifications.js";
import type {
  SelectorListener,
  StatePatch,
  StateUpdater,
  Store,
  StoreInitializer,
  StoreInitializerSet,
  StoreListener,
  StorePath,
  StoreSelector,
  StoreWatchListener,
  Unsubscribe,
} from "./types.js";

type SelectorSubscription<T extends Record<string, unknown>, S = unknown> = {
  selector: StoreSelector<T, S>;
  isEqual: (left: S, right: S) => boolean;
  selected: S;
  notify(nextState: T, previousState: T): void;
};

/** Browser-only store used by embedded runtimes without SSR snapshot globals. */
export function createStore<T extends Record<string, unknown>>(
  initialState: T | StoreInitializer<T>,
): Store<T> {
  let state: T;
  let initialized = false;
  const listeners = new Set<StoreListener<T>>();
  const subscriptions = new Set<SelectorSubscription<T, any>>();
  const getState = (): T => {
    if (!initialized)
      throw new Error(
        "tavo store: get() is not available while the initial state is being created.",
      );
    return state;
  };
  const emit = createStoreNotifier<T>((nextState, previousState) => {
    for (const listener of listeners) listener(nextState, previousState);
    for (const subscription of subscriptions)
      subscription.notify(nextState, previousState);
  });
  const applyState = (next: StateUpdater<T>): T => {
    const previous = getState();
    const nextState =
      typeof next === "function"
        ? (next as (previous: T) => T)(previous)
        : next;
    if (Object.is(nextState, previous)) return previous;
    state = nextState;
    emit(state, previous);
    return state;
  };
  const patch = (partial: StatePatch<T>): T => {
    const previous = getState();
    const nextPartial =
      typeof partial === "function" ? partial(previous) : partial;
    return applyState({ ...previous, ...nextPartial });
  };
  state =
    typeof initialState === "function"
      ? (initialState as StoreInitializer<T>)(
          patch as StoreInitializerSet<T>,
          getState,
        )
      : initialState;
  initialized = true;
  const subscribe = (
    listener: StoreListener<T>,
    options?: { immediate?: boolean },
  ): Unsubscribe => {
    listeners.add(listener);
    if (options?.immediate) listener(state, state);
    return () => listeners.delete(listener);
  };
  const subscribeSelector = <S>(
    selector: StoreSelector<T, S>,
    listener: SelectorListener<S, T>,
    options?: { immediate?: boolean; isEqual?: (a: S, b: S) => boolean },
  ): Unsubscribe => {
    const subscription: SelectorSubscription<T, S> = {
      selector,
      isEqual: options?.isEqual ?? Object.is,
      selected: selector(state),
      notify(nextState) {
        const nextSelected = selector(nextState);
        if (subscription.isEqual(nextSelected, subscription.selected)) return;
        const previousSelected = subscription.selected;
        subscription.selected = nextSelected;
        listener(nextSelected, previousSelected, nextState);
      },
    };
    if (options?.immediate)
      listener(subscription.selected, subscription.selected, state);
    subscriptions.add(subscription);
    return () => subscriptions.delete(subscription);
  };
  const watch = <S>(
    target: StorePath | StoreSelector<T, S>,
    listener: StoreWatchListener<S, T>,
    options?: { immediate?: boolean; isEqual?: (a: S, b: S) => boolean },
  ): Unsubscribe => {
    const selector = createWatchSelector(target, state);
    const subscription: SelectorSubscription<T, S> = {
      selector,
      isEqual: options?.isEqual ?? Object.is,
      selected: selector(state),
      notify(nextState, previousState) {
        const nextSelected = selector(nextState);
        if (subscription.isEqual(nextSelected, subscription.selected)) return;
        const previousSelected = subscription.selected;
        subscription.selected = nextSelected;
        listener(nextSelected, previousSelected, nextState, previousState);
      },
    };
    if (options?.immediate) {
      listener(subscription.selected, subscription.selected, state, state);
    }
    subscriptions.add(subscription);
    return () => subscriptions.delete(subscription);
  };
  const set = ((path: StorePath, value: unknown) =>
    applyState((previous) =>
      setPathValue(previous, path, value as never),
    )) as Store<T>["set"];
  return {
    getState,
    setState: applyState,
    set,
    patch,
    subscribe,
    subscribeSelector,
    watch: watch as Store<T>["watch"],
  };
}
