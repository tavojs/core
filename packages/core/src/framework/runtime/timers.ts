type TimerKind = "setTimeout" | "setInterval";
type TimerHandle = unknown;

type TimerScope = {
  label: string;
  records: Set<TimerRecord>;
};

type TimerRecord = {
  kind: TimerKind;
  handle: TimerHandle;
  scope: TimerScope;
};

type TimerGlobals = typeof globalThis & {
  process?: { env?: Record<string, string | undefined> };
};

const originalSetTimeout = globalThis.setTimeout.bind(globalThis) as (...args: unknown[]) => TimerHandle;
const originalClearTimeout = globalThis.clearTimeout.bind(globalThis) as (handle?: TimerHandle) => void;
const originalSetInterval = globalThis.setInterval.bind(globalThis) as (...args: unknown[]) => TimerHandle;
const originalClearInterval = globalThis.clearInterval.bind(globalThis) as (handle?: TimerHandle) => void;
const timerOwners = new Map<TimerHandle, TimerRecord>();

let activeScope: TimerScope | null = null;
let patchedDepth = 0;

function isServerRuntime(): boolean {
  return typeof (globalThis as { document?: unknown }).document === "undefined";
}

function isDevRuntime(): boolean {
  return (globalThis as TimerGlobals).process?.env?.NODE_ENV !== "production";
}

function warnDetachedTimer(scope: TimerScope, record: TimerRecord): void {
  if (typeof console === "undefined" || typeof console.warn !== "function") {
    return;
  }
  console.warn(
    `[tavo ssr] ${record.kind} was left active after ${scope.label}. ` +
      "Timers created during SSR load() must finish before the request completes, " +
      "or be moved to client lifecycle code such as onMount()."
  );
}

function registerTimer(
  kind: TimerKind,
  handle: TimerHandle,
  scope: TimerScope | null
): void {
  if (!scope) {
    return;
  }
  const record: TimerRecord = { kind, handle, scope };
  timerOwners.set(handle, record);
  scope.records.add(record);
}

function forgetTimer(handle: TimerHandle): void {
  const record = timerOwners.get(handle);
  if (!record) {
    return;
  }
  timerOwners.delete(handle);
  record.scope.records.delete(record);
}

function installTimerPatch(): void {
  if (patchedDepth > 0) {
    patchedDepth += 1;
    return;
  }
  patchedDepth = 1;

  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const scope = activeScope;
    let handle: TimerHandle;
    const wrapped =
      typeof handler === "function"
        ? (...handlerArgs: unknown[]) => {
            forgetTimer(handle);
            return handler(...handlerArgs);
          }
        : handler;
    handle = originalSetTimeout(wrapped as TimerHandler, timeout, ...args);
    registerTimer("setTimeout", handle, scope);
    return handle;
  }) as unknown as typeof globalThis.setTimeout;

  globalThis.clearTimeout = ((handle?: TimerHandle) => {
    if (handle !== undefined) {
      forgetTimer(handle);
    }
    return originalClearTimeout(handle);
  }) as unknown as typeof globalThis.clearTimeout;

  globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
    const handle = originalSetInterval(handler, timeout, ...args);
    registerTimer("setInterval", handle, activeScope);
    return handle;
  }) as unknown as typeof globalThis.setInterval;

  globalThis.clearInterval = ((handle?: TimerHandle) => {
    if (handle !== undefined) {
      forgetTimer(handle);
    }
    return originalClearInterval(handle);
  }) as unknown as typeof globalThis.clearInterval;
}

function uninstallTimerPatch(): void {
  patchedDepth -= 1;
  if (patchedDepth > 0) {
    return;
  }
  patchedDepth = 0;
  globalThis.setTimeout = originalSetTimeout as typeof globalThis.setTimeout;
  globalThis.clearTimeout = originalClearTimeout as typeof globalThis.clearTimeout;
  globalThis.setInterval = originalSetInterval as typeof globalThis.setInterval;
  globalThis.clearInterval = originalClearInterval as typeof globalThis.clearInterval;
}

function disposeScope(scope: TimerScope): void {
  const pending = Array.from(scope.records);
  for (const record of pending) {
    warnDetachedTimer(scope, record);
    forgetTimer(record.handle);
    if (record.kind === "setInterval") {
      originalClearInterval(record.handle);
    } else {
      originalClearTimeout(record.handle);
    }
  }
}

export async function runSsrLoadWithTimerGuard<T>(
  label: string,
  fn: () => Promise<T> | T
): Promise<T> {
  if (!isServerRuntime() || !isDevRuntime()) {
    return await fn();
  }

  const scope: TimerScope = {
    label,
    records: new Set()
  };
  const previousScope = activeScope;
  installTimerPatch();
  activeScope = scope;
  try {
    return await fn();
  } finally {
    activeScope = previousScope;
    disposeScope(scope);
    uninstallTimerPatch();
  }
}
