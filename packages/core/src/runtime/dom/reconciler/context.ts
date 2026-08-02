import type { Child } from "../../../jsx.js";
import type { HydrateResult, MountedErrorBoundary, MountedNode, RenderContextMap } from "../types.js";

export type RenderEnv = {
  context: RenderContextMap;
  boundary: MountedErrorBoundary | null;
};

export const emptyEnv: RenderEnv = {
  context: new Map<symbol, unknown>(),
  boundary: null
};

export type ReconcilerOperations = {
  mountNode(parent: Node, before: Node | null, child: Child, env?: RenderEnv): MountedNode;
  patchNode(parent: Node, previous: MountedNode, nextChild: Child, env?: RenderEnv): MountedNode;
  hydrateNode(
    parent: Node,
    cursor: Node | null,
    child: Child,
    path?: string,
    pathSegments?: string[],
    trackDetails?: boolean,
    env?: RenderEnv
  ): HydrateResult;
  hydrateNodeProd(
    parent: Node,
    cursor: Node | null,
    child: Child,
    env?: RenderEnv
  ): HydrateResult;
};

export type MountOperations = Pick<ReconcilerOperations, "mountNode" | "patchNode">;
export type HydrationOperations = Pick<
  ReconcilerOperations,
  "mountNode" | "patchNode" | "hydrateNode" | "hydrateNodeProd"
>;
