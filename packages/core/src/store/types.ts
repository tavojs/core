export type Unsubscribe = () => void;

export type StateUpdater<T extends Record<string, unknown>> = T | ((previous: T) => T);
export type StatePatch<T extends Record<string, unknown>> =
  | Partial<T>
  | ((previous: T) => Partial<T>);
export type StoreSetValue<T extends Record<string, unknown>, S> =
  | S
  | ((previous: S, state: T) => S);
export type StoreInitializerSet<T extends Record<string, unknown>> = (partial: StatePatch<T>) => T;
export type StoreInitializer<T extends Record<string, unknown>> = (
  set: StoreInitializerSet<T>,
  get: () => T
) => T;

export type StoreListener<T> = (state: T, previous: T) => void;
export type StoreSelector<T, S> = (state: T) => S;
export type SelectorListener<S, T> = (selected: S, previousSelected: S, state: T) => void;
export type StorePathSegment = string | number;
export type StorePath = StorePathSegment | readonly StorePathSegment[];
export type StoreWatchListener<S, T> = (
  selected: S,
  previousSelected: S,
  state: T,
  previousState: T
) => void;

export type Store<T extends Record<string, unknown>> = {
  getState(): T;
  setState(next: StateUpdater<T>): T;
  set<K extends keyof T>(key: K, value: StoreSetValue<T, T[K]>): T;
  set<S = unknown>(path: StorePath, value: StoreSetValue<T, S>): T;
  patch(partial: StatePatch<T>): T;
  subscribe(listener: StoreListener<T>, options?: { immediate?: boolean }): Unsubscribe;
  subscribeSelector<S>(
    selector: StoreSelector<T, S>,
    listener: SelectorListener<S, T>,
    options?: { immediate?: boolean; isEqual?: (a: S, b: S) => boolean }
  ): Unsubscribe;
  watch<K extends keyof T>(
    key: K,
    listener: StoreWatchListener<T[K], T>,
    options?: { immediate?: boolean; isEqual?: (a: T[K], b: T[K]) => boolean }
  ): Unsubscribe;
  watch<S>(
    selector: StoreSelector<T, S>,
    listener: StoreWatchListener<S, T>,
    options?: { immediate?: boolean; isEqual?: (a: S, b: S) => boolean }
  ): Unsubscribe;
  watch<S = unknown>(
    path: StorePath,
    listener: StoreWatchListener<S, T>,
    options?: { immediate?: boolean; isEqual?: (a: S, b: S) => boolean }
  ): Unsubscribe;
};

export type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
};

export type PersistStoreOptions<T extends Record<string, unknown>> = {
  key: string;
  storage?: StorageLike;
  serialize?: (state: T) => string;
  deserialize?: (raw: string) => Partial<T> | T;
  pick?: (state: T) => Partial<T> | T;
};
