export const Fragment = Symbol("Fragment");

export type Primitive = string | number | boolean | null | undefined;
export type Child = Primitive | VNode | Child[];
export type ClassName = string | string[];

export function normalizeClassName(value: ClassName): string {
  return Array.isArray(value) ? value.join(" ") : value;
}

export type Props = Record<string, unknown> & {
  children?: Child;
};

export type PropsWithChildren<P extends Record<string, unknown> = Record<string, unknown>> = P & {
  children?: Child;
};

export type ComponentProps<P extends Record<string, unknown> = Props> = (props: PropsWithChildren<P>) => Child;
export type Component<P extends Record<string, unknown> = Props> = ComponentProps<P>;
export type InternalType = symbol;
export type NodeType = string | InternalType | typeof Fragment | Component;

export type VNode = {
  type: NodeType;
  props: {
    children: Child[];
    [key: string]: unknown;
  };
};

function flattenChildren(input: Child): Child[] {
  const out: Child[] = [];

  if (!Array.isArray(input)) {
    if (input !== undefined && input !== null && input !== false) {
      out.push(input);
    }
    return out;
  }

  let children = input;
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

    if (child === undefined || child === null || child === false) {
      continue;
    }
    out.push(child);
  }
}

export function h(
  type: NodeType,
  props: Props | null,
  ...children: Child[]
): VNode {
  const propChildren = props?.children;
  const normalizedChildren = flattenChildren(
    children.length > 0 ? children : propChildren
  );

  if (props == null) {
    return {
      type,
      props: {
        children: normalizedChildren
      }
    };
  }

  const { children: _ignoredChildren, ...normalizedProps } = props;
  normalizedProps.children = normalizedChildren;

  return {
    type,
    props: normalizedProps as VNode["props"]
  };
}
