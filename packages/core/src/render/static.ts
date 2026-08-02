import { CONTEXT_PROVIDER, DEFERRED_BLOCK, ERROR_BOUNDARY } from "../components/index.js";
import { Fragment, type Child, type VNode } from "../jsx.js";
import {
  resetRuntimeIdCounter,
  withServerRenderComponent
} from "../runtime/dom/component-runtime.js";
import { escapeHtml } from "../security.js";
import {
  isVoidElement,
  normalizeElementTagName,
  renderAttributes,
  renderRawTextChildren
} from "./shared.js";

export function renderToStringWithContext(
  node: Child,
  context: Map<symbol, unknown>
): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") {
    return escapeHtml(String(node));
  }
  if (Array.isArray(node)) {
    return node.map((item) => renderToStringWithContext(item, context)).join("");
  }
  if (typeof node.type === "function") {
    const component = node.type as (props: VNode["props"]) => Child;
    return withServerRenderComponent(() => (
      renderToStringWithContext(component(node.props), context)
    ));
  }
  if (node.type === CONTEXT_PROVIDER) {
    const nextContext = new Map(context);
    const contextRef = node.props.context as { id: symbol };
    nextContext.set(contextRef.id, node.props.value);
    return renderToStringWithContext(node.props.children, nextContext);
  }
  if (node.type === ERROR_BOUNDARY) {
    try {
      return renderToStringWithContext(node.props.children, context);
    } catch (error) {
      const fallback = node.props.fallback;
      const rendered = typeof fallback === "function"
        ? (fallback as (value: unknown) => Child)(error)
        : fallback as Child;
      return renderToStringWithContext(rendered, context);
    }
  }
  if (node.type === DEFERRED_BLOCK) {
    const value = node.props.value;
    const isPromise = typeof value === "object"
      && value !== null
      && typeof (value as Promise<unknown>).then === "function";
    if (isPromise) {
      const tag = normalizeElementTagName(node.props.as);
      const id = typeof node.props.id === "string" ? node.props.id : undefined;
      const inner = renderToStringWithContext(
        (node.props.fallback ?? null) as Child,
        context
      );
      const attrs = id
        ? ` id="${escapeHtml(id)}" data-tavo-deferred="pending"`
        : " data-tavo-deferred=\"pending\"";
      return `<${tag}${attrs}>${inner}</${tag}>`;
    }
    const child = node.props.children[0];
    const rendered = typeof child === "function"
      ? (child as (value: unknown) => Child)(value)
      : child;
    return renderToStringWithContext(rendered as Child, context);
  }
  if (node.type === Fragment || typeof node.type === "symbol") {
    return node.props.children
      .map((item) => renderToStringWithContext(item, context))
      .join("");
  }

  const attrs = renderAttributes(node.props);
  const tag = normalizeElementTagName(node.type);
  if (isVoidElement(tag)) return `<${tag}${attrs}>`;
  const content = tag === "script" || tag === "style"
    ? node.props.children
        .map((item) => renderRawTextChildren(
          item,
          context,
          tag,
          renderToStringWithContext
        ))
        .join("")
    : node.props.children
        .map((item) => renderToStringWithContext(item, context))
        .join("");
  return `<${tag}${attrs}>${content}</${tag}>`;
}

export function renderToString(node: Child): string {
  resetRuntimeIdCounter();
  return renderToStringWithContext(node, new Map<symbol, unknown>());
}
