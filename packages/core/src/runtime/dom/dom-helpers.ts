import {
  applyElementDirectives,
  transition,
  type ElementDirective,
  type ElementDirectiveInput
} from "../../elements/index.js";
import { isSafeElementTagName } from "../../security.js";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

function shouldCreateSvgElement(parent: Node, tag: string): boolean {
  if (tag === "svg") {
    return true;
  }
  if (typeof Element === "undefined" || !(parent instanceof Element)) {
    return false;
  }
  return parent.namespaceURI === SVG_NAMESPACE && parent.tagName.toLowerCase() !== "foreignobject";
}

export function createDomElement(parent: Node, tag: string): Element {
  if (!isSafeElementTagName(tag)) {
    return document.createElement("div");
  }
  return shouldCreateSvgElement(parent, tag)
    ? document.createElementNS(SVG_NAMESPACE, tag)
    : document.createElement(tag);
}

export function applyElementLifecycleDirectives(
  element: Element,
  props: Record<string, unknown>
) {
  if (typeof HTMLElement === "undefined" || !(element instanceof HTMLElement)) {
    return null;
  }
  const directives: Array<ElementDirective<HTMLElement> | null | undefined | false> = [];
  if (props.transition) {
    directives.push(transition(props.transition as never));
  }
  const use = props.use as ElementDirectiveInput<HTMLElement>;
  if (Array.isArray(use)) {
    directives.push(...use);
  } else {
    directives.push(use);
  }
  return applyElementDirectives(element, directives);
}
