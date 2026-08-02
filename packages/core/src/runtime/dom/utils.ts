import type { Child } from "../../jsx.js";

function isTextLike(node: Child): node is string | number {
  return typeof node === "string" || typeof node === "number";
}

function appendNormalizedChild(out: Child[], child: Child): void {
  if (child === null || child === undefined || child === false || child === true) {
    return;
  }

  const previous = out[out.length - 1];
  if (isTextLike(previous) && isTextLike(child)) {
    out[out.length - 1] = `${previous}${child}`;
    return;
  }
  out.push(child);
}

// Normalize nested/nullable children into a flat list consumed by the reconciler.
export function normalizeChildren(node: Child): Child[] {
  const out: Child[] = [];
  if (!Array.isArray(node)) {
    appendNormalizedChild(out, node);
    return out;
  }

  let children = node;
  let index = 0;
  let parentChildren: Child[][] | undefined;
  let parentIndexes: number[] | undefined;

  while (true) {
    if (index >= children.length) {
      if (!parentChildren || parentChildren.length === 0) {
        return out;
      }
      children = parentChildren.pop()!;
      index = parentIndexes!.pop()!;
      continue;
    }

    const child = children[index];
    index += 1;

    if (Array.isArray(child)) {
      if (child.length === 0) {
        continue;
      }
      parentChildren ??= [];
      parentIndexes ??= [];
      parentChildren.push(children);
      parentIndexes.push(index);
      children = child;
      index = 0;
      continue;
    }

    appendNormalizedChild(out, child);
  }
}

// Internal range anchors are empty text nodes so they are invisible in DevTools
// (unlike comment markers) but still give stable insertion boundaries.
export function createAnchor(): Text {
  return document.createTextNode("");
}
