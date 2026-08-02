import { Fragment, type Child, type Component, type VNode } from "../../jsx.js";
import { withoutDependencyCollector } from "../../reactivity.js";
import {
  CONTEXT_PROVIDER,
  ERROR_BOUNDARY,
  type ErrorBoundaryFallback
} from "../../components/index.js";
import { removeMounted } from "./cleanup.js";
import {
  emitTrace,
  shouldEmitTrace,
  shouldTrackHydrationDetails
} from "./diagnostics-core.js";
import { patchProps } from "./props.js";
import { assignDomRef, clearDomRef } from "../../refs/index.js";
import type {
  HydrateResult,
  MountedComponent,
  MountedErrorBoundary,
  MountedFragment,
  MountedNode,
  MountedProvider,
  RootDependencySubscription
} from "./types.js";
import { createAnchor, normalizeChildren } from "./utils.js";
import {
  childKindLabel,
  childToArray,
  getChildKey,
  isEmptyChildValue,
  normalizeChildrenFast,
  propsShallowEqual
} from "./child-utils.js";
import { applyElementLifecycleDirectives, createDomElement } from "./dom-helpers.js";
import { reconcileChildList as reconcileChildListWithOperations } from "./reconciler/children.js";
import { emptyEnv, type RenderEnv, type ReconcilerOperations } from "./reconciler/context.js";
import {
  mountComponent as mountComponentWithOperations,
  mountErrorBoundary as mountErrorBoundaryWithOperations,
  mountFragment as mountFragmentWithOperations,
  mountProvider as mountProviderWithOperations
} from "./reconciler/mount-nodes.js";
import { hydrateNodeProd as hydrateNodeProdWithOperations } from "./reconciler/hydration/prod.js";
import { hydrateNodeDetailed } from "./reconciler/hydration/detailed.js";

function replaceMounted(
  parent: Node,
  previous: MountedNode,
  nextChild: Child,
  env: RenderEnv
): MountedNode {
  const before = previous.end.nextSibling;
  removeMounted(parent, previous);
  const mounted = mountNode(parent, before, nextChild, env);
  return mounted;
}

const reconcilerOperations: ReconcilerOperations = {
  mountNode,
  patchNode,
  hydrateNode,
  hydrateNodeProd
};

function reconcileChildList(
  parent: Node,
  previous: MountedNode[],
  nextChildren: Child[],
  before: Node | null,
  env: RenderEnv
): MountedNode[] {
  return reconcileChildListWithOperations(
    parent,
    previous,
    nextChildren,
    before,
    env,
    reconcilerOperations
  );
}

function mountFragment(
  parent: Node,
  before: Node | null,
  children: Child[],
  key: string | number | null,
  env: RenderEnv
): MountedFragment {
  return mountFragmentWithOperations(parent, before, children, key, env, reconcilerOperations);
}

function mountProvider(
  parent: Node,
  before: Node | null,
  node: VNode,
  key: string | number | null,
  env: RenderEnv
): MountedProvider {
  return mountProviderWithOperations(parent, before, node, key, env, reconcilerOperations);
}

function mountErrorBoundary(
  parent: Node,
  before: Node | null,
  node: VNode,
  key: string | number | null,
  env: RenderEnv
): MountedErrorBoundary {
  return mountErrorBoundaryWithOperations(parent, before, node, key, env, reconcilerOperations);
}

function mountComponent(
  parent: Node,
  before: Node | null,
  type: Component,
  props: Record<string, unknown>,
  key: string | number | null,
  env: RenderEnv
): MountedComponent {
  return mountComponentWithOperations(parent, before, type, props, key, env, reconcilerOperations);
}

function hydrateNodeProd(
  parent: Node,
  cursor: Node | null,
  child: Child,
  env: RenderEnv = emptyEnv
): HydrateResult {
  return hydrateNodeProdWithOperations(parent, cursor, child, env, reconcilerOperations);
}

export function mountNode(
  parent: Node,
  before: Node | null,
  child: Child,
  env: RenderEnv = emptyEnv
): MountedNode {
  if (shouldEmitTrace()) {
    emitTrace({ phase: "mount", kind: childKindLabel(child), key: getChildKey(child) });
  }

  if (child === null || child === undefined || child === false || child === true) {
    const marker = createAnchor();
    parent.insertBefore(marker, before);
    return {
      kind: "empty",
      key: null,
      start: marker,
      end: marker
    };
  }

  if (typeof child === "string" || typeof child === "number") {
    const text = document.createTextNode(String(child));
    parent.insertBefore(text, before);
    return {
      kind: "text",
      key: null,
      start: text,
      end: text,
      node: text,
      value: String(child)
    };
  }

  if (Array.isArray(child)) {
    return mountFragment(parent, before, normalizeChildren(child), null, env);
  }

  const key = getChildKey(child);

  if (typeof child.type === "function") {
    const componentNode = child as VNode & { type: Component };
    return withoutDependencyCollector(() =>
      mountComponent(parent, before, componentNode.type, componentNode.props, key, env)
    );
  }

  if (child.type === CONTEXT_PROVIDER) {
    return mountProvider(parent, before, child, key, env);
  }

  if (child.type === ERROR_BOUNDARY) {
    return mountErrorBoundary(parent, before, child, key, env);
  }

  if (child.type === Fragment) {
    return mountFragment(parent, before, normalizeChildren(child.props.children), key, env);
  }

  const element = createDomElement(parent, child.type as string);
  parent.insertBefore(element, before);
  patchProps(element, {}, child.props);

  const children = normalizeChildren(child.props.children);
  const mountedChildren = reconcileChildList(element, [], children, null, env);
  assignDomRef(child.props.ref, element);
  const directivesCleanup = applyElementLifecycleDirectives(element, child.props);

  return {
    kind: "element",
    key,
    start: element,
    end: element,
    node: element,
    tag: child.type as string,
    props: child.props,
    children: mountedChildren,
    directivesCleanup
  };
}

export function patchNode(
  parent: Node,
  previous: MountedNode,
  nextChild: Child,
  env: RenderEnv = emptyEnv
): MountedNode {
  if (shouldEmitTrace()) {
    emitTrace({ phase: "patch", kind: childKindLabel(nextChild), key: getChildKey(nextChild) });
  }

  if (nextChild === null || nextChild === undefined || nextChild === false || nextChild === true) {
    if (previous.kind === "empty") {
      previous.key = null;
      return previous;
    }
    return replaceMounted(parent, previous, null, env);
  }

  if (typeof nextChild === "string" || typeof nextChild === "number") {
    const nextText = String(nextChild);
    if (previous.kind === "text") {
      if (previous.value !== nextText) {
        previous.node.textContent = nextText;
        previous.value = nextText;
      }
      previous.key = null;
      return previous;
    }
    return replaceMounted(parent, previous, nextText, env);
  }

  if (Array.isArray(nextChild)) {
    const normalized = normalizeChildren(nextChild);
    if (previous.kind !== "fragment") {
      return replaceMounted(parent, previous, normalized, env);
    }

    previous.children = reconcileChildList(parent, previous.children, normalized, previous.end, env);
    previous.key = null;
    return previous;
  }

  const key = getChildKey(nextChild);

  if (typeof nextChild.type === "function") {
    if (previous.kind !== "component" || previous.type !== nextChild.type) {
      return replaceMounted(parent, previous, nextChild, env);
    }
    previous.key = key;
    const nextProps = nextChild.props;
    const shouldRerender =
      !propsShallowEqual(previous.props as Record<string, unknown>, nextProps as Record<string, unknown>) ||
      previous.context !== env.context ||
      previous.boundary !== env.boundary;
    previous.props = nextProps;
    previous.context = env.context;
    previous.boundary = env.boundary;
    if (!shouldRerender) {
      return previous;
    }
    previous.rerender();
    return previous;
  }

  if (nextChild.type === CONTEXT_PROVIDER) {
    if (previous.kind !== "provider" || previous.contextRef !== nextChild.props.context) {
      return replaceMounted(parent, previous, nextChild, env);
    }

    previous.key = key;
    previous.value = nextChild.props.value;
    const nextContext = new Map(env.context);
    nextContext.set(previous.contextRef.id, previous.value);
    previous.context = nextContext;
    previous.boundary = env.boundary;

    const rendered = childToArray(nextChild.props.children ?? []);
    if (previous.child) {
      previous.child = patchNode(parent, previous.child, rendered, {
        context: previous.context,
        boundary: previous.boundary
      });
    } else {
      previous.child = mountNode(parent, previous.end, rendered, {
        context: previous.context,
        boundary: previous.boundary
      });
    }
    return previous;
  }

  if (nextChild.type === ERROR_BOUNDARY) {
    if (previous.kind !== "error-boundary") {
      return replaceMounted(parent, previous, nextChild, env);
    }
    const previousResetKey = previous.resetKey;
    previous.key = key;
    previous.fallback = nextChild.props.fallback as ErrorBoundaryFallback;
    previous.resetKey = nextChild.props.resetKey;
    previous.children = childToArray(nextChild.props.children ?? []);
    previous.context = env.context;
    previous.parentBoundary = env.boundary;
    if (previous.error !== null && !Object.is(previousResetKey, previous.resetKey)) {
      previous.error = null;
    }
    previous.renderBoundary();
    return previous;
  }

  if (nextChild.type === Fragment) {
    if (previous.kind !== "fragment") {
      return replaceMounted(parent, previous, normalizeChildrenFast(nextChild.props.children), env);
    }
    previous.children = reconcileChildList(
      parent,
      previous.children,
      normalizeChildrenFast(nextChild.props.children),
      previous.end,
      env
    );
    previous.key = key;
    return previous;
  }

  if (previous.kind !== "element" || previous.tag !== nextChild.type) {
    return replaceMounted(parent, previous, nextChild, env);
  }

  const nextProps = nextChild.props;
  const previousProps = previous.props;
  const nextChildren = nextProps.children;
  const childrenChanged = previousProps.children !== nextChildren;

  if (previousProps !== nextProps) {
    patchProps(previous.node, previousProps, nextProps);
    if (previousProps.ref !== nextProps.ref) {
      clearDomRef(previousProps.ref);
      assignDomRef(nextProps.ref, previous.node);
    }
    if (previousProps.use !== nextProps.use || previousProps.transition !== nextProps.transition) {
      previous.directivesCleanup?.();
      previous.directivesCleanup = applyElementLifecycleDirectives(previous.node, nextProps);
    }
    previous.props = nextProps;
  }
  previous.key = key;

  if (childrenChanged) {
    if (isEmptyChildValue(nextChildren)) {
      if (previous.children.length > 0) {
        previous.children = reconcileChildList(previous.node, previous.children, [], null, env);
      }
    } else if (
      (typeof nextChildren === "string" || typeof nextChildren === "number") &&
      previous.children.length === 1 &&
      previous.children[0]?.kind === "text"
    ) {
      previous.children = reconcileChildList(previous.node, previous.children, [nextChildren], null, env);
    } else {
      previous.children = reconcileChildList(
        previous.node,
        previous.children,
        normalizeChildrenFast(nextChildren),
        null,
        env
      );
    }
  }

  return previous;
}

export function hydrateNode(
  parent: Node,
  cursor: Node | null,
  child: Child,
  path: string | undefined = undefined,
  pathSegments: string[] | undefined = undefined,
  trackDetails = shouldTrackHydrationDetails(),
  env: RenderEnv = emptyEnv
): HydrateResult {
  if (!trackDetails && !shouldEmitTrace()) {
    return hydrateNodeProd(parent, cursor, child, env);
  }

  const hydrationPath = trackDetails ? (path ?? "root") : undefined;
  const hydrationSegments = trackDetails ? (pathSegments ?? ["root"]) : undefined;

  if (shouldEmitTrace()) {
    emitTrace({
      phase: "hydrate",
      kind: childKindLabel(child),
      key: getChildKey(child),
      detail: hydrationPath
    });
  }

  return hydrateNodeDetailed(
    parent,
    cursor,
    child,
    hydrationPath,
    hydrationSegments,
    trackDetails,
    env,
    reconcilerOperations
  );
}
