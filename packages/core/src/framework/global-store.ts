import { createStore, setStoreWriteObserver, type Store, type StoreInitializer } from "../store/core.js";
import type { AnyRecord, AnyStore, GlobalRegistry } from "./types.js";

const warnedSsrWriteStores = new Set<string>();

/** Returns the global symbol key used to persist shared stores. */
function getGlobalRegistryKey(): string {
  return "__tavo_global_store_registry__";
}

function isServerEnvironment(): boolean {
  return typeof window === "undefined";
}

function warnSsrGlobalStoreWrite(name: string, method: "setState" | "set" | "patch"): void {
  if (!isServerEnvironment() || warnedSsrWriteStores.has(name)) {
    return;
  }
  warnedSsrWriteStores.add(name);
  console.warn(
    `tavo store: global store "${name}" was written with ${method}() during SSR. ` +
      "Global stores are process-wide on the server, so request-specific data can leak between users. " +
      "Keep per-user data request-scoped instead."
  );
}

/** Gets or initializes the process-wide store registry map. */
function getGlobalRegistry(): GlobalRegistry {
  const target = globalThis as unknown as Record<string, unknown>;
  const key = getGlobalRegistryKey();
  const existing = target[key];
  if (existing instanceof Map) {
    return existing as GlobalRegistry;
  }

  const registry = new Map<string, AnyStore>();
  target[key] = registry;
  return registry;
}

/** Defines a named global store once and returns the shared instance. */
export function defineGlobalStore<T extends AnyRecord>(
  name: string,
  initialState: T | StoreInitializer<T>
): Store<T> {
  const registry = getGlobalRegistry();
  const existing = registry.get(name);
  if (existing) {
    return existing as Store<T>;
  }

  const store = createStore(initialState);
  setStoreWriteObserver(store, (method) => {
    warnSsrGlobalStoreWrite(name, method);
  });
  registry.set(name, store as AnyStore);
  return store;
}

/** Looks up a previously defined global store by name. */
export function getGlobalStore<T extends AnyRecord>(name: string): Store<T> {
  const registry = getGlobalRegistry();
  const store = registry.get(name);
  if (!store) {
    throw new Error(`tavo store: global store "${name}" was not defined.`);
  }
  return store as Store<T>;
}

/** Returns true when a named global store exists in the shared registry. */
export function hasGlobalStore(name: string): boolean {
  return getGlobalRegistry().has(name);
}

/** Lists all registered global store names. */
export function listGlobalStores(): string[] {
  return Array.from(getGlobalRegistry().keys());
}
