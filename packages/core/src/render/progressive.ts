import { CONTEXT_PROVIDER, DEFERRED_BLOCK, ERROR_BOUNDARY } from "../components/special.js";
import { Fragment, type Child, type VNode } from "../jsx.js";
import {
  resetRuntimeIdCounter,
  withServerRenderComponent
} from "../runtime/dom/component-runtime.js";
import { escapeHtml, escapeScriptJson } from "../security.js";
import { withStyleRegistry, type StyleRegistry } from "../style.js";
import {
  isVoidElement,
  normalizeElementTagName,
  renderAttributes,
  renderRawTextChildren
} from "./shared.js";
import { renderToStringWithContext } from "./static.js";

export type ProgressiveRenderOptions = {
  nonce?: string;
  beforeRender?: () => void;
  styleRegistry?: StyleRegistry;
  /** Stops pending stream consumption without cancelling caller-owned promises. */
  signal?: AbortSignal;
};

type DeferredTarget = {
  onResolve(value: unknown): Promise<string>;
  onReject(error: unknown): Promise<string>;
  serialize?: (value: unknown) => unknown;
};
type DeferredCompletion = {
  task: DeferredChunkTask;
  key: string;
  render(): Promise<string>;
};
type DeferredChunkTask = Promise<DeferredCompletion>;
type StreamRenderState = {
  context: Map<symbol, unknown>;
  nextId: number;
  tasks: Set<DeferredChunkTask>;
  completions: {
    ready: Set<DeferredCompletion>;
    wake: (() => void) | null;
    closed: boolean;
  };
  deferredByKey: Map<string, {
    promise: DeferredChunkTask;
    targets: Map<string, DeferredTarget>;
  }>;
  options?: ProgressiveRenderOptions;
};

type DeferredUpdate = {
  id: string;
  key?: string;
  status: "resolved" | "rejected";
  data?: unknown;
  error?: unknown;
  html: string;
};

function buildDeferredPatchScript(
  updates: DeferredUpdate[],
  options?: ProgressiveRenderOptions
): string {
  const payload = escapeScriptJson(JSON.stringify(updates.map((update) => ({
    id: update.id,
    key: update.key,
    status: update.status,
    data: update.data,
    error: update.error,
    html: update.html
  }))));
  const nonce = options?.nonce ? ` nonce="${escapeHtml(options.nonce)}"` : "";
  return `<script${nonce}>(function(){var previous=window.__TAVO_DEFERRED__;` +
    "var registry=Object.create(null);if(previous){Object.keys(previous).forEach(" +
    "function(key){Object.defineProperty(registry,key,{value:previous[key]," +
    "writable:true,enumerable:true,configurable:true});});}" +
    `window.__TAVO_DEFERRED__=registry;var updates=${payload};` +
    "for(var i=0;i<updates.length;i+=1){var update=updates[i];" +
    "var key=update.key||update.id;Object.defineProperty(registry,key,{" +
    "value:{status:update.status,data:update.data,error:update.error}," +
    "writable:true,enumerable:true,configurable:true});" +
    "var el=document.getElementById(update.id);if(el){el.outerHTML=update.html;}}" +
    "})();</script>";
}

function isDeferredTimeoutError(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "TAVO_DEFERRED_TIMEOUT";
}

function stringifyDeferredError(error: unknown): string {
  return isDeferredTimeoutError(error)
    ? "Deferred request timed out"
    : "Deferred request failed";
}

function deferredTarget(
  node: VNode,
  state: StreamRenderState
): DeferredTarget {
  const child = node.props.children[0];
  return {
    async onResolve(resolvedValue: unknown) {
      state.options?.signal?.throwIfAborted();
      const renderedValue = typeof child === "function"
        ? (child as (input: unknown) => Child)(resolvedValue)
        : child;
      return renderStreamNodeWithStyleRegistry(renderedValue as Child, state);
    },
    async onReject(error: unknown) {
      state.options?.signal?.throwIfAborted();
      const fallback = isDeferredTimeoutError(error)
        ? node.props.timeoutFallback ?? node.props.errorFallback
        : node.props.errorFallback;
      const renderedError = typeof fallback === "function"
        ? (fallback as (value: unknown) => Child)(error)
        : (fallback ?? node.props.fallback ?? null) as Child;
      return renderStreamNodeWithStyleRegistry(renderedError, state);
    },
    serialize: node.props.serialize as ((value: unknown) => unknown) | undefined
  };
}

function createDeferredTask(
  value: Promise<unknown>,
  key: string,
  targets: Map<string, DeferredTarget>,
  state: StreamRenderState
): DeferredChunkTask {
  // Settle promises immediately, but render patches only after consuming the shell.
  // This keeps completed work available under backpressure and includes targets
  // registered later in the shell. Nested patches follow their parent patch.
  const outcome = value.then(
    (data) => ({ status: "resolved" as const, data }),
    (error: unknown) => ({ status: "rejected" as const, error }),
  );
  const render = async () => {
    const result = await outcome;
    state.options?.signal?.throwIfAborted();
    try {
      if (result.status === "rejected") throw result.error;
      const resolvedValue = result.data;
      const updates = await Promise.all(Array.from(targets.entries()).map(
        async ([id, target]): Promise<DeferredUpdate> => {
          state.options?.signal?.throwIfAborted();
          return {
            id,
            key,
            status: "resolved",
            data: target.serialize ? target.serialize(resolvedValue) : resolvedValue,
            html: await target.onResolve(resolvedValue)
          };
        }
      ));
      return buildDeferredPatchScript(updates, state.options);
    } catch (error) {
      state.options?.signal?.throwIfAborted();
      const updates = await Promise.all(Array.from(targets.entries()).map(
        async ([id, target]): Promise<DeferredUpdate> => ({
          id,
          key,
          status: "rejected",
          error: isDeferredTimeoutError(error) ? error : stringifyDeferredError(error),
          html: await target.onReject(error)
        })
      ));
      return buildDeferredPatchScript(updates, state.options);
    }
  };
  const task: DeferredChunkTask = outcome.then(() => {
    const completed = { task, key, render };
    if (!state.completions.closed) {
      state.completions.ready.add(completed);
      state.completions.wake?.();
      state.completions.wake = null;
    }
    return completed;
  });
  return task;
}

async function renderDeferredNode(
  node: VNode,
  value: Promise<unknown>,
  state: StreamRenderState
): Promise<string> {
  const tag = normalizeElementTagName(node.props.as);
  const key = typeof node.props.id === "string" && node.props.id.length > 0
    ? node.props.id
    : `tavo-deferred-${state.nextId++}`;
  const id = `${key}-target-${state.nextId++}`;
  const fallbackHtml = await renderToStreamStringWithContext(
    (node.props.fallback ?? null) as Child,
    state
  );
  const existing = state.deferredByKey.get(key);
  if (existing) {
    existing.targets.set(id, deferredTarget(node, state));
  } else {
    const targets = new Map<string, DeferredTarget>();
    targets.set(id, deferredTarget(node, state));
    const task = createDeferredTask(value, key, targets, state);
    state.deferredByKey.set(key, { promise: task, targets });
    state.tasks.add(task);
  }
  return `<${tag} id="${escapeHtml(id)}" ` +
    `data-tavo-deferred="pending">${fallbackHtml}</${tag}>`;
}

async function renderToStreamStringWithContext(
  node: Child,
  state: StreamRenderState
): Promise<string> {
  state.options?.signal?.throwIfAborted();
  state.options?.beforeRender?.();
  state.options?.signal?.throwIfAborted();
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") {
    return escapeHtml(String(node));
  }
  if (Array.isArray(node)) {
    return (await Promise.all(node.map((item) => (
      renderToStreamStringWithContext(item, state)
    )))).join("");
  }
  if (typeof node.type === "function") {
    const component = node.type as (props: VNode["props"]) => Child;
    return withServerRenderComponent(() => (
      renderToStreamStringWithContext(component(node.props), state)
    ));
  }
  if (node.type === CONTEXT_PROVIDER) {
    const nextContext = new Map(state.context);
    const contextRef = node.props.context as { id: symbol };
    nextContext.set(contextRef.id, node.props.value);
    return renderToStreamStringWithContext(node.props.children, {
      ...state,
      context: nextContext
    });
  }
  if (node.type === ERROR_BOUNDARY) {
    try {
      return await renderToStreamStringWithContext(node.props.children, state);
    } catch (error) {
      state.options?.signal?.throwIfAborted();
      const fallback = node.props.fallback;
      const rendered = typeof fallback === "function"
        ? (fallback as (value: unknown) => Child)(error)
        : fallback as Child;
      return renderToStreamStringWithContext(rendered, state);
    }
  }
  if (node.type === DEFERRED_BLOCK) {
    const value = node.props.value;
    const isPromise = typeof value === "object"
      && value !== null
      && typeof (value as Promise<unknown>).then === "function";
    if (isPromise) return renderDeferredNode(node, value as Promise<unknown>, state);
    const child = node.props.children[0];
    const rendered = typeof child === "function"
      ? (child as (input: unknown) => Child)(value)
      : child;
    return renderToStreamStringWithContext(rendered as Child, state);
  }
  if (node.type === Fragment || typeof node.type === "symbol") {
    return (await Promise.all(node.props.children.map((item) => (
      renderToStreamStringWithContext(item, state)
    )))).join("");
  }

  const attrs = renderAttributes(node.props);
  const tag = normalizeElementTagName(node.type);
  if (isVoidElement(tag)) return `<${tag}${attrs}>`;
  const content = tag === "script" || tag === "style"
    ? node.props.children.map((item) => renderRawTextChildren(
      item,
      state.context,
      tag,
      renderToStringWithContext
    )).join("")
    : (await Promise.all(node.props.children.map((item) => (
      renderToStreamStringWithContext(item, state)
    )))).join("");
  return `<${tag}${attrs}>${content}</${tag}>`;
}

function renderStreamNodeWithStyleRegistry(
  node: Child,
  state: StreamRenderState
): Promise<string> {
  const registry = state.options?.styleRegistry;
  return registry
    ? withStyleRegistry(registry, () => renderToStreamStringWithContext(node, state))
    : renderToStreamStringWithContext(node, state);
}

export async function* renderToProgressiveStringChunks(
  node: Child,
  options?: ProgressiveRenderOptions
): AsyncGenerator<string, void, void> {
  options?.signal?.throwIfAborted();
  resetRuntimeIdCounter();
  options?.beforeRender?.();
  const state: StreamRenderState = {
    context: new Map<symbol, unknown>(),
    nextId: 0,
    tasks: new Set(),
    completions: { ready: new Set(), wake: null, closed: false },
    deferredByKey: new Map(),
    options
  };
  const onAbort = () => state.completions.wake?.();
  options?.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    yield await renderStreamNodeWithStyleRegistry(node, state);
    while (state.tasks.size > 0) {
      options?.signal?.throwIfAborted();
      if (state.completions.ready.size === 0) {
        await new Promise<void>((resolve) => { state.completions.wake = resolve; });
      }
      options?.signal?.throwIfAborted();
      const completed = state.completions.ready.values().next().value!;
      state.completions.ready.delete(completed);
      state.tasks.delete(completed.task);
      state.deferredByKey.delete(completed.key);
      yield await completed.render();
    }
  } finally {
    options?.signal?.removeEventListener("abort", onAbort);
    state.completions.closed = true;
    state.completions.wake = null;
    state.completions.ready.clear();
    for (const deferred of state.deferredByKey.values()) deferred.targets.clear();
    state.tasks.clear();
    state.deferredByKey.clear();
  }
}
