import type { Component } from "../jsx.js";
import { createStore, shallowEqual, type Store } from "../store/index.js";
import {
  createRuntimeId,
  getActiveComponent,
  getComponentCell,
  queueLayoutTask,
  queuePassiveTask,
  queuePassiveTaskOnce,
  registerComponentCleanup,
} from "../runtime/dom/component-runtime.js";
import type {
  AnyRecord,
  MvcComponentDefinition,
  MvcControllerContext,
  MvcControllerFrameworkContext,
  MvcControllerHooks,
  MvcControllerTools,
} from "./types.js";
import { createControllerFrameworkContext } from "./mvc/framework-context.js";
import {
  createControllerTools,
  type ManagedControllerTools,
} from "./mvc/tools.js";

export { TavoController } from "./mvc/controller.js";

function toStore<S extends AnyRecord>(model: S | Store<S>): Store<S> {
  const candidate = model as Partial<Store<S>>;
  const isStore =
    typeof candidate.getState === "function" &&
    typeof candidate.setState === "function" &&
    typeof candidate.patch === "function" &&
    typeof candidate.subscribe === "function" &&
    typeof candidate.subscribeSelector === "function" &&
    typeof candidate.watch === "function";
  return isStore ? (model as Store<S>) : createStore(model as S);
}

function createLiveControllerContext<P extends AnyRecord, S extends AnyRecord>(
  model: Store<S>,
  getProps: () => P,
  framework: MvcControllerFrameworkContext,
  tools: MvcControllerTools,
): MvcControllerContext<P, S> {
  const context = {
    model,
    cleanup: tools.cleanup.bind(tools),
    createId: tools.createId.bind(tools),
    setTimeout: tools.setTimeout.bind(tools),
    setInterval: tools.setInterval.bind(tools),
    action: tools.action.bind(tools),
    scheduleLayoutEffect: tools.scheduleLayoutEffect.bind(tools),
    scheduleAfterRender: tools.scheduleAfterRender.bind(tools),
    scheduleOnMount: tools.scheduleOnMount.bind(tools),
    listen: tools.listen.bind(tools),
    select: tools.select.bind(tools),
    watch: tools.watch.bind(tools),
    listenExternal: tools.listenExternal.bind(tools),
    observeResize: tools.observeResize.bind(tools),
    observeIntersection: tools.observeIntersection.bind(tools),
    observeMutation: tools.observeMutation.bind(tools),
  } as MvcControllerContext<P, S>;
  Object.defineProperties(context, {
    props: { configurable: true, enumerable: true, get: getProps },
    router: {
      configurable: true,
      enumerable: true,
      get: () => framework.router,
    },
    stores: {
      configurable: true,
      enumerable: true,
      get: () => framework.stores,
    },
    services: {
      configurable: true,
      enumerable: true,
      get: () => framework.services,
    },
    capabilities: {
      configurable: true,
      enumerable: true,
      get: () => framework.capabilities,
    },
    page: {
      configurable: true,
      enumerable: true,
      get: () => framework.page,
    },
  });
  return context;
}

function attachControllerContext<C, P extends AnyRecord, S extends AnyRecord>(
  controller: C,
  context: Pick<MvcControllerContext<P, S>, "model" | "props">,
  framework: MvcControllerFrameworkContext,
  tools: MvcControllerTools,
): C & Pick<MvcControllerContext<P, S>, "model" | "props"> {
  if (!controller || typeof controller !== "object") {
    return controller as C &
      Pick<MvcControllerContext<P, S>, "model" | "props">;
  }
  if (
    "__setTavoControllerContext" in controller &&
    typeof controller.__setTavoControllerContext === "function"
  )
    controller.__setTavoControllerContext(context);
  for (const key of ["model", "props"] as const) {
    const target = controller as Record<string, unknown>;
    if (key in target && target[key] !== undefined) continue;
    Object.defineProperty(controller, key, {
      configurable: true,
      enumerable: false,
      writable: true,
      value: context[key],
    });
  }
  for (const key of [
    "router",
    "stores",
    "services",
    "capabilities",
    "page",
  ] as const) {
    const target = controller as Record<string, unknown>;
    if (key in target && target[key] !== undefined) continue;
    Object.defineProperty(controller, key, {
      configurable: true,
      enumerable: false,
      get: () => framework[key],
    });
  }
  if (
    "__setTavoControllerTools" in controller &&
    typeof controller.__setTavoControllerTools === "function"
  )
    controller.__setTavoControllerTools(tools);
  const toolNames = [
    "cleanup",
    "createId",
    "setTimeout",
    "setInterval",
    "action",
    "scheduleLayoutEffect",
    "scheduleAfterRender",
    "scheduleOnMount",
    "listen",
    "select",
    "watch",
    "listenExternal",
    "observeResize",
    "observeIntersection",
    "observeMutation",
  ] as const;
  for (const key of toolNames) {
    if (key in controller) continue;
    Object.defineProperty(controller, key, {
      configurable: true,
      enumerable: false,
      value: tools[key].bind(tools),
    });
  }
  return controller as C & Pick<MvcControllerContext<P, S>, "model" | "props">;
}

const mvcStateKey = Symbol("tavo.mvc.state");
const mvcLayoutKey = Symbol("tavo.mvc.layout");
const mvcMountKey = Symbol("tavo.mvc.mount");
const mvcAfterRenderKey = Symbol("tavo.mvc.after-render");
const mvcPropsKey = Symbol("tavo.mvc.props");

function identitySelector<T>(value: T): T {
  return value;
}

function pulseVersionSelector(value: { version: number }): number {
  return value.version;
}

type MvcRuntimeState<P extends AnyRecord, S extends AnyRecord, C> = {
  model: Store<S>;
  controllerPulse: Store<{ version: number }>;
  previousProps: P | null;
  controller: {
    instance: (C & Pick<MvcControllerContext<P, S>, "model" | "props">) | null;
    tools: ManagedControllerTools;
    setProps(nextProps: P): void;
  };
};

function updateControllerProps<P extends AnyRecord, S extends AnyRecord, C>(
  controller: MvcRuntimeState<P, S, C>["controller"],
  props: P,
): void {
  controller.setProps(props);
  if (controller.instance && typeof controller.instance === "object") {
    Object.defineProperty(controller.instance, "props", {
      configurable: true,
      enumerable: false,
      writable: true,
      value: props,
    });
  }
}

export function createTavo<
  P extends AnyRecord,
  S extends AnyRecord,
  C = unknown,
>(definition: MvcComponentDefinition<P, S, C>): Component<P> {
  return function MvcComponent(props: P) {
    const runtime = getComponentCell<MvcRuntimeState<P, S, C>>(
      mvcStateKey,
      () => {
        const model = definition.model
          ? toStore(definition.model(props))
          : createStore({} as S);
        const controllerPulse = createStore({ version: 0 });
        const component = getActiveComponent();
        if (component) {
          registerComponentCleanup(
            model.subscribeSelector(
              identitySelector,
              () => component.rerender(),
              { isEqual: shallowEqual },
            ),
          );
          registerComponentCleanup(
            controllerPulse.subscribeSelector(pulseVersionSelector, () =>
              component.rerender(),
            ),
          );
        }
        const notify = () =>
          controllerPulse.set("version", (value) => value + 1);
        const tools = createControllerTools(
          createRuntimeId("controller"),
          notify,
        );
        const framework = createControllerFrameworkContext();
        let currentProps = props;
        const context = createLiveControllerContext(
          model,
          () => currentProps,
          framework,
          tools,
        );
        let instance: MvcRuntimeState<P, S, C>["controller"]["instance"] = null;
        if (definition.controller) {
          instance = attachControllerContext(
            new definition.controller(context),
            context,
            framework,
            tools,
          );
        } else if (definition.createController) {
          instance = attachControllerContext(
            definition.createController(context),
            context,
            framework,
            tools,
          );
        }
        const controller = {
          instance,
          tools,
          setProps(nextProps: P) {
            currentProps = nextProps;
          },
        };
        registerComponentCleanup(() => {
          (controller.instance as MvcControllerHooks<P> | null)?.onDestroy?.();
          controller.tools.flushCleanups();
        });
        return { model, controllerPulse, previousProps: null, controller };
      },
    );

    const { model, controllerPulse, controller } = runtime;
    queueLayoutTask(mvcLayoutKey, () => {
      const cleanup = (
        controller.instance as MvcControllerHooks<P> | null
      )?.onLayout?.();
      return typeof cleanup === "function" ? cleanup : undefined;
    });
    queuePassiveTaskOnce(mvcMountKey, () => {
      const hooks = controller.instance as MvcControllerHooks<P> | null;
      hooks?.onInit?.();
      const cleanup = hooks?.onMount?.();
      const managed =
        typeof cleanup === "function"
          ? controller.tools.cleanup(cleanup)
          : null;
      return () => managed?.();
    });
    queuePassiveTask(mvcAfterRenderKey, () => {
      (controller.instance as MvcControllerHooks<P> | null)?.afterRender?.();
    });
    if (
      runtime.previousProps === null ||
      !shallowEqual(runtime.previousProps, props)
    ) {
      runtime.previousProps = props;
      queuePassiveTask(mvcPropsKey, () => {
        const hooks = controller.instance as MvcControllerHooks<P> | null;
        updateControllerProps(controller, props);
        hooks?.onPropsChange?.(props);
      });
    }
    const state = identitySelector(model.getState());
    pulseVersionSelector(controllerPulse.getState());
    updateControllerProps(controller, props);
    return definition.view({
      props,
      state,
      model,
      controller: controller.instance,
    });
  };
}
