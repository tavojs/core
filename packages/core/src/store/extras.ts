import { createStore, type Store, type StoreSelector, type Unsubscribe } from "./core.js";
import type { PersistStoreOptions, StorageLike } from "./types.js";

export type { PersistStoreOptions, StorageLike } from "./types.js";

/** Returns the default browser storage target when persistence is available. */
function getDefaultStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  return window.localStorage;
}

/** Persists store updates to browser storage and hydrates an initial saved snapshot when available. */
export function persistStore<T extends Record<string, unknown>>(
  store: Store<T>,
  options: PersistStoreOptions<T>
): Unsubscribe {
  const storage = options.storage ?? getDefaultStorage();
  const serialize = options.serialize ?? JSON.stringify;
  const deserialize = options.deserialize ?? ((raw: string) => JSON.parse(raw) as Partial<T>);

  if (!storage) {
    return () => {};
  }

  const existing = storage.getItem(options.key);
  if (existing) {
    store.patch(deserialize(existing));
  }

  return store.subscribe((state) => {
    const selected = options.pick ? options.pick(state) : state;
    storage.setItem(options.key, serialize(selected as T));
  });
}

/** Creates a derived readonly store that updates whenever the source store's selected value changes. */
export function computedStore<T extends Record<string, unknown>, S extends Record<string, unknown>>(
  source: Store<T>,
  selector: StoreSelector<T, S>,
  options?: { isEqual?: (left: S, right: S) => boolean }
): Store<S> {
  const derived = createStore(selector(source.getState()));
  source.watch(
    selector,
    (next) => {
      derived.setState(next);
    },
    options
  );
  return derived;
}
