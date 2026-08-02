import type { MountedComponent } from "./types.js";

export type UpdatePriority = "immediate" | "user-blocking" | "normal" | "background" | "idle";

const priorityRank: Record<UpdatePriority, number> = {
  immediate: 0,
  "user-blocking": 1,
  normal: 2,
  background: 3,
  idle: 4
};

const queuedComponents = new Map<MountedComponent, UpdatePriority>();
let currentPriority: UpdatePriority = "normal";
let microtaskScheduled = false;
let backgroundScheduled = false;
let idleScheduled = false;

function flushThrough(maximumRank: number): void {
  let rendered = true;
  while (rendered) {
    rendered = false;
    for (const [item, priority] of queuedComponents) {
      if (priorityRank[priority] > maximumRank) {
        continue;
      }
      queuedComponents.delete(item);
      if (!item.unmounted) {
        item.performRender();
      }
      rendered = true;
    }
  }
  scheduleRemainingWork();
}

function scheduleRemainingWork(): void {
  let bestRank = Number.POSITIVE_INFINITY;
  for (const priority of queuedComponents.values()) {
    bestRank = Math.min(bestRank, priorityRank[priority]);
  }
  if (bestRank <= priorityRank.normal && !microtaskScheduled) {
    microtaskScheduled = true;
    queueMicrotask(() => {
      microtaskScheduled = false;
      flushThrough(priorityRank.normal);
    });
  }
  if (bestRank === priorityRank.background && !backgroundScheduled) {
    backgroundScheduled = true;
    setTimeout(() => {
      backgroundScheduled = false;
      flushThrough(priorityRank.background);
    }, 0);
  }
  if (bestRank === priorityRank.idle && !idleScheduled) {
    idleScheduled = true;
    const flush = () => {
      idleScheduled = false;
      flushThrough(priorityRank.idle);
    };
    const requestIdle = (globalThis as { requestIdleCallback?: (callback: () => void) => unknown }).requestIdleCallback;
    if (requestIdle) {
      requestIdle(flush);
    } else {
      setTimeout(flush, 16);
    }
  }
}

/** Schedules connected component updates according to the active update priority. */
export function scheduleComponent(component: MountedComponent): void {
  if (component.unmounted) {
    return;
  }
  const queuedPriority = queuedComponents.get(component);
  if (!queuedPriority || priorityRank[currentPriority] < priorityRank[queuedPriority]) {
    queuedComponents.set(component, currentPriority);
  }
  scheduleRemainingWork();
}

export function runWithUpdatePriority<T>(priority: UpdatePriority, callback: () => T): T {
  const previous = currentPriority;
  currentPriority = priority;
  try {
    return callback();
  } finally {
    currentPriority = previous;
  }
}

export function startTransition(callback: () => void): void {
  runWithUpdatePriority("background", callback);
}

export function flushSync<T>(callback: () => T): T {
  const result = runWithUpdatePriority("immediate", callback);
  flushThrough(priorityRank.immediate);
  return result;
}

export function getCurrentUpdatePriority(): UpdatePriority {
  return currentPriority;
}

export function cancelScheduledComponent(component: MountedComponent): void {
  queuedComponents.delete(component);
}

export function getScheduledUpdateCount(): number {
  return queuedComponents.size;
}
