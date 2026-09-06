import { createStore } from "../store/index.js";
import type { Resource, ResourceState } from "./types.js";

export type { Resource, ResourceState } from "./types.js";

function waitForResource<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // A loader can abort synchronously before returning a rejected operation.
    void operation.catch(() => undefined);
    return Promise.reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      }
    );
  });
}

/** Creates an MVC-friendly async resource with explicit load/reset methods and observable state. */
export function createResource<T>(
  loader: (context: { signal: AbortSignal }) => Promise<T>
): Resource<T> {
  const store = createStore<ResourceState<T>>({
    status: "idle",
    data: null,
    error: null,
    updatedAt: null
  });

  let pending: Promise<ResourceState<T>> | null = null;
  let controller: AbortController | null = null;
  let loadId = 0;

  async function load(options?: { signal?: AbortSignal }): Promise<ResourceState<T>> {
    controller?.abort();
    const currentController = new AbortController();
    controller = currentController;
    const externalSignal = options?.signal;
    const abortFromExternal = () => currentController.abort(externalSignal?.reason);
    if (externalSignal?.aborted) {
      abortFromExternal();
    } else {
      externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
    }
    const currentLoadId = ++loadId;
    store.patch({ status: "loading", error: null });
    try {
      currentController.signal.throwIfAborted();
      const operation = Promise.resolve(loader({ signal: currentController.signal }));
      const data = await waitForResource(operation, currentController.signal);
      if (loadId !== currentLoadId) {
        return store.getState();
      }
      const next: ResourceState<T> = {
        status: "success",
        data,
        error: null,
        updatedAt: Date.now()
      };
      store.setState(next);
      return next;
    } catch (error) {
      if (loadId !== currentLoadId) {
        return store.getState();
      }
      if (currentController.signal.aborted) {
        const next: ResourceState<T> = {
          ...store.getState(),
          status: "idle",
          error: null,
          updatedAt: null
        };
        store.setState(next);
        return next;
      }
      const next: ResourceState<T> = {
        ...store.getState(),
        status: "error",
        error,
        updatedAt: Date.now()
      };
      store.setState(next);
      return next;
    } finally {
      externalSignal?.removeEventListener("abort", abortFromExternal);
      if (loadId === currentLoadId) {
        pending = null;
        if (controller === currentController) {
          controller = null;
        }
      }
    }
  }

  return {
    store,
    read() {
      return store.getState();
    },
    load,
    preload(options) {
      if (!pending) {
        const current = load(options);
        pending = current;
        const clear = () => {
          if (pending === current) pending = null;
        };
        // Even a synchronous loader failure finishes after preload assigns pending.
        void current.then(clear, clear);
      }
      return pending;
    },
    abort(reason) {
      if (!controller) {
        return;
      }
      controller.abort(reason);
      controller = null;
      loadId += 1;
      pending = null;
      store.patch({ status: "idle", error: null, updatedAt: null });
    },
    reset() {
      controller?.abort();
      controller = null;
      loadId += 1;
      pending = null;
      store.setState({
        status: "idle",
        data: null,
        error: null,
        updatedAt: null
      });
    }
  };
}
