import type {
  StorePath,
  StorePathSegment,
  StoreSelector,
  StoreSetValue
} from "./types.js";

const pathCache = new Map<string, StorePathSegment[]>();
const MAX_PATH_CACHE_ENTRIES = 1_024;
const UNSAFE_PATH_SEGMENTS = new Set(["__proto__", "prototype", "constructor"]);

function readPathValue(value: unknown, path: StorePathSegment[]): unknown {
  let current = value;
  for (const segment of path) {
    if (current === null || current === undefined) return undefined;
    if (!Object.prototype.hasOwnProperty.call(current, segment)) return undefined;
    current = (current as Record<string | number, unknown>)[segment];
  }
  return current;
}

function getCachedPath(target: string): StorePathSegment[] {
  const cached = pathCache.get(target);
  if (cached) return cached;
  const created = target.includes(".") ? target.split(".").filter(Boolean) : [target];
  if (pathCache.size >= MAX_PATH_CACHE_ENTRIES) {
    const oldest = pathCache.keys().next().value as string | undefined;
    if (oldest !== undefined) pathCache.delete(oldest);
  }
  pathCache.set(target, created);
  return created;
}

function getPath(target: StorePath, state: Record<string, unknown>): StorePathSegment[] {
  if (typeof target === "number") return [target];
  if (typeof target !== "string") return [...target];
  return Object.prototype.hasOwnProperty.call(state, target)
    ? [target]
    : getCachedPath(target);
}

function assertSafePath(path: StorePathSegment[]): void {
  for (const segment of path) {
    if (typeof segment === "string" && UNSAFE_PATH_SEGMENTS.has(segment)) {
      throw new TypeError(
        `tavo store: unsafe path segment "${segment}" is not allowed.`
      );
    }
  }
}

function cloneContainer(
  value: unknown,
  nextSegment: StorePathSegment | undefined
): Record<string | number, unknown> | unknown[] {
  if (Array.isArray(value)) return value.slice();
  if (typeof value === "object" && value !== null) {
    return { ...(value as Record<string | number, unknown>) };
  }
  return typeof nextSegment === "number" ? [] : {};
}

export function setPathValue<T extends Record<string, unknown>, S>(
  state: T,
  target: StorePath,
  value: StoreSetValue<T, S>
): T {
  const path = getPath(target, state);
  assertSafePath(path);
  if (path.length === 0) return state;
  const previousValue = readPathValue(state, path) as S;
  const nextValue = typeof value === "function"
    ? (value as (previous: S, state: T) => S)(previousValue, state)
    : value;
  if (Object.is(previousValue, nextValue)) return state;
  function writePath(current: unknown, index: number): unknown {
    const segment = path[index]!;
    const container = cloneContainer(current, path[index + 1]);
    const record = container as Record<string | number, unknown>;
    const written = index === path.length - 1
      ? nextValue
      : writePath(record[segment], index + 1);
    Object.defineProperty(record, segment, {
      configurable: true,
      enumerable: true,
      value: written,
      writable: true
    });
    return container;
  }
  return writePath(state, 0) as T;
}

export function createWatchSelector<T extends Record<string, unknown>, S>(
  target: StorePath | StoreSelector<T, S>,
  state: T
): StoreSelector<T, S> {
  if (typeof target === "function") return target;
  if (typeof target === "number") {
    const path = [target];
    return ((next: T) => readPathValue(next, path) as S) as StoreSelector<T, S>;
  }
  if (typeof target !== "string") {
    const path = [...target];
    return ((next: T) => readPathValue(next, path) as S) as StoreSelector<T, S>;
  }
  const splitPath = getCachedPath(target);
  return ((next: T) => {
    const path = Object.prototype.hasOwnProperty.call(next, target)
      ? [target]
      : splitPath;
    return readPathValue(next, path) as S;
  }) as StoreSelector<T, S>;
}
