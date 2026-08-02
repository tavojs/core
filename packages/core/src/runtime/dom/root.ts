import type { Child } from "../../jsx.js";
import { clearContainer, removeMounted } from "./cleanup.js";
import {
  reportHydrationMismatch,
  reportRuntimeError,
  shouldThrowHydrationMismatch,
  showConfiguredDevOverlay
} from "./diagnostics-core.js";
import { hydrateNode, mountNode, patchNode } from "./reconciler.js";
import { resetRuntimeIdCounter } from "./component-runtime.js";
import type { MountedNode, Root } from "./types.js";

// Public root API: render, hydrate, and unmount.
export function createRoot(container: Element | DocumentFragment): Root {
  let mounted: MountedNode | null = null;

  return {
    render(node: Child): void {
      try {
        if (!mounted) {
          clearContainer(container);
          resetRuntimeIdCounter();
          mounted = mountNode(container, null, node);
          return;
        }
        mounted = patchNode(container, mounted, node);
      } catch (error) {
        reportRuntimeError(error);
        showConfiguredDevOverlay(error);
      }
    },
    hydrate(node: Child): void {
      try {
        if (mounted) {
          mounted = patchNode(container, mounted, node);
          return;
        }

        resetRuntimeIdCounter();
        const hydrated = hydrateNode(container, container.firstChild, node, "root");
        mounted = hydrated.mounted;

        let cursor = hydrated.cursor;
        while (cursor) {
          reportHydrationMismatch({
            message: "Extra DOM node removed during hydration cleanup.",
            expected: "none",
            found:
              cursor.nodeType === Node.ELEMENT_NODE
                ? (cursor as HTMLElement).tagName.toLowerCase()
                : cursor.nodeType === Node.TEXT_NODE
                  ? "#text"
                  : `node:${cursor.nodeType}`,
            path: "root",
            pathSegments: ["root"],
            phase: "hydrate",
            kind: "extra-node",
            recovery: "cleanup"
          });
          const next = cursor.nextSibling;
          container.removeChild(cursor);
          cursor = next;
        }
      } catch (error) {
        reportRuntimeError(error);
        showConfiguredDevOverlay(error);
        if (shouldThrowHydrationMismatch()) {
          throw error;
        }
      }
    },
    unmount(): void {
      if (!mounted) {
        clearContainer(container);
        return;
      }

      removeMounted(container, mounted);
      mounted = null;
    }
  };
}

export function render(node: Child, container: Element | DocumentFragment): void {
  createRoot(container).render(node);
}

export type { Root } from "./types.js";
