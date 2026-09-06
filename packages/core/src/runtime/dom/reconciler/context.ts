import type { Child } from "../../../jsx.js";
import type { HydrateResult, MountedErrorBoundary, MountedNode, RenderContextMap } from "../types.js";

export type RenderEnv = {
  context: RenderContextMap;
  boundary: MountedErrorBoundary | null;
};

export type RootRenderScope = {
  begin(): boolean;
  end(owned: boolean): void;
  track(node: MountedNode): void;
  report(error: unknown): void;
};

const ROOT_RENDER_SCOPE = Symbol("tavo.root-render-scope");

export const emptyEnv: RenderEnv = {
  context: new Map<symbol, unknown>(),
  boundary: null
};

export function createRootRenderEnv(scope: RootRenderScope): RenderEnv {
  return {
    context: new Map<symbol, unknown>([[ROOT_RENDER_SCOPE, scope]]),
    boundary: null
  };
}

export function trackMountedNode<T extends MountedNode>(env: RenderEnv, node: T): T {
  const scope = env.context.get(ROOT_RENDER_SCOPE) as RootRenderScope | undefined;
  scope?.track(node);
  return node;
}

export function reportUnhandledRenderError(context: RenderContextMap, error: unknown): boolean {
  const scope = context.get(ROOT_RENDER_SCOPE) as RootRenderScope | undefined;
  if (!scope) {
    return false;
  }
  scope.report(error);
  return true;
}

export function beginRootRenderScope(context: RenderContextMap): (() => void) | null {
  const scope = context.get(ROOT_RENDER_SCOPE) as RootRenderScope | undefined;
  if (!scope) {
    return null;
  }
  const owned = scope.begin();
  return () => scope.end(owned);
}

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
  hydrateNodeProd(parent: Node, cursor: Node | null, child: Child, env?: RenderEnv): HydrateResult;
};

export type MountOperations = Pick<ReconcilerOperations, "mountNode" | "patchNode">;
export type HydrationOperations = Pick<
  ReconcilerOperations,
  "mountNode" | "patchNode" | "hydrateNode" | "hydrateNodeProd"
>;
