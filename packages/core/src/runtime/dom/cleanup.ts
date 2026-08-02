import type { MountedNode } from "./types.js";
import { cleanupComponentRuntime } from "./component-runtime.js";
import { cancelScheduledComponent } from "./scheduler.js";
import { clearDomRef } from "../../refs/index.js";

function removeNodeRange(parent: Node, start: Node, end: Node): void {
  let current: Node | null = start;
  while (current) {
    const nextSibling: Node | null = current.nextSibling;
    parent.removeChild(current);
    if (current === end) {
      break;
    }
    current = nextSibling;
  }
}

export function clearContainer(container: Element | DocumentFragment): void {
  container.replaceChildren();
}

export function cleanupMounted(node: MountedNode): void {
  if (node.kind === "component") {
    node.unmounted = true;
    for (const dep of node.dependencies) {
      dep.unsubscribe();
    }
    node.dependencies = [];
    cancelScheduledComponent(node);
    cleanupComponentRuntime(node);
    if (node.child) {
      cleanupMounted(node.child);
    }
    return;
  }

  if (node.kind === "provider" || node.kind === "error-boundary") {
    if (node.child) {
      cleanupMounted(node.child);
    }
    return;
  }

  if (node.kind === "fragment") {
    for (const child of node.children) {
      cleanupMounted(child);
    }
    return;
  }

  if (node.kind === "element") {
    for (const child of node.children) {
      cleanupMounted(child);
    }
    node.directivesCleanup?.();
    node.directivesCleanup = null;
    clearDomRef(node.props.ref);
  }
}

export function removeMounted(parent: Node, mounted: MountedNode): void {
  cleanupMounted(mounted);
  removeNodeRange(parent, mounted.start, mounted.end);
}
