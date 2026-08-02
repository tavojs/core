import type { MountedComponent } from "./types.js";

type LifecycleCleanup = (() => void) | void;
type LifecycleCallback = () => LifecycleCleanup;

export type ComponentLifecycleTask = {
  callback: LifecycleCallback;
  cleanup: (() => void) | null;
  pending: boolean;
};

export type ComponentRuntimeState = {
  cells: Map<symbol, unknown>;
  layoutTasks: Map<symbol, ComponentLifecycleTask>;
  passiveTasks: Map<symbol, ComponentLifecycleTask>;
  cleanups: Set<() => void>;
  idBase: string;
  disposed: boolean;
};

let activeComponent: MountedComponent | null = null;
const scheduledPassiveComponents = new Set<MountedComponent>();
let passiveFlushScheduled = false;
let nextRuntimeComponentId = 0;
let activeServerComponent: { idBase: string; nextId: number } | null = null;
let mountedComponentCount = 0;

export function createComponentRuntimeState(): ComponentRuntimeState {
  mountedComponentCount += 1;
  return {
    cells: new Map<symbol, unknown>(),
    layoutTasks: new Map<symbol, ComponentLifecycleTask>(),
    passiveTasks: new Map<symbol, ComponentLifecycleTask>(),
    cleanups: new Set<() => void>(),
    idBase: claimRuntimeComponentId(),
    disposed: false
  };
}

export function resetRuntimeIdCounter(): void {
  nextRuntimeComponentId = 0;
}

export function claimRuntimeComponentId(): string {
  const id = nextRuntimeComponentId;
  nextRuntimeComponentId += 1;
  return `t${id}`;
}

export function withActiveComponent<T>(
  component: MountedComponent,
  fn: () => T
): T {
  const previous = activeComponent;
  activeComponent = component;
  try {
    return fn();
  } finally {
    activeComponent = previous;
  }
}

export function getActiveComponent(): MountedComponent | null {
  return activeComponent;
}

export function withServerRenderComponent<T>(fn: () => T): T {
  const previous = activeServerComponent;
  activeServerComponent = {
    idBase: claimRuntimeComponentId(),
    nextId: 0
  };
  try {
    return fn();
  } finally {
    activeServerComponent = previous;
  }
}

export function createRuntimeId(prefix = "id", key?: symbol): string {
  const component = activeComponent;
  if (component) {
    if (key) {
      const existing = component.runtime.cells.get(key);
      if (typeof existing === "string") {
        return existing;
      }
      const value = `${prefix}-${component.runtime.idBase}-${component.runtime.cells.size}`;
      component.runtime.cells.set(key, value);
      return value;
    }
    return `${prefix}-${component.runtime.idBase}-${component.runtime.cells.size}`;
  }

  if (activeServerComponent) {
    const id = activeServerComponent.nextId;
    activeServerComponent.nextId += 1;
    return `${prefix}-${activeServerComponent.idBase}-${id}`;
  }

  return `${prefix}-${claimRuntimeComponentId()}-0`;
}

export function getComponentCell<T>(key: symbol, factory: () => T): T {
  const component = activeComponent;
  if (!component) {
    return factory();
  }
  if (!component.runtime.cells.has(key)) {
    component.runtime.cells.set(key, factory());
  }
  return component.runtime.cells.get(key) as T;
}

export function registerComponentCleanup(cleanup: () => void): () => void {
  const component = activeComponent;
  if (!component) {
    return cleanup;
  }

  let active = true;
  const wrapped = () => {
    if (!active) {
      return;
    }
    active = false;
    component.runtime.cleanups.delete(wrapped);
    cleanup();
  };
  component.runtime.cleanups.add(wrapped);
  return wrapped;
}

function upsertLifecycleTask(
  tasks: Map<symbol, ComponentLifecycleTask>,
  key: symbol,
  callback: LifecycleCallback
): void {
  const existing = tasks.get(key);
  if (existing) {
    existing.callback = callback;
    existing.pending = true;
    return;
  }
  tasks.set(key, {
    callback,
    cleanup: null,
    pending: true
  });
}

export function queueLayoutTask(key: symbol, callback: LifecycleCallback): void {
  const component = activeComponent;
  if (!component) {
    return;
  }
  upsertLifecycleTask(component.runtime.layoutTasks, key, callback);
}

export function queuePassiveTask(key: symbol, callback: LifecycleCallback): void {
  const component = activeComponent;
  if (!component) {
    return;
  }
  upsertLifecycleTask(component.runtime.passiveTasks, key, callback);
}

export function queuePassiveTaskOnce(key: symbol, callback: LifecycleCallback): void {
  const component = activeComponent;
  if (!component || component.runtime.passiveTasks.has(key)) {
    return;
  }
  upsertLifecycleTask(component.runtime.passiveTasks, key, callback);
}

function runTask(task: ComponentLifecycleTask): void {
  task.pending = false;
  if (task.cleanup) {
    try {
      task.cleanup();
    } catch {
      // Cleanup errors are intentionally non-fatal during lifecycle flushes.
    }
    task.cleanup = null;
  }

  try {
    const cleanup = task.callback();
    task.cleanup = typeof cleanup === "function" ? cleanup : null;
  } catch {
    task.cleanup = null;
  }
}

export function runLayoutTasks(component: MountedComponent): void {
  if (component.unmounted) {
    return;
  }

  for (const task of component.runtime.layoutTasks.values()) {
    if (task.pending) {
      runTask(task);
    }
  }
}

function runPassiveTasks(component: MountedComponent): void {
  if (component.unmounted) {
    return;
  }

  for (const task of component.runtime.passiveTasks.values()) {
    if (task.pending) {
      runTask(task);
    }
  }
}

function flushPassiveTasks(): void {
  passiveFlushScheduled = false;
  const queue = Array.from(scheduledPassiveComponents);
  scheduledPassiveComponents.clear();
  for (const component of queue) {
    runPassiveTasks(component);
  }
}

export function schedulePassiveTasks(component: MountedComponent): void {
  if (component.unmounted) {
    return;
  }

  const hasPending = Array.from(component.runtime.passiveTasks.values()).some(
    (task) => task.pending
  );
  if (!hasPending) {
    return;
  }

  scheduledPassiveComponents.add(component);
  if (passiveFlushScheduled) {
    return;
  }
  passiveFlushScheduled = true;
  queueMicrotask(flushPassiveTasks);
}

export function cleanupComponentRuntime(component: MountedComponent): void {
  if (component.runtime.disposed) {
    return;
  }
  component.runtime.disposed = true;
  mountedComponentCount = Math.max(0, mountedComponentCount - 1);
  scheduledPassiveComponents.delete(component);
  for (const task of component.runtime.layoutTasks.values()) {
    task.pending = false;
    if (task.cleanup) {
      try {
        task.cleanup();
      } catch {
        // Ignore cleanup failures during teardown.
      }
      task.cleanup = null;
    }
  }

  for (const task of component.runtime.passiveTasks.values()) {
    task.pending = false;
    if (task.cleanup) {
      try {
        task.cleanup();
      } catch {
        // Ignore cleanup failures during teardown.
      }
      task.cleanup = null;
    }
  }

  const pending = Array.from(component.runtime.cleanups);
  component.runtime.cleanups.clear();
  for (const cleanup of pending) {
    try {
      cleanup();
    } catch {
      // Ignore cleanup failures during teardown.
    }
  }
}

export function getComponentRuntimeDiagnostics(): {
  mountedComponents: number;
  pendingPassiveEffects: number;
} {
  return {
    mountedComponents: mountedComponentCount,
    pendingPassiveEffects: scheduledPassiveComponents.size
  };
}
