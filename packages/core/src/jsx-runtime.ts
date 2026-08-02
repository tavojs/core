import {
  Fragment,
  h,
  type Child,
  type ClassName,
  type NodeType,
  type Props,
  type VNode
} from "./jsx.js";
import type { ElementDirectiveInput, TransitionOptions } from "./elements/index.js";
import type { DomRef } from "./refs/index.js";

type ElementType = NodeType;

export { Fragment };

export function jsx(type: ElementType, props: Props, key?: string | number): VNode {
  if (key !== undefined && props.key === undefined) {
    return h(type, { ...props, key });
  }
  return h(type, props);
}

export const jsxs = jsx;
export const jsxDEV = jsx;

export namespace JSX {
  export type Element = Child;
  export type IntrinsicElementProps<TElement extends globalThis.Element = globalThis.Element> =
    Record<string, unknown> & {
      className?: ClassName;
      ref?: DomRef<TElement>;
      use?: ElementDirectiveInput<TElement extends HTMLElement ? TElement : HTMLElement>;
      transition?: TransitionOptions<TElement extends HTMLElement ? TElement : HTMLElement>;
    };

  export type TavoIntrinsicElements = {
    [K in keyof HTMLElementTagNameMap]: IntrinsicElementProps<HTMLElementTagNameMap[K]>;
  } & {
    [elementName: string]: Record<string, unknown>;
  };

  export interface ElementChildrenAttribute {
    children: {};
  }

  export interface IntrinsicElements extends TavoIntrinsicElements {}
}
