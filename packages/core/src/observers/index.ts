import type { DomRefObject } from "../refs/index.js";
import type { Unsubscribe } from "../store/index.js";

export type ElementTarget<T extends Element = Element> = T | DomRefObject<T>;

function resolveTarget<T extends Element>(target: ElementTarget<T>): T | null {
  return "current" in target ? target.current : target;
}

/** Observes element size changes and returns an unsubscribe function. */
export function observeResize<T extends Element>(
  target: ElementTarget<T>,
  listener: ResizeObserverCallback,
  options?: ResizeObserverOptions
): Unsubscribe {
  const element = resolveTarget(target);
  if (!element || typeof ResizeObserver === "undefined") {
    return () => {};
  }
  const observer = new ResizeObserver(listener);
  observer.observe(element, options);
  return () => observer.disconnect();
}

/** Observes element viewport intersection changes and returns an unsubscribe function. */
export function observeIntersection<T extends Element>(
  target: ElementTarget<T>,
  listener: IntersectionObserverCallback,
  options?: IntersectionObserverInit
): Unsubscribe {
  const element = resolveTarget(target);
  if (!element || typeof IntersectionObserver === "undefined") {
    return () => {};
  }
  const observer = new IntersectionObserver(listener, options);
  observer.observe(element);
  return () => observer.disconnect();
}

/** Observes DOM mutations and returns an unsubscribe function. */
export function observeMutation<T extends Node>(
  target: T | { current: T | null },
  listener: MutationCallback,
  options: MutationObserverInit = { childList: true, subtree: true }
): Unsubscribe {
  const node = "current" in target ? target.current : target;
  if (!node || typeof MutationObserver === "undefined") {
    return () => {};
  }
  const observer = new MutationObserver(listener);
  observer.observe(node, options);
  return () => observer.disconnect();
}
