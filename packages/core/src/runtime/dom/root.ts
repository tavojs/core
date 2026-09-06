import type { Child } from "../../jsx.js";
import { clearContainer, cleanupMounted } from "./cleanup.js";
import {
  reportHydrationMismatch,
  reportRuntimeError,
  shouldThrowHydrationMismatch,
  showConfiguredDevOverlay
} from "./diagnostics-core.js";
import { hydrateNode, mountNode, patchNode } from "./reconciler.js";
import { resetRuntimeIdCounter } from "./component-runtime.js";
import { flushSync } from "./scheduler.js";
import { createRootRenderEnv, type RootRenderScope } from "./reconciler/context.js";
import type { CheckedRoot, MountedNode, RootOptions, RootRenderOutcome } from "./types.js";

const NO_COMMIT_ERROR = Symbol("tavo.no-commit-error");

type RenderTransaction = {
  error: unknown | typeof NO_COMMIT_ERROR;
  mounted: Set<MountedNode>;
};

const COMMIT_SUCCEEDED: RootRenderOutcome = Object.freeze({ ok: true });

function commitFailed(error: unknown): RootRenderOutcome {
  return Object.freeze({ ok: false, error });
}

/** Creates a browser root with observable checked render and hydration commits. */
export function createRoot(container: Element | DocumentFragment, options: RootOptions = {}): CheckedRoot {
  let mounted: MountedNode | null = null;
  let activeTransaction: RenderTransaction | null = null;
  let releasing = false;

  const notifyError = (error: unknown): void => {
    reportRuntimeError(error);
    showConfiguredDevOverlay(error);
    try {
      options.onError?.(error);
    } catch {
      // A root observer cannot replace or mask the original commit failure.
    }
  };

  const releaseRoot = (tracked?: Iterable<MountedNode>): void => {
    if (releasing) {
      return;
    }
    releasing = true;
    try {
      if (mounted) {
        cleanupMounted(mounted);
      }
      if (tracked) {
        const nodes = Array.from(tracked);
        for (let index = nodes.length - 1; index >= 0; index -= 1) {
          cleanupMounted(nodes[index]);
        }
      }
      mounted = null;
      clearContainer(container);
    } finally {
      releasing = false;
    }
  };

  const scope: RootRenderScope = {
    begin() {
      if (activeTransaction) {
        return false;
      }
      activeTransaction = {
        error: NO_COMMIT_ERROR,
        mounted: new Set<MountedNode>()
      };
      return true;
    },
    end(owned) {
      if (!owned || !activeTransaction) {
        return;
      }
      const transaction = activeTransaction;
      activeTransaction = null;
      if (transaction.error !== NO_COMMIT_ERROR) {
        releaseRoot(transaction.mounted);
      }
    },
    track(node) {
      activeTransaction?.mounted.add(node);
    },
    report(error) {
      if (activeTransaction) {
        if (activeTransaction.error === NO_COMMIT_ERROR) {
          activeTransaction.error = error;
          notifyError(error);
        }
        return;
      }
      notifyError(error);
      releaseRoot();
    }
  };
  const env = createRootRenderEnv(scope);

  const runCommit = (operation: () => MountedNode): RootRenderOutcome => {
    const transaction: RenderTransaction = {
      error: NO_COMMIT_ERROR,
      mounted: new Set<MountedNode>()
    };
    activeTransaction = transaction;
    let nextMounted: MountedNode | null = null;
    try {
      flushSync(() => {
        nextMounted = operation();
      });
    } catch (error) {
      scope.report(error);
    } finally {
      activeTransaction = null;
    }

    if (transaction.error !== NO_COMMIT_ERROR) {
      releaseRoot(transaction.mounted);
      return commitFailed(transaction.error);
    }

    mounted = nextMounted;
    return COMMIT_SUCCEEDED;
  };

  const renderChecked = (node: Child): RootRenderOutcome =>
    runCommit(() => {
      if (!mounted) {
        clearContainer(container);
        resetRuntimeIdCounter();
        return mountNode(container, null, node, env);
      }
      return patchNode(container, mounted, node, env);
    });

  const hydrateChecked = (node: Child): RootRenderOutcome =>
    runCommit(() => {
      if (mounted) {
        return patchNode(container, mounted, node, env);
      }

      resetRuntimeIdCounter();
      const hydrated = hydrateNode(container, container.firstChild, node, "root", ["root"], undefined, env);

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
      return hydrated.mounted;
    });

  return {
    render(node: Child): void {
      renderChecked(node);
    },
    renderChecked,
    hydrateChecked,
    hydrate(node: Child): void {
      const outcome = hydrateChecked(node);
      if (!outcome.ok && shouldThrowHydrationMismatch()) {
        throw outcome.error;
      }
    },
    unmount(): void {
      releaseRoot();
    }
  };
}

export function render(node: Child, container: Element | DocumentFragment): void {
  createRoot(container).render(node);
}

export type {
  CheckedRoot,
  Root,
  RootOptions,
  RootRenderFailure,
  RootRenderOutcome,
  RootRenderSuccess
} from "./types.js";
