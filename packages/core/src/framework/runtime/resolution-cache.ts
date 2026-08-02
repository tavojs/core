import { emitInstrumentation } from "../../instrumentation.js";
import {
  readActiveStoreSnapshotState,
  restoreActiveStoreSnapshotState,
  type StoreSnapshotState
} from "../../store/core.js";
import type {
  PageRuntimeOptions,
  PagesRuntimeResolved
} from "../types.js";

export type CachedResolvedData = Omit<PagesRuntimeResolved, "node"> & {
  expiresAt: number | null;
  storeState?: StoreSnapshotState;
};

type ResolutionCacheOptions = {
  maxEntries: number;
  instrumentation: PageRuntimeOptions["instrumentation"];
};

export function createRuntimeResolutionCache(options: ResolutionCacheOptions) {
  const resolved = new Map<string, CachedResolvedData>();
  const inflight = new Map<string, Promise<PagesRuntimeResolved>>();

  function getFresh(key: string): CachedResolvedData | undefined {
    const cached = resolved.get(key);
    if (!cached) return undefined;
    if (cached.expiresAt !== null && cached.expiresAt <= Date.now()) {
      resolved.delete(key);
      return undefined;
    }
    return cached;
  }

  function restore(
    cached: CachedResolvedData,
    renderResolved: (value: PagesRuntimeResolved) => PagesRuntimeResolved["node"]
  ): PagesRuntimeResolved {
    const { expiresAt: _expiresAt, storeState, ...value } = cached;
    restoreActiveStoreSnapshotState(storeState);
    return {
      ...value,
      node: renderResolved({ ...value, node: null })
    };
  }

  function store(
    key: string,
    canReuse: boolean,
    value: PagesRuntimeResolved
  ): void {
    if (
      !canReuse ||
      options.maxEntries <= 0 ||
      !value.cache.static ||
      value.redirect ||
      value.status >= 500
    ) {
      if (canReuse) resolved.delete(key);
      return;
    }
    resolved.delete(key);
    resolved.set(key, {
      pathname: value.pathname,
      params: value.params,
      route: value.route,
      status: value.status,
      data: value.data,
      error: value.error,
      layers: value.layers,
      layerData: value.layerData,
      head: value.head,
      cache: value.cache,
      renderMode: value.renderMode,
      redirect: value.redirect,
      i18n: value.i18n,
      storeState: readActiveStoreSnapshotState(),
      expiresAt: value.cache.revalidate === null
        ? null
        : Date.now() + value.cache.revalidate * 1000
    });
    while (resolved.size > options.maxEntries) {
      const oldest = resolved.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      resolved.delete(oldest);
    }
  }

  function invalidate(tags: string | string[]): number {
    const requested = new Set(
      (Array.isArray(tags) ? tags : [tags])
        .map((tag) => tag.trim())
        .filter(Boolean)
    );
    if (requested.size === 0) return 0;
    let deleted = 0;
    for (const [key, entry] of resolved) {
      if (!entry.cache.tags.some((tag) => requested.has(tag))) continue;
      resolved.delete(key);
      deleted += 1;
    }
    emitInstrumentation(options.instrumentation, {
      name: "route.cache",
      phase: "invalidate",
      cacheTags: Array.from(requested),
      count: deleted
    });
    return deleted;
  }

  return {
    clear: () => resolved.clear(),
    entryCount: () => resolved.size,
    getFresh,
    getPending: (key: string) => inflight.get(key),
    pendingCount: () => inflight.size,
    removePending: (key: string) => inflight.delete(key),
    restore,
    setPending: (key: string, work: Promise<PagesRuntimeResolved>) => {
      inflight.set(key, work);
    },
    store,
    invalidate
  };
}

export type RuntimeResolutionCache = ReturnType<typeof createRuntimeResolutionCache>;
