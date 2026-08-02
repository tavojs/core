import type { Store, StoreSelector } from "./store/index.js";

export type StoreDependency = {
  store: Store<Record<string, unknown>>;
  selector: StoreSelector<Record<string, unknown>, unknown>;
  isEqual: (left: unknown, right: unknown) => boolean;
};

type DependencyCollector = (dependency: StoreDependency) => void;

let activeCollector: DependencyCollector | null = null;

export function withDependencyCollector<T>(
  collector: DependencyCollector,
  fn: () => T
): T {
  const previous = activeCollector;
  activeCollector = collector;
  try {
    return fn();
  } finally {
    activeCollector = previous;
  }
}

export function withoutDependencyCollector<T>(fn: () => T): T {
  const previous = activeCollector;
  activeCollector = null;
  try {
    return fn();
  } finally {
    activeCollector = previous;
  }
}

export function trackStoreDependency(dependency: StoreDependency): void {
  if (!activeCollector) {
    return;
  }
  activeCollector(dependency);
}
