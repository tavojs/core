import { createStore, type Store, type StoreSelector, type Unsubscribe } from "./core.js";
import type { PersistStoreOptions, StorageLike } from "./types.js";

export type { PersistStoreOptions, StorageLike } from "./types.js";

/** Returns the default browser storage target when persistence is available. */
function getDefaultStorage(): StorageLike | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
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

  let restored: Partial<T> | undefined;
  try {
    const existing = storage.getItem(options.key);
    if (existing) restored = deserialize(existing);
  } catch {
    // Blocked storage and corrupt saved snapshots must not prevent store setup.
  }
  if (restored) store.patch(restored);

  return store.subscribe((state) => {
    try {
      const selected = options.pick ? options.pick(state) : state;
      storage.setItem(options.key, serialize(selected as T));
    } catch {
      // Persistence is best-effort; all store consumers must still receive updates.
    }
  });
}

/** Creates a derived store. Call dispose() to stop observing its source. */
export function computedStore<T extends Record<string, unknown>, S extends Record<string, unknown>>(
  source: Store<T>,
  selector: StoreSelector<T, S>,
  options?: { isEqual?: (left: S, right: S) => boolean }
): Store<S> & { dispose: Unsubscribe } {
  const derived = createStore(selector(source.getState()));
  const dispose = source.watch(
    selector,
    (next) => {
      derived.setState(next);
    },
    options
  );
  return Object.assign(derived, { dispose });
}
