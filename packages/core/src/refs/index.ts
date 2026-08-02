/** Object ref shape used by MVC controllers to keep direct DOM handles. */
export type DomRefObject<T extends Element = Element> = {
  current: T | null;
};

/** Callback ref shape for one-off DOM element access. */
export type DomRefCallback<T extends Element = Element> = (node: T | null) => void;

/** Public DOM ref value accepted by intrinsic JSX elements. */
export type DomRef<T extends Element = Element> = DomRefObject<T> | DomRefCallback<T> | null | undefined;

/** Creates a mutable DOM ref object for controller-owned element access. */
export function createRef<T extends Element = Element>(): DomRefObject<T> {
  return { current: null };
}

/** Returns true when a value looks like a mutable DOM ref object. */
function isDomRefObject<T extends Element>(value: unknown): value is DomRefObject<T> {
  return typeof value === "object" && value !== null && "current" in value;
}

/** Assigns a DOM node to an object or callback ref. */
export function assignDomRef<T extends Element>(ref: unknown, node: T): void {
  if (!ref) {
    return;
  }
  if (typeof ref === "function") {
    (ref as DomRefCallback<T>)(node);
    return;
  }
  if (isDomRefObject<T>(ref)) {
    ref.current = node;
  }
}

/** Clears an object or callback ref when the backing DOM node is removed or replaced. */
export function clearDomRef<T extends Element = Element>(ref: unknown): void {
  if (!ref) {
    return;
  }
  if (typeof ref === "function") {
    (ref as DomRefCallback<T>)(null);
    return;
  }
  if (isDomRefObject<T>(ref)) {
    ref.current = null;
  }
}

/** Sets a ref to a DOM node or null. Useful when writing framework adapters. */
export function setRef<T extends Element>(ref: DomRef<T>, node: T | null): void {
  if (node) {
    assignDomRef(ref, node);
    return;
  }
  clearDomRef(ref);
}

/** Combines several refs into one callback ref. */
export function mergeRefs<T extends Element>(...refs: Array<DomRef<T>>): DomRefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      setRef(ref, node);
    }
  };
}

/** Creates a keyed collection of refs for dynamic lists. */
export function createListRefs<K extends string | number, T extends Element = Element>() {
  const refs = new Map<K, DomRefObject<T>>();
  return {
    get(key: K): DomRefObject<T> {
      const existing = refs.get(key);
      if (existing) {
        return existing;
      }
      const ref = createRef<T>();
      refs.set(key, ref);
      return ref;
    },
    delete(key: K): boolean {
      const ref = refs.get(key);
      if (ref) {
        ref.current = null;
      }
      return refs.delete(key);
    },
    clear(): void {
      for (const ref of refs.values()) {
        ref.current = null;
      }
      refs.clear();
    },
    entries(): IterableIterator<[K, DomRefObject<T>]> {
      return refs.entries();
    }
  };
}
