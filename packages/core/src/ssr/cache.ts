import type { SsrStaticCache, SsrStaticCacheEntry } from "./types.js";

export type MemoryStaticCacheOptions = {
  /** Maximum process-local entries. Set to 0 to disable storage. */
  maxEntries?: number;
};

const DEFAULT_MAX_ENTRIES = 1_024;

function normalizeMaxEntries(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_MAX_ENTRIES;
  }
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("tavo ssr: memory static cache maxEntries must be a finite non-negative number.");
  }
  return Math.floor(value);
}

/** Creates the default process-local static SSR cache used by the Node request handler. */
export function createMemoryStaticCache(
  options?: MemoryStaticCacheOptions
): SsrStaticCache & { size(): number; clear(): void } {
  const entries = new Map<string, SsrStaticCacheEntry>();
  const maxEntries = normalizeMaxEntries(options?.maxEntries);

  return {
    get(key) {
      return entries.get(key) ?? null;
    },
    set(key, entry) {
      if (maxEntries === 0) {
        return;
      }
      // A refreshed entry becomes the newest insertion for deterministic eviction.
      entries.delete(key);
      entries.set(key, entry);
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next().value as string | undefined;
        if (oldest === undefined) {
          break;
        }
        entries.delete(oldest);
      }
    },
    delete(key) {
      entries.delete(key);
    },
    invalidateTags(tags) {
      const requested = new Set(tags.map((tag) => tag.trim()).filter(Boolean));
      let deleted = 0;
      for (const [key, entry] of entries) {
        if (entry.tags.some((tag) => requested.has(tag))) {
          entries.delete(key);
          deleted += 1;
        }
      }
      return deleted;
    },
    size() {
      return entries.size;
    },
    clear() {
      entries.clear();
    }
  };
}

/** Invalidates tagged entries when supported by a cache adapter. */
export async function invalidateStaticCache(
  cache: SsrStaticCache,
  tags: string | string[]
): Promise<number> {
  const normalized = (Array.isArray(tags) ? tags : [tags])
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (normalized.length === 0 || !cache.invalidateTags) {
    return 0;
  }
  return cache.invalidateTags(normalized);
}
