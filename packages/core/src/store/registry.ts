import type { Store } from "./types.js";

type AnyStore = Store<Record<string, unknown>>;
type StoreRegistryValue = AnyStore | WeakRef<AnyStore>;
type StoreFinalizerToken = { id: string; reference: WeakRef<AnyStore> };

const storesByIdKey = "__tavo_stores_by_id__";
const finalizerKey = "__tavo_store_registry_finalizer__";
const creationCountsKey = "__tavo_store_creation_counts__";
const hydratedIdsKey = "__tavo_hydrated_store_ids__";
export const storeMetadataKey = "__tavo_store_metadata__";
const metadata = new WeakMap<AnyStore, { id: string }>();

function runtime(): Record<string, unknown> {
  return globalThis as Record<string, unknown>;
}

export function getStoresById(): Map<string, StoreRegistryValue> {
  const target = runtime();
  const existing = target[storesByIdKey];
  if (existing instanceof Map) return existing as Map<string, StoreRegistryValue>;
  const created = new Map<string, StoreRegistryValue>();
  target[storesByIdKey] = created;
  return created;
}

export function readRegisteredStore(value: StoreRegistryValue): AnyStore | undefined {
  return value instanceof WeakRef ? value.deref() : value;
}

function finalizer(): FinalizationRegistry<StoreFinalizerToken> {
  const target = runtime();
  const existing = target[finalizerKey];
  if (existing instanceof FinalizationRegistry) {
    return existing as FinalizationRegistry<StoreFinalizerToken>;
  }
  const created = new FinalizationRegistry<StoreFinalizerToken>(({ id, reference }) => {
    const stores = getStoresById();
    if (stores.get(id) === reference) stores.delete(id);
  });
  target[finalizerKey] = created;
  return created;
}

export function registerStore(id: string, store: AnyStore): void {
  const reference = new WeakRef(store);
  getStoresById().set(id, reference);
  finalizer().register(store, { id, reference }, reference);
}

export function getHydratedStoreIds(): Set<string> {
  const target = runtime();
  const existing = target[hydratedIdsKey];
  if (existing instanceof Set) return existing as Set<string>;
  const created = new Set<string>();
  target[hydratedIdsKey] = created;
  return created;
}

function creationCounts(): Map<string, number> {
  const target = runtime();
  const existing = target[creationCountsKey];
  if (existing instanceof Map) return existing as Map<string, number>;
  const created = new Map<string, number>();
  target[creationCountsKey] = created;
  return created;
}

function hashStoreKey(value: string): string {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(index);
  }
  return `s${(hash >>> 0).toString(36)}`;
}

export function createStoreSnapshotId(): string {
  const counts = creationCounts();
  const stack = new Error().stack ?? "";
  const key = stack
    .split("\n")
    .map((line) => line.trim())
    .find((line) => (
      line.length > 0
      && !line.includes("Error")
      && !line.includes("/store/core.")
      && !line.includes("\\store\\core.")
      && !line.includes("/store/registry.")
      && !line.includes("\\store\\registry.")
      && !line.includes("/framework/global-store.")
      && !line.includes("\\framework\\global-store.")
    ))?.replace(/\?.*$/, "") ?? `anonymous:${counts.size}`;
  const count = counts.get(key) ?? 0;
  counts.set(key, count + 1);
  return count === 0 ? hashStoreKey(key) : `${hashStoreKey(key)}_${count}`;
}

export function setStoreMetadata(store: AnyStore, id: string): void {
  metadata.set(store, { id });
  Object.defineProperty(store, storeMetadataKey, {
    configurable: false,
    enumerable: false,
    value: { id }
  });
}

export function getStoreMetadata(store: AnyStore): { id: string } | undefined {
  return metadata.get(store)
    ?? (store as AnyStore & Record<string, { id: string } | undefined>)[storeMetadataKey];
}
