import { Fragment, type Child, type Component, type VNode } from "../../../../jsx.js";
import {
  withDependencyCollector,
  withoutDependencyCollector,
  type StoreDependency
} from "../../../../reactivity.js";
import {
  CONTEXT_PROVIDER,
  ERROR_BOUNDARY,
  type ErrorBoundaryFallback,
  type TavoContext
} from "../../../../components/index.js";
import {
  createComponentRuntimeState,
  runLayoutTasks,
  schedulePassiveTasks,
  withActiveComponent
} from "../../component-runtime.js";
import { getDependencyKey, reconcileDependencies } from "../../dependencies.js";
import {
  reportHydrationMismatch
} from "../../diagnostics-core.js";
import { hydrateProps } from "../../props.js";
import { scheduleComponent } from "../../scheduler.js";
import { assignDomRef } from "../../../../refs/index.js";
import {
  childKindLabel,
  childToArray,
  getChildKey,
  isEmptyChildValue,
  normalizeChildrenFast
} from "../../child-utils.js";
import { applyElementLifecycleDirectives } from "../../dom-helpers.js";
import { extendHydrationPath } from "../../hydration-path.js";
import { createAnchor } from "../../utils.js";
import {
  initializeBoundaryRuntime,
  runComponentRender
} from "../mount-nodes.js";
import type {
  HydrateResult,
  MountedComponent,
  MountedErrorBoundary,
  MountedNode,
  RootDependencySubscription
} from "../../types.js";
import type { HydrationOperations, RenderEnv } from "../context.js";

function hydrateFragment(
  parent: Node,
  cursor: Node | null,
  children: Child[],
  key: string | number | null,
  path: string | undefined,
  pathSegments: string[] | undefined,
  trackDetails: boolean,
  env: RenderEnv,
  operations: HydrationOperations
): HydrateResult {
  const start = createAnchor();
  parent.insertBefore(start, cursor);

  let nextCursor = cursor;
  const mountedChildren: MountedNode[] = [];
  for (let index = 0; index < children.length; index += 1) {
    const nextPath = extendHydrationPath(path, pathSegments, trackDetails, `[${index}]`);
    const hydrated = operations.hydrateNode(
      parent,
      nextCursor,
      children[index],
      nextPath.path,
      nextPath.pathSegments,
      trackDetails,
      env
    );
    mountedChildren.push(hydrated.mounted);
    nextCursor = hydrated.cursor;
  }

  const end = createAnchor();
  parent.insertBefore(end, nextCursor);

  return {
    mounted: {
      kind: "fragment",
      key,
      start,
      end,
      children: mountedChildren
    },
    cursor: nextCursor
  };
}

function hydrateProvider(
  parent: Node,
  cursor: Node | null,
  node: VNode,
  key: string | number | null,
  path: string | undefined,
  pathSegments: string[] | undefined,
  trackDetails: boolean,
  env: RenderEnv,
  operations: HydrationOperations
): HydrateResult {
  const start = createAnchor();
  parent.insertBefore(start, cursor);

  const contextRef = node.props.context as TavoContext<unknown>;
  const value = node.props.value;
  const providerContext = new Map(env.context);
  providerContext.set(contextRef.id as symbol, value);

  const rendered = childToArray(node.props.children ?? []);
  const childPath = extendHydrationPath(path, pathSegments, trackDetails, "/provider");
  const hydratedChild = operations.hydrateNode(
    parent,
    cursor,
    rendered,
    childPath.path,
    childPath.pathSegments,
    trackDetails,
    {
      context: providerContext,
      boundary: env.boundary
    }
  );

  const end = createAnchor();
  parent.insertBefore(end, hydratedChild.cursor);

  return {
    mounted: {
      kind: "provider",
      key,
      start,
      end,
      contextRef,
      value,
      child: hydratedChild.mounted,
      context: providerContext,
      boundary: env.boundary
    },
    cursor: hydratedChild.cursor
  };
}

function hydrateErrorBoundary(
  parent: Node,
  cursor: Node | null,
  node: VNode,
  key: string | number | null,
  path: string | undefined,
  pathSegments: string[] | undefined,
  trackDetails: boolean,
  env: RenderEnv,
  operations: HydrationOperations
): HydrateResult {
  const start = createAnchor();
  parent.insertBefore(start, cursor);

  const boundary: MountedErrorBoundary = {
    kind: "error-boundary",
    key,
    start,
    end: start,
    fallback: node.props.fallback as ErrorBoundaryFallback,
    resetKey: node.props.resetKey,
    children: childToArray(node.props.children ?? []),
    child: null,
    error: null,
    context: env.context,
    parentBoundary: env.boundary,
    captureError: () => {},
    renderBoundary: () => {}
  };

  const childPath = extendHydrationPath(path, pathSegments, trackDetails, "/boundary");
  const hydratedChild = operations.hydrateNode(
    parent,
    cursor,
    boundary.children,
    childPath.path,
    childPath.pathSegments,
    trackDetails,
    {
      context: boundary.context,
      boundary
    }
  );
  const end = createAnchor();
  parent.insertBefore(end, hydratedChild.cursor);
  boundary.end = end;
  boundary.child = hydratedChild.mounted;
  initializeBoundaryRuntime(boundary, operations);

  return {
    mounted: boundary,
    cursor: hydratedChild.cursor
  };
}

function hydrateComponent(
  parent: Node,
  cursor: Node | null,
  type: Component,
  props: Record<string, unknown>,
  key: string | number | null,
  path: string | undefined,
  pathSegments: string[] | undefined,
  trackDetails: boolean,
  env: RenderEnv,
  operations: HydrationOperations
): HydrateResult {
  const start = createAnchor();
  parent.insertBefore(start, cursor);

  const component: MountedComponent = {
    kind: "component",
    key,
    start,
    end: start,
    type,
    props,
    child: null,
    dependencies: [],
    runtime: createComponentRuntimeState(),
    context: env.context,
    boundary: env.boundary,
    unmounted: false,
    isRendering: false,
    queued: false,
    performRender: () => {},
    rerender: () => {}
  };

  component.performRender = () => {
    const parentNode = component.start.parentNode;
    if (!parentNode || component.unmounted) {
      return;
    }
    runComponentRender(component, parentNode, operations);
  };
  component.rerender = () => {
    if (component.unmounted) {
      return;
    }
    scheduleComponent(component);
  };

  const dependenciesByKey = new Map<string, StoreDependency>();
  const output = withActiveComponent(component, () =>
    withDependencyCollector(
      (dependency) => {
        dependenciesByKey.set(getDependencyKey(dependency), dependency);
      },
      () => type(props)
    )
  );

  const childPath = extendHydrationPath(
    path,
    pathSegments,
    trackDetails,
    `/${type.name || "component"}`
  );
  const hydratedChild = operations.hydrateNode(
    parent,
    cursor,
    output,
    childPath.path,
    childPath.pathSegments,
    trackDetails,
    {
      context: component.context,
      boundary: component.boundary
    }
  );

  const end = createAnchor();
  parent.insertBefore(end, hydratedChild.cursor);
  component.end = end;
  component.child = hydratedChild.mounted;
  component.dependencies = reconcileDependencies(
    component.dependencies as RootDependencySubscription[],
    Array.from(dependenciesByKey.values()),
    component.rerender
  );
  runLayoutTasks(component);
  schedulePassiveTasks(component);

  return {
    mounted: component,
    cursor: hydratedChild.cursor
  };
}

export function hydrateNodeDetailed(
  parent: Node,
  cursor: Node | null,
  child: Child,
  hydrationPath: string | undefined,
  hydrationSegments: string[] | undefined,
  trackDetails: boolean,
  env: RenderEnv,
  operations: HydrationOperations
): HydrateResult {
  if (child === null || child === undefined || child === false || child === true) {
    const marker = createAnchor();
    parent.insertBefore(marker, cursor);
    return {
      mounted: { kind: "empty", key: null, start: marker, end: marker },
      cursor
    };
  }

  if (typeof child === "string" || typeof child === "number") {
    const textValue = String(child);
    if (cursor && cursor.nodeType === Node.TEXT_NODE) {
      const textNode = cursor as Text;
      if (textNode.textContent !== textValue) {
        reportHydrationMismatch({
          message: "Text content mismatch.",
          expected: textValue,
          found: textNode.textContent ?? "",
          path: hydrationPath,
          pathSegments: hydrationSegments,
          phase: "hydrate",
          kind: "text",
          recovery: "text"
        });
        textNode.textContent = textValue;
      }
      return {
        mounted: {
          kind: "text",
          key: null,
          start: textNode,
          end: textNode,
          node: textNode,
          value: textValue
        },
        cursor: textNode.nextSibling
      };
    }

    reportHydrationMismatch({
      message: "Expected text node during hydration.",
      expected: "#text",
      found: cursor ? `node:${cursor.nodeType}` : "none",
      path: hydrationPath,
      pathSegments: hydrationSegments,
      phase: "hydrate",
      kind: "text"
    });
    const mounted = operations.mountNode(parent, cursor, textValue, env);
    return { mounted, cursor };
  }

  if (Array.isArray(child)) {
    const children = normalizeChildrenFast(child);
    const start = createAnchor();
    parent.insertBefore(start, cursor);

    if (children.length === 0) {
      const end = createAnchor();
      parent.insertBefore(end, cursor);
      return {
        mounted: {
          kind: "fragment",
          key: null,
          start,
          end,
          children: []
        },
        cursor
      };
    }

    if (children.length === 1) {
      const nextPath = extendHydrationPath(hydrationPath, hydrationSegments, trackDetails, "[0]");
      const hydrated = operations.hydrateNode(
        parent,
        cursor,
        children[0],
        nextPath.path,
        nextPath.pathSegments,
        trackDetails,
        env
      );
      const end = createAnchor();
      parent.insertBefore(end, hydrated.cursor);
      return {
        mounted: {
          kind: "fragment",
          key: null,
          start,
          end,
          children: [hydrated.mounted]
        },
        cursor: hydrated.cursor
      };
    }

    let nextCursor = cursor;
    const mountedChildren: MountedNode[] = [];
    for (let index = 0; index < children.length; index += 1) {
      const nextPath = extendHydrationPath(
        hydrationPath,
        hydrationSegments,
        trackDetails,
        `[${index}]`
      );
      const hydrated = operations.hydrateNode(
        parent,
        nextCursor,
        children[index],
        nextPath.path,
        nextPath.pathSegments,
        trackDetails,
        env
      );
      mountedChildren.push(hydrated.mounted);
      nextCursor = hydrated.cursor;
    }

    const end = createAnchor();
    parent.insertBefore(end, nextCursor);

    return {
      mounted: {
        kind: "fragment",
        key: null,
        start,
        end,
        children: mountedChildren
      },
      cursor: nextCursor
    };
  }

  const key = getChildKey(child);

  if (typeof child.type === "function") {
    const componentNode = child as VNode & { type: Component };
    return withoutDependencyCollector(() =>
      hydrateComponent(
        parent,
        cursor,
        componentNode.type,
        componentNode.props,
        key,
        hydrationPath,
        hydrationSegments,
        trackDetails,
        env,
        operations
      )
    );
  }

  if (child.type === CONTEXT_PROVIDER) {
    return hydrateProvider(
      parent,
      cursor,
      child,
      key,
      hydrationPath,
      hydrationSegments,
      trackDetails,
      env,
      operations
    );
  }

  if (child.type === ERROR_BOUNDARY) {
    return hydrateErrorBoundary(
      parent,
      cursor,
      child,
      key,
      hydrationPath,
      hydrationSegments,
      trackDetails,
      env,
      operations
    );
  }

  if (child.type === Fragment) {
    return hydrateFragment(
      parent,
      cursor,
      normalizeChildrenFast(child.props.children),
      key,
      hydrationPath,
      hydrationSegments,
      trackDetails,
      env,
      operations
    );
  }

  if (
    cursor &&
    cursor.nodeType === Node.ELEMENT_NODE &&
    (cursor as Element).tagName.toLowerCase() === child.type
  ) {
    const element = cursor as Element;
    hydrateProps(element, child.props);
    assignDomRef(child.props.ref, element);

    const rawChildren = child.props.children;
    if (isEmptyChildValue(rawChildren) && element.firstChild === null) {
      return {
        mounted: {
          kind: "element",
          key,
          start: element,
          end: element,
          node: element,
          tag: child.type as string,
          props: child.props,
          children: [],
          directivesCleanup: applyElementLifecycleDirectives(element, child.props)
        },
        cursor: element.nextSibling
      };
    }

    if (
      (typeof rawChildren === "string" || typeof rawChildren === "number") &&
      element.firstChild?.nodeType === Node.TEXT_NODE &&
      element.firstChild.nextSibling === null
    ) {
      const textValue = String(rawChildren);
      const textNode = element.firstChild as Text;
      if (textNode.textContent !== textValue) {
        reportHydrationMismatch({
          message: "Text content mismatch.",
          expected: textValue,
          found: textNode.textContent ?? "",
          path: hydrationPath,
          pathSegments: hydrationSegments,
          phase: "hydrate",
          kind: "text",
          recovery: "text"
        });
        textNode.textContent = textValue;
      }
      return {
        mounted: {
          kind: "element",
          key,
          start: element,
          end: element,
          node: element,
          tag: child.type as string,
          props: child.props,
          children: [
            {
              kind: "text",
              key: null,
              start: textNode,
              end: textNode,
              node: textNode,
              value: textValue
            }
          ],
          directivesCleanup: applyElementLifecycleDirectives(element, child.props)
        },
        cursor: element.nextSibling
      };
    }

    const children = normalizeChildrenFast(rawChildren);
    if (children.length === 1) {
      const nextPath = extendHydrationPath(
        hydrationPath,
        hydrationSegments,
        trackDetails,
        `/${child.type}[0]`
      );
      const hydrated = operations.hydrateNode(
        element,
        element.firstChild,
        children[0],
        nextPath.path,
        nextPath.pathSegments,
        trackDetails,
        env
      );

      let childCursor = hydrated.cursor;
      while (childCursor) {
        const nextSibling: Node | null = childCursor.nextSibling;
        element.removeChild(childCursor);
        childCursor = nextSibling;
      }

      return {
        mounted: {
          kind: "element",
          key,
          start: element,
          end: element,
          node: element,
          tag: child.type as string,
          props: child.props,
          children: [hydrated.mounted],
          directivesCleanup: applyElementLifecycleDirectives(element, child.props)
        },
        cursor: element.nextSibling
      };
    }

    let childCursor: Node | null = element.firstChild;
    const mountedChildren: MountedNode[] = [];
    for (let index = 0; index < children.length; index += 1) {
      const nextPath = extendHydrationPath(
        hydrationPath,
        hydrationSegments,
        trackDetails,
        `/${child.type}[${index}]`
      );
      const hydrated = operations.hydrateNode(
        element,
        childCursor,
        children[index],
        nextPath.path,
        nextPath.pathSegments,
        trackDetails,
        env
      );
      mountedChildren.push(hydrated.mounted);
      childCursor = hydrated.cursor;
    }

    while (childCursor) {
      const nextSibling: Node | null = childCursor.nextSibling;
      element.removeChild(childCursor);
      childCursor = nextSibling;
    }

    return {
      mounted: {
        kind: "element",
        key,
        start: element,
        end: element,
        node: element,
        tag: child.type as string,
        props: child.props,
        children: mountedChildren,
        directivesCleanup: applyElementLifecycleDirectives(element, child.props)
      },
      cursor: element.nextSibling
    };
  }

  reportHydrationMismatch({
    message: "Hydration fallback mount due to node mismatch.",
    expected: childKindLabel(child),
    found:
      cursor === null
        ? "none"
        : cursor.nodeType === Node.ELEMENT_NODE
          ? (cursor as Element).tagName.toLowerCase()
          : `node:${cursor.nodeType}`,
    path: hydrationPath,
    pathSegments: hydrationSegments,
    phase: "hydrate",
    kind: childKindLabel(child),
    recovery: "subtree"
  });

  const mounted = operations.mountNode(parent, cursor, child, env);
  return { mounted, cursor };
}
