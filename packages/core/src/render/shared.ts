import { normalizeClassName, type Child, type ClassName, type VNode } from "../jsx.js";
import { escapeHtml, isSafeAttribute, isSafeElementTagName } from "../security.js";

const VOID_ELEMENTS = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr"
]);

export function isVoidElement(tag: unknown): tag is string {
  return typeof tag === "string" && VOID_ELEMENTS.has(tag.toLowerCase());
}

export function normalizeElementTagName(tag: unknown, fallback = "div"): string {
  return typeof tag === "string" && isSafeElementTagName(tag) ? tag : fallback;
}

function escapeRawText(value: string, tag: string): string {
  if (tag === "script") {
    return value
      .replace(/</g, "\\u003c")
      .replace(/-->/g, "--\\u003e")
      .replace(/<\/script/gi, "<\\/script");
  }
  return tag === "style" ? value.replace(/<\/style/gi, "<\\/style") : value;
}

function toInlineStyle(style: unknown): string | null {
  if (typeof style === "string") return style;
  if (typeof style !== "object" || style === null) return null;
  const parts: string[] = [];
  for (const [key, raw] of Object.entries(style)) {
    if (raw === null || raw === undefined || raw === false) continue;
    const property = key.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
    parts.push(`${property}:${String(raw)}`);
  }
  return parts.length > 0 ? parts.join(";") : null;
}

export function renderAttributes(props: VNode["props"]): string {
  const attrs: string[] = [];
  const renderedClass = props.className ?? props.class;
  for (const [key, value] of Object.entries(props)) {
    const ignored = key === "children"
      || key === "key"
      || key === "ref"
      || key === "use"
      || key === "transition"
      || key.startsWith("on")
      || value === false
      || value === null
      || value === undefined
      || !isSafeAttribute(key, value);
    if (ignored) continue;
    if (key === "class") {
      if (props.className === undefined) attrs.push(`class="${escapeHtml(normalizeClassName(value as ClassName))}"`);
      continue;
    }
    if (key === "className") {
      attrs.push(`class="${escapeHtml(normalizeClassName(renderedClass as ClassName))}"`);
      continue;
    }
    if (key === "style") {
      const inlineStyle = toInlineStyle(value);
      if (inlineStyle) attrs.push(`style="${escapeHtml(inlineStyle)}"`);
      continue;
    }
    if (value === true) attrs.push(key);
    else attrs.push(`${key}="${escapeHtml(String(value))}"`);
  }
  return attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
}

export function renderRawTextChildren(
  node: Child,
  context: Map<symbol, unknown>,
  tag: string,
  renderChild: (node: Child, context: Map<symbol, unknown>) => string
): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") {
    return escapeRawText(String(node), tag);
  }
  if (Array.isArray(node)) {
    return node
      .map((item) => renderRawTextChildren(item, context, tag, renderChild))
      .join("");
  }
  return renderChild(node, context);
}
