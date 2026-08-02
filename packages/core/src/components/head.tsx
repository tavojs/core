import type { Child } from "../jsx.js";
import { renderToString } from "../render/static.js";
import { createTavo, TavoController } from "../framework/mvc.js";
import type { HeadProps } from "./types.js";

export type { HeadProps } from "./types.js";

function managedHeadKey(node: Node): string | null {
  return node.nodeType === 1
    ? (node as Element).getAttribute("data-tavo-head")
    : null;
}

function findManagedHeadNode(key: string): Element | null {
  for (const node of Array.from(document.head.children)) {
    if (node.getAttribute("data-tavo-head") === key) return node;
  }
  return null;
}

/** Client-side document head helper for apps that prefer component-style metadata updates. */
class HeadController extends TavoController {
  declare props: HeadProps;

  private applyHead() {
    if (typeof document === "undefined") {
      return;
    }

    const previousTitle = document.title;
    if (this.props.title !== undefined) {
      document.title = this.props.title;
    }

    const rawHtml = this.props.unsafeHeadHtml ?? "";
    const html = `${rawHtml}${this.props.children ? renderToString(this.props.children as Child) : ""}`;
    const inserted: Node[] = [];
    if (html.trim().length > 0) {
      const template = document.createElement("template");
      template.innerHTML = html;
      for (const node of Array.from(template.content.childNodes)) {
        const key = managedHeadKey(node);
        if (key) findManagedHeadNode(key)?.remove();
        document.head.appendChild(node);
        inserted.push(node);
      }
    }

    return () => {
      if (this.props.title !== undefined) {
        document.title = previousTitle;
      }
      for (const node of inserted) {
        node.parentNode?.removeChild(node);
      }
    };
  }

  onLayout() {
    return this.applyHead();
  }
}

export const Head = createTavo<HeadProps, Record<string, never>, HeadController>({
  model: () => ({}),
  controller: HeadController,
  view: () => null
});
