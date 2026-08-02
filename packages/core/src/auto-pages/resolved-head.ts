import type { PagesRuntimeResolved } from "../framework/types.js";

let resolvedHeadDocument: Document | null = null;
let resolvedHeadNodes: Node[] = [];
let resolvedHeadBaselineTitle = "";

function resetResolvedHeadState(): void {
  if (resolvedHeadDocument === document) {
    return;
  }
  resolvedHeadDocument = document;
  resolvedHeadNodes = [];
  resolvedHeadBaselineTitle =
    document.documentElement.getAttribute("data-tavo-title-fallback")
    ?? document.title;
}

function findEquivalentHeadNode(
  candidate: Node,
  claimed: Set<Node>,
): Node | null {
  const key = candidate.nodeType === 1
    ? (candidate as Element).getAttribute("data-tavo-head")
    : null;
  for (const existing of Array.from(document.head.childNodes)) {
    if (claimed.has(existing)) {
      continue;
    }
    if (
      key
      && existing.nodeType === 1
      && (existing as Element).getAttribute("data-tavo-head") === key
    ) {
      return existing;
    }
    if (!key && existing.isEqualNode(candidate)) {
      return existing;
    }
  }
  return null;
}

/** Applies document head updates derived from resolved page metadata. */
export function applyResolvedHead(resolved: PagesRuntimeResolved): void {
  if (typeof document === "undefined") {
    return;
  }
  resetResolvedHeadState();
  document.title = resolved.head.title ?? resolvedHeadBaselineTitle;

  for (const node of resolvedHeadNodes) {
    node.parentNode?.removeChild(node);
  }
  resolvedHeadNodes = [];

  const html = resolved.head.unsafeHeadHtml;
  if (!html?.trim()) {
    return;
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  const claimed = new Set<Node>();
  for (const candidate of Array.from(template.content.childNodes)) {
    const existing = findEquivalentHeadNode(candidate, claimed);
    if (existing?.isEqualNode(candidate)) {
      claimed.add(existing);
      resolvedHeadNodes.push(existing);
      continue;
    }
    existing?.parentNode?.removeChild(existing);
    document.head.appendChild(candidate);
    resolvedHeadNodes.push(candidate);
  }
}
