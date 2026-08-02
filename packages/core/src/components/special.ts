import { h, type Child } from "../jsx.js";
import type {
  ContextProviderProps,
  ContextProviderVNode,
  DeferredProps,
  DeferredVNode,
  ErrorBoundaryProps,
  ErrorBoundaryVNode,
  TavoContext
} from "./types.js";

export const CONTEXT_PROVIDER = Symbol.for("tavo.context.provider");
export const ERROR_BOUNDARY = Symbol.for("tavo.error.boundary");
export const DEFERRED_BLOCK = Symbol.for("tavo.deferred.block");

export type {
  ContextProviderProps,
  ContextProviderVNode,
  DeferredProps,
  DeferredVNode,
  ErrorBoundaryFallback,
  ErrorBoundaryProps,
  ErrorBoundaryVNode,
  TavoContext
} from "./types.js";

/** Creates the internal provider vnode used by Tavo context. */
export function createProviderNode<T>(
  context: TavoContext<T>,
  props: ContextProviderProps<T>
): ContextProviderVNode {
  return h(CONTEXT_PROVIDER, {
    context: context as TavoContext<unknown>,
    value: props.value,
    children: props.children
  }) as ContextProviderVNode;
}

/** Creates the internal error boundary vnode used by the renderer. */
export function createErrorBoundaryNode(props: ErrorBoundaryProps): ErrorBoundaryVNode {
  return h(ERROR_BOUNDARY, {
    fallback: props.fallback,
    resetKey: props.resetKey,
    children: props.children as Child
  }) as ErrorBoundaryVNode;
}

/** Creates the internal deferred vnode used by progressive SSR streaming. */
export function createDeferredNode<T>(props: DeferredProps<T>): DeferredVNode {
  return h(DEFERRED_BLOCK, {
    value: props.value as Promise<unknown> | unknown,
    fallback: props.fallback,
    children: props.children as Child,
    id: props.id,
    as: props.as,
    errorFallback: props.errorFallback,
    timeoutMs: props.timeoutMs,
    timeoutFallback: props.timeoutFallback,
    serialize: props.serialize as ((value: unknown) => unknown) | undefined,
    deserialize: props.deserialize as ((value: unknown) => unknown) | undefined
  }) as DeferredVNode;
}
