import type { StoreDependency } from "../../reactivity.js";
import type { RootDependencySubscription } from "./types.js";

const objectIdentityIds = new WeakMap<object, number>();
let nextObjectIdentityId = 1;

function getObjectIdentity(value: object): number {
  const existing = objectIdentityIds.get(value);
  if (existing !== undefined) {
    return existing;
  }
  const created = nextObjectIdentityId;
  nextObjectIdentityId += 1;
  objectIdentityIds.set(value, created);
  return created;
}

export function getDependencyKey(dependency: StoreDependency): string {
  return [
    getObjectIdentity(dependency.store),
    getObjectIdentity(dependency.selector as unknown as object),
    getObjectIdentity(dependency.isEqual as unknown as object)
  ].join(":");
}

// Reconciles selector subscriptions for a single mounted component.
export function reconcileDependencies(
  previous: RootDependencySubscription[],
  next: StoreDependency[],
  onChange: () => void
): RootDependencySubscription[] {
  const deduped = new Map<string, StoreDependency>();
  for (const dependency of next) {
    const key = getDependencyKey(dependency);
    if (!deduped.has(key)) {
      deduped.set(key, dependency);
    }
  }

  const previousByKey = new Map<string, RootDependencySubscription>();
  for (const dependency of previous) {
    previousByKey.set(getDependencyKey(dependency), dependency);
  }

  const subscriptions: RootDependencySubscription[] = [];

  for (const [key, dependency] of deduped) {
    const existing = previousByKey.get(key);
    if (existing) {
      subscriptions.push(existing);
      previousByKey.delete(key);
      continue;
    }

    const unsubscribe = dependency.store.subscribeSelector(
      dependency.selector,
      () => {
        onChange();
      },
      { isEqual: dependency.isEqual }
    );

    subscriptions.push({
      ...dependency,
      unsubscribe
    });
  }

  for (const previousDependency of previousByKey.values()) {
    previousDependency.unsubscribe();
  }

  return subscriptions;
}
