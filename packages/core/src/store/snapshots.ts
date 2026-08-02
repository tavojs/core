import type { Store } from "./types.js";
import {
  getHydratedStoreIds,
  getStoreMetadata,
  getStoresById,
  readRegisteredStore
} from "./registry.js";

type AnyStore = Store<Record<string, unknown>>;
type StoreWriteMethod = "setState" | "set" | "patch";
type StoreWriteObserver = (method: StoreWriteMethod) => void;
export type StoreSnapshotState = Record<string, Record<string, unknown>>;
type StoreSnapshotScope = {
  states: Map<AnyStore, Record<string, unknown>>;
  snapshots: Map<AnyStore, Record<string, unknown>>;
  contended: boolean;
};
type StoreSnapshotStorage = {
  getStore(): StoreSnapshotScope | undefined;
  run<T>(scope: StoreSnapshotScope, operation: () => T): T;
};

const observers = new WeakMap<AnyStore, StoreWriteObserver>();
const scopesKey = "__tavo_store_snapshot_scopes__";
const storageKey = "__tavo_store_snapshot_storage__";
const storagePromiseKey = "__tavo_store_snapshot_storage_promise__";
const fallbackQueueKey = "__tavo_store_snapshot_fallback_queue__";

function runtime(): Record<string, unknown> {
  return globalThis as Record<string, unknown>;
}

function activeScopes(): Set<StoreSnapshotScope> {
  const target = runtime();
  const existing = target[scopesKey];
  if (existing instanceof Set) return existing as Set<StoreSnapshotScope>;
  const created = new Set<StoreSnapshotScope>();
  target[scopesKey] = created;
  return created;
}

function currentScope(): StoreSnapshotScope | undefined {
  const storage = runtime()[storageKey] as StoreSnapshotStorage | undefined;
  const asyncScope = storage?.getStore();
  if (asyncScope) return asyncScope;
  const scopes = activeScopes();
  return scopes.size === 1 ? scopes.values().next().value : undefined;
}

function createScope(): StoreSnapshotScope {
  return { states: new Map(), snapshots: new Map(), contended: false };
}

async function acquireFallbackScope(): Promise<() => void> {
  const target = runtime();
  const previous = target[fallbackQueueKey] as Promise<void> | undefined
    ?? Promise.resolve();
  let release!: () => void;
  target[fallbackQueueKey] = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  return release;
}

async function snapshotStorage(): Promise<StoreSnapshotStorage | null> {
  const target = runtime();
  const existing = target[storageKey] as StoreSnapshotStorage | undefined;
  if (existing) return existing;
  const pending = target[storagePromiseKey] as Promise<StoreSnapshotStorage | null> | undefined;
  if (pending) return pending;
  const created = (async (): Promise<StoreSnapshotStorage | null> => {
    if (typeof window !== "undefined") return null;
    try {
      const runtimeImport = new Function("specifier", "return import(specifier);") as (
        specifier: string
      ) => Promise<{ AsyncLocalStorage: new () => StoreSnapshotStorage }>;
      const { AsyncLocalStorage } = await runtimeImport("node:async_hooks");
      const storage = new AsyncLocalStorage();
      target[storageKey] = storage;
      return storage;
    } catch {
      return null;
    }
  })();
  target[storagePromiseKey] = created;
  return created;
}

function readDocumentState(): StoreSnapshotState | null {
  if (typeof document === "undefined") return null;
  const script = document.getElementById("__TAVO_STATE__");
  if (!script || script.textContent == null) return null;
  try {
    const parsed = JSON.parse(script.textContent) as { storeState?: StoreSnapshotState };
    return parsed.storeState && typeof parsed.storeState === "object"
      ? parsed.storeState
      : null;
  } catch {
    return null;
  }
}

function findMatchingSnapshot(
  state: Record<string, unknown>,
  storeState: StoreSnapshotState
): { id: string; snapshot: Record<string, unknown> } | null {
  const hydrated = getHydratedStoreIds();
  for (const [id, snapshot] of Object.entries(storeState)) {
    if (hydrated.has(id) || !snapshot || typeof snapshot !== "object") continue;
    const keys = Object.keys(snapshot);
    if (keys.length > 0 && keys.every((key) => (
      Object.prototype.hasOwnProperty.call(state, key)
    ))) return { id, snapshot };
  }
  return null;
}

export function hydrateStoreFromDocument<T extends Record<string, unknown>>(
  id: string,
  state: T
): T {
  const hydrated = getHydratedStoreIds();
  if (hydrated.has(id)) return state;
  const storeState = readDocumentState();
  if (!storeState) return state;
  const exact = storeState[id];
  const matched = exact && typeof exact === "object"
    ? { id, snapshot: exact }
    : findMatchingSnapshot(state, storeState);
  if (!matched) return state;
  hydrated.add(matched.id);
  return { ...state, ...matched.snapshot };
}

function serializable(state: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(state).filter(([, value]) => (
    typeof value !== "function"
  )));
}

export function readScopedStoreState<T extends Record<string, unknown>>(
  store: Store<T>,
  fallback: T
): T {
  if (typeof window !== "undefined") return fallback;
  const scope = currentScope();
  if (!scope) return fallback;
  const normalized = store as AnyStore;
  const existing = scope.states.get(normalized);
  if (existing) return existing as T;
  const created = { ...fallback };
  scope.states.set(normalized, created);
  return created;
}

export function writeScopedStoreState<T extends Record<string, unknown>>(
  store: Store<T>,
  nextState: T
): boolean {
  if (typeof window !== "undefined") return false;
  const scope = currentScope();
  if (!scope) return false;
  const normalized = store as AnyStore;
  scope.states.set(normalized, nextState);
  scope.snapshots.set(normalized, serializable(nextState));
  return true;
}

function finishScope(scope: StoreSnapshotScope): StoreSnapshotState | undefined {
  if (scope.contended) return undefined;
  const snapshots: StoreSnapshotState = {};
  for (const [store, snapshot] of scope.snapshots) {
    const metadata = getStoreMetadata(store);
    if (metadata && Object.keys(snapshot).length > 0) snapshots[metadata.id] = snapshot;
  }
  return Object.keys(snapshots).length > 0 ? snapshots : undefined;
}

export function readActiveStoreSnapshotState(): StoreSnapshotState | undefined {
  const scope = currentScope();
  return scope ? finishScope(scope) : undefined;
}

export function restoreActiveStoreSnapshotState(
  storeState: StoreSnapshotState | undefined
): void {
  const scope = currentScope();
  if (!scope || !storeState) return;
  const stores = getStoresById();
  for (const [id, snapshot] of Object.entries(storeState)) {
    const registered = stores.get(id);
    const store = registered ? readRegisteredStore(registered) : undefined;
    if (!store) {
      if (registered) stores.delete(id);
      continue;
    }
    const nextState = { ...store.getState(), ...snapshot };
    scope.states.set(store, nextState);
    scope.snapshots.set(store, serializable(nextState));
  }
}

export function beginStoreSnapshotScope(): () => StoreSnapshotState | undefined {
  const scope = createScope();
  const scopes = activeScopes();
  scopes.add(scope);
  if (scopes.size > 1) {
    for (const active of scopes) {
      active.contended = true;
      active.snapshots.clear();
    }
  }
  let finished = false;
  return () => {
    if (finished) return undefined;
    finished = true;
    scopes.delete(scope);
    return finishScope(scope);
  };
}

export async function runWithStoreSnapshotScope<T>(
  operation: (readSnapshot: () => StoreSnapshotState | undefined) => T | Promise<T>
): Promise<{ value: T; storeState: StoreSnapshotState | undefined }> {
  const storage = await snapshotStorage();
  if (!storage) {
    const release = await acquireFallbackScope();
    const scope = createScope();
    const scopes = activeScopes();
    scopes.add(scope);
    try {
      const value = await operation(() => finishScope(scope));
      return { value, storeState: finishScope(scope) };
    } finally {
      scopes.delete(scope);
      release();
    }
  }
  const scope = createScope();
  const value = await storage.run(scope, () => operation(() => finishScope(scope)));
  return { value, storeState: finishScope(scope) };
}

export function hydrateStoresFromDocumentState(): void {
  const storeState = readDocumentState();
  if (!storeState) return;
  const stores = getStoresById();
  const hydrated = getHydratedStoreIds();
  for (const [id, snapshot] of Object.entries(storeState)) {
    if (hydrated.has(id)) continue;
    const registered = stores.get(id);
    const store = registered ? readRegisteredStore(registered) : undefined;
    if (registered && !store) stores.delete(id);
    if (!store || !snapshot || typeof snapshot !== "object") continue;
    hydrated.add(id);
    store.patch(snapshot);
  }
  for (const [id, registered] of stores) {
    const store = readRegisteredStore(registered);
    if (!store) {
      stores.delete(id);
      continue;
    }
    const matched = findMatchingSnapshot(store.getState(), storeState);
    if (!matched) continue;
    hydrated.add(matched.id);
    store.patch(matched.snapshot);
  }
}

export function setStoreWriteObserver<T extends Record<string, unknown>>(
  store: Store<T>,
  observer: StoreWriteObserver
): void {
  observers.set(store as AnyStore, observer);
}

export function notifyStoreWrite(store: AnyStore, method: StoreWriteMethod): void {
  observers.get(store)?.(method);
}
