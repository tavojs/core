import type { Child, Component } from "../../../../jsx.js";
import { withDependencyCollector, type StoreDependency } from "../../../../reactivity.js";
import {
  beginComponentRender,
  createComponentRuntimeState,
  runComponentRenderFinalizers,
  runLayoutTasks,
  schedulePassiveTasks,
  withActiveComponent
} from "../../component-runtime.js";
import { getDependencyKey, reconcileDependencies } from "../../dependencies.js";
import { scheduleComponent } from "../../scheduler.js";
import { createAnchor } from "../../utils.js";
import type {
  HydrateResult,
  MountedComponent,
  RootDependencySubscription
} from "../../types.js";
import { runComponentRender } from "../mount-nodes.js";
import {
  trackMountedNode,
  type HydrationOperations,
  type RenderEnv
} from "../context.js";

export function hydrateComponentRuntime(
  parent: Node,
  cursor: Node | null,
  type: Component,
  props: Record<string, unknown>,
  key: string | number | null,
  env: RenderEnv,
  operations: HydrationOperations,
  hydrateOutput: (output: Child) => HydrateResult
): HydrateResult {
  const start = createAnchor();
  parent.insertBefore(start, cursor);

  const component: MountedComponent = trackMountedNode(env, {
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
  });

  component.performRender = () => {
    const parentNode = component.start.parentNode;
    if (!parentNode || component.unmounted) {
      return;
    }
    runComponentRender(component, parentNode, operations);
  };
  component.rerender = () => {
    if (!component.unmounted) {
      scheduleComponent(component);
    }
  };

  component.isRendering = true;
  beginComponentRender(component);
  try {
    const dependenciesByKey = new Map<string, StoreDependency>();
    const output = withActiveComponent(component, () =>
      withDependencyCollector(
        (dependency) => {
          dependenciesByKey.set(getDependencyKey(dependency), dependency);
        },
        () => type(props)
      )
    );
    const hydratedChild = hydrateOutput(output);

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
  } finally {
    component.isRendering = false;
    runComponentRenderFinalizers(component);
    if (component.queued) {
      component.queued = false;
      scheduleComponent(component);
    }
  }
}
