type TavoIntrinsicElementProps<TElement extends Element = Element> = Record<string, unknown> & {
  className?: import("./jsx.js").ClassName;
  ref?: import("./refs/index.js").DomRef<TElement>;
  use?: import("./elements/index.js").ElementDirectiveInput<TElement extends HTMLElement ? TElement : HTMLElement>;
  transition?: import("./elements/index.js").TransitionOptions<TElement extends HTMLElement ? TElement : HTMLElement>;
};

type TavoIntrinsicElements = {
  [K in keyof HTMLElementTagNameMap]: TavoIntrinsicElementProps<HTMLElementTagNameMap[K]>;
} & {
  [elementName: string]: Record<string, unknown>;
};

declare namespace JSX {
  type Element = import("./jsx.js").Child;

  interface ElementChildrenAttribute {
    children: {};
  }

  interface IntrinsicElements extends TavoIntrinsicElements {}
}

declare module "*.module.css" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

declare module "*.module.scss" {
  const classes: Readonly<Record<string, string>>;
  export default classes;
}

declare module "*.css";

declare module "*.scss";


declare module "*.svg?component" {
  const Component: import("./jsx.js").Component<Record<string, unknown>>;
  export default Component;
}
