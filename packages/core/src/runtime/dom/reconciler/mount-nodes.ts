import type { Child, Component, VNode } from "../../../jsx.js";
import {
  withDependencyCollector,
  type StoreDependency
} from "../../../reactivity.js";
import {
  type ErrorBoundaryFallback,
  type TavoContext
} from "../../../components/index.js";
import {
  createComponentRuntimeState,
  runLayoutTasks,
  schedulePassiveTasks,
  withActiveComponent
} from "../component-runtime.js";
import { getDependencyKey, reconcileDependencies } from "../dependencies.js";
import {
  reportRuntimeError,
  showConfiguredDevOverlay
} from "../diagnostics-core.js";
import { scheduleComponent } from "../scheduler.js";
import { childToArray } from "../child-utils.js";
import { createAnchor } from "../utils.js";
import type {
  MountedComponent,
  MountedErrorBoundary,
  MountedFragment,
  MountedNode,
  MountedProvider,
  RootDependencySubscription
} from "../types.js";
import type { MountOperations, RenderEnv } from "./context.js";

export function resolveBoundaryFallback(
  fallback: ErrorBoundaryFallback,
  error: unknown
): Child {
  if (typeof fallback === "function") {
    return (fallback as (value: unknown) => Child)(error);
  }
  return fallback;
}

export function captureError(boundary: MountedErrorBoundary | null, error: unknown): void {
  if (boundary) {
    boundary.captureError(error);
    return;
  }
  reportRuntimeError(error);
  showConfiguredDevOverlay(error);
}

export function initializeBoundaryRuntime(
  boundary: MountedErrorBoundary,
  operations: MountOperations
): void {
  const renderBoundary = (): void => {
    const parentNode = boundary.start.parentNode;
    if (!parentNode) {
      return;
    }

    const nextChild =
      boundary.error === null
        ? boundary.children
        : resolveBoundaryFallback(boundary.fallback, boundary.error);

    try {
      if (boundary.child) {
        boundary.child = operations.patchNode(parentNode, boundary.child, nextChild, {
          context: boundary.context,
          boundary
        });
      } else {
        boundary.child = operations.mountNode(parentNode, boundary.end, nextChild, {
          context: boundary.context,
          boundary
        });
      }
    } catch (error) {
      captureError(boundary.parentBoundary, error);
    }
  };

  boundary.captureError = (error: unknown) => {
    boundary.error = error;
    boundary.renderBoundary();
  };
  boundary.renderBoundary = renderBoundary;
}

export function runComponentRender(
  component: MountedComponent,
  parentNode: Node,
  operations: MountOperations
): void {
  if (component.isRendering) {
    component.queued = true;
    return;
  }

  component.isRendering = true;
  try {
    const dependenciesByKey = new Map<string, StoreDependency>();
    const output = withActiveComponent(component, () =>
      withDependencyCollector(
        (dependency) => {
          dependenciesByKey.set(getDependencyKey(dependency), dependency);
        },
        () => component.type(component.props)
      )
    );

    if (component.child) {
      component.child = operations.patchNode(parentNode, component.child, output, {
        context: component.context,
        boundary: component.boundary
      });
    } else {
      component.child = operations.mountNode(parentNode, component.end, output, {
        context: component.context,
        boundary: component.boundary
      });
    }

    component.dependencies = reconcileDependencies(
      component.dependencies as RootDependencySubscription[],
      Array.from(dependenciesByKey.values()),
      component.rerender
    );
    runLayoutTasks(component);
    schedulePassiveTasks(component);
  } catch (error) {
    captureError(component.boundary, error);
  } finally {
    component.isRendering = false;
  }

  if (component.queued) {
    component.queued = false;
    component.rerender();
  }
}

export function mountFragment(
  parent: Node,
  before: Node | null,
  children: Child[],
  key: string | number | null,
  env: RenderEnv,
  operations: MountOperations
): MountedFragment {
  const start = createAnchor();
  const end = createAnchor();
  parent.insertBefore(start, before);
  parent.insertBefore(end, before);

  const mountedChildren: MountedNode[] = [];
  for (const child of children) {
    mountedChildren.push(operations.mountNode(parent, end, child, env));
  }

  return {
    kind: "fragment",
    key,
    start,
    end,
    children: mountedChildren
  };
}

export function mountProvider(
  parent: Node,
  before: Node | null,
  node: VNode,
  key: string | number | null,
  env: RenderEnv,
  operations: MountOperations
): MountedProvider {
  const start = createAnchor();
  const end = createAnchor();
  parent.insertBefore(start, before);
  parent.insertBefore(end, before);

  const contextRef = node.props.context as TavoContext<unknown>;
  const value = node.props.value;
  const providerContext = new Map(env.context);
  providerContext.set(contextRef.id as symbol, value);

  const provider: MountedProvider = {
    kind: "provider",
    key,
    start,
    end,
    contextRef,
    value,
    child: null,
    context: providerContext,
    boundary: env.boundary
  };

  const rendered = childToArray(node.props.children ?? []);
  provider.child = operations.mountNode(parent, provider.end, rendered, {
    context: provider.context,
    boundary: provider.boundary
  });
  return provider;
}

export function mountErrorBoundary(
  parent: Node,
  before: Node | null,
  node: VNode,
  key: string | number | null,
  env: RenderEnv,
  operations: MountOperations
): MountedErrorBoundary {
  const start = createAnchor();
  const end = createAnchor();
  parent.insertBefore(start, before);
  parent.insertBefore(end, before);

  const boundary: MountedErrorBoundary = {
    kind: "error-boundary",
    key,
    start,
    end,
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

  initializeBoundaryRuntime(boundary, operations);
  boundary.renderBoundary();

  return boundary;
}

export function mountComponent(
  parent: Node,
  before: Node | null,
  type: Component,
  props: Record<string, unknown>,
  key: string | number | null,
  env: RenderEnv,
  operations: MountOperations
): MountedComponent {
  const start = createAnchor();
  const end = createAnchor();
  parent.insertBefore(start, before);
  parent.insertBefore(end, before);

  const component: MountedComponent = {
    kind: "component",
    key,
    start,
    end,
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

  component.performRender();
  return component;
}
