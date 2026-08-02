import {
  createErrorBoundaryNode,
  type ErrorBoundaryProps,
  type ErrorBoundaryVNode
} from "./special.js";

export type { ErrorBoundaryProps } from "./types.js";

/** Creates an error boundary vnode that captures descendant render errors. */
export function ErrorBoundary(props: ErrorBoundaryProps): ErrorBoundaryVNode {
  return createErrorBoundaryNode(props);
}
