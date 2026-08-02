import { Fragment, type Child } from "../../jsx.js";
import { CONTEXT_PROVIDER, ERROR_BOUNDARY } from "../../components/index.js";
import { normalizeChildren } from "./utils.js";

export function childToArray(node: Child): Child {
  if (Array.isArray(node)) {
    return normalizeChildren(node);
  }
  return node;
}

export function normalizeChildrenFast(node: Child): Child[] {
  if (Array.isArray(node)) {
    return normalizeChildren(node);
  }
  if (isEmptyChildValue(node)) {
    return [];
  }
  return [node];
}

export function getChildKey(child: Child): string | number | null {
  if (
    child !== null &&
    child !== undefined &&
    child !== false &&
    child !== true &&
    !Array.isArray(child) &&
    typeof child !== "string" &&
    typeof child !== "number"
  ) {
    const key = child.props.key;
    if (typeof key === "string" || typeof key === "number") {
      return key;
    }
  }
  return null;
}

export function hasAnyKey(children: Child[]): boolean {
  return children.some((child) => getChildKey(child) !== null);
}

export function assertStrictKeys(children: Child[]): void {
  for (let index = 0; index < children.length; index += 1) {
    if (getChildKey(children[index]) === null) {
      throw new Error(
        `tavo strict keyed mode: missing key at child index ${index}. ` +
          `All children must have stable keys when keyedStrategy="strict".`
      );
    }
  }
}

export function childKindLabel(child: Child): string {
  if (child === null || child === undefined || child === false || child === true) {
    return "empty";
  }
  if (typeof child === "string" || typeof child === "number") {
    return "text";
  }
  if (Array.isArray(child)) {
    return "array";
  }
  if (typeof child.type === "function") {
    return "component";
  }
  if (child.type === Fragment) {
    return "fragment";
  }
  if (child.type === CONTEXT_PROVIDER) {
    return "context-provider";
  }
  if (child.type === ERROR_BOUNDARY) {
    return "error-boundary";
  }
  return `element:${String(child.type)}`;
}

export function isEmptyChildValue(child: Child | undefined): boolean {
  return child === undefined || child === null || child === false || child === true;
}

export function propsShallowEqual(
  left: Record<string, unknown> | null | undefined,
  right: Record<string, unknown> | null | undefined
): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (const key of leftKeys) {
    if (!Object.prototype.hasOwnProperty.call(right, key)) {
      return false;
    }
    if (!Object.is(left[key], right[key])) {
      return false;
    }
  }
  return true;
}
