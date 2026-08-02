import type { ElementTarget } from "../../observers/index.js";
import type {
  ExternalStore,
  SelectorListener,
  Store,
  StoreListener,
  StorePath,
  StoreSelector,
  StoreWatchListener,
  Unsubscribe,
} from "../../store/index.js";
import type {
  AnyRecord,
  MvcControllerContext,
  MvcControllerFrameworkContext,
  MvcControllerTools,
  TavoAction,
} from "../types.js";
import { createControllerAction } from "./tools.js";

export class TavoController implements MvcControllerTools {
  declare model: Store<any>;
  declare props: AnyRecord;
  declare router: MvcControllerFrameworkContext["router"];
  declare stores: MvcControllerFrameworkContext["stores"];
  declare services: MvcControllerFrameworkContext["services"];
  declare capabilities: MvcControllerFrameworkContext["capabilities"];
  declare page: MvcControllerFrameworkContext["page"];
  #tools: MvcControllerTools | null = null;
  #actionNotify: (() => void) | null = null;

  __setTavoControllerContext(
    context: Pick<
      MvcControllerContext<AnyRecord, AnyRecord>,
      "model" | "props"
    >,
  ): void {
    this.model = context.model;
    this.props = context.props;
  }

  __setTavoControllerTools(tools: MvcControllerTools): void {
    this.#tools = tools;
    this.#actionNotify =
      "notify" in tools && typeof tools.notify === "function"
        ? (tools.notify as () => void)
        : null;
  }

  #requireTools(method: string): MvcControllerTools {
    if (!this.#tools) {
      throw new Error(
        `tavo controller: ${method} is only available after createTavo initializes.`,
      );
    }
    return this.#tools;
  }

  cleanup(fn: Unsubscribe): Unsubscribe {
    return this.#requireTools("cleanup").cleanup(fn);
  }

  createId(prefix?: string): string {
    return this.#requireTools("createId").createId(prefix);
  }

  setTimeout(fn: () => void, delay?: number): Unsubscribe {
    return this.#requireTools("setTimeout").setTimeout(fn, delay);
  }

  setInterval(fn: () => void, delay?: number): Unsubscribe {
    return this.#requireTools("setInterval").setInterval(fn, delay);
  }

  action<TResult, TArgs extends unknown[]>(
    fn: (...args: TArgs) => Promise<TResult> | TResult,
  ): TavoAction<TResult, TArgs> {
    if (this.#tools) return this.#tools.action(fn);
    return createControllerAction(fn, () => {
      if (this.#actionNotify) this.#actionNotify();
      else if (this.model) this.model.patch({} as Partial<any>);
    });
  }

  scheduleLayoutEffect(fn: () => void | Unsubscribe): Unsubscribe {
    return this.#requireTools("scheduleLayoutEffect").scheduleLayoutEffect(fn);
  }

  scheduleAfterRender(fn: () => void): Unsubscribe {
    return this.#requireTools("scheduleAfterRender").scheduleAfterRender(fn);
  }

  scheduleOnMount(fn: () => void | Unsubscribe): Unsubscribe {
    return this.#requireTools("scheduleOnMount").scheduleOnMount(fn);
  }

  listen<T extends AnyRecord>(
    store: Store<T>,
    listener: StoreListener<T>,
    options?: { immediate?: boolean },
  ): Unsubscribe {
    return this.#requireTools("listen").listen(store, listener, options);
  }

  select<T extends AnyRecord, S>(
    store: Store<T>,
    selector: StoreSelector<T, S>,
    listener: SelectorListener<S, T>,
    options?: { immediate?: boolean; isEqual?: (a: S, b: S) => boolean },
  ): Unsubscribe {
    return this.#requireTools("select").select(
      store,
      selector,
      listener,
      options,
    );
  }

  watch<T extends AnyRecord, S>(
    store: Store<T>,
    target: StorePath | StoreSelector<T, S>,
    listener: StoreWatchListener<S, T>,
    options?: { immediate?: boolean; isEqual?: (a: S, b: S) => boolean },
  ): Unsubscribe {
    return this.#requireTools("watch").watch(store, target, listener, options);
  }

  listenExternal<T>(
    store: ExternalStore<T>,
    listener: (snapshot: T, previousSnapshot: T) => void,
    options?: { immediate?: boolean; isEqual?: (a: T, b: T) => boolean },
  ): Unsubscribe {
    return this.#requireTools("listenExternal").listenExternal(
      store,
      listener,
      options,
    );
  }

  observeResize<T extends Element>(
    target: ElementTarget<T>,
    listener: ResizeObserverCallback,
    options?: ResizeObserverOptions,
  ): Unsubscribe {
    return this.#requireTools("observeResize").observeResize(
      target,
      listener,
      options,
    );
  }

  observeIntersection<T extends Element>(
    target: ElementTarget<T>,
    listener: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ): Unsubscribe {
    return this.#requireTools("observeIntersection").observeIntersection(
      target,
      listener,
      options,
    );
  }

  observeMutation<T extends Node>(
    target: T | { current: T | null },
    listener: MutationCallback,
    options?: MutationObserverInit,
  ): Unsubscribe {
    return this.#requireTools("observeMutation").observeMutation(
      target,
      listener,
      options,
    );
  }
}
