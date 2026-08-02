import { createStore } from "../store/index.js";
import type { Action, ActionContext, ActionState } from "./types.js";

export type { Action, ActionContext, ActionState, ActionStatus } from "./types.js";

/** Creates an MVC-friendly mutation primitive with status, result, error, and abort handling. */
export function createAction<TInput = void, TResult = unknown>(
  handler: (context: ActionContext<TInput>) => Promise<TResult> | TResult
): Action<TInput, TResult> {
  const store = createStore<ActionState<TResult>>({
    status: "idle",
    data: null,
    error: null,
    submittedAt: null,
    completedAt: null
  });
  let controller: AbortController | null = null;
  let runId = 0;

  return {
    store,
    getState() {
      return store.getState();
    },
    abort() {
      if (!controller) {
        return;
      }
      controller.abort();
      controller = null;
      runId += 1;
      store.patch({
        status: "idle",
        error: null,
        completedAt: null
      });
    },
    reset() {
      controller?.abort();
      controller = null;
      runId += 1;
      store.setState({
        status: "idle",
        data: null,
        error: null,
        submittedAt: null,
        completedAt: null
      });
    },
    async run(input: TInput) {
      controller?.abort();
      const currentController = new AbortController();
      const currentRunId = ++runId;
      const submittedAt = Date.now();
      controller = currentController;
      store.patch({
        status: "running",
        error: null,
        submittedAt,
        completedAt: null
      });

      try {
        const data = await handler({ input, signal: currentController.signal });
        if (runId !== currentRunId) {
          return store.getState();
        }
        const next: ActionState<TResult> = {
          status: "success",
          data,
          error: null,
          submittedAt,
          completedAt: Date.now()
        };
        store.setState(next);
        return next;
      } catch (error) {
        if (runId !== currentRunId) {
          return store.getState();
        }
        const next: ActionState<TResult> = {
          ...store.getState(),
          status: "error",
          error,
          completedAt: Date.now()
        };
        store.setState(next);
        return next;
      } finally {
        if (runId === currentRunId && controller === currentController) {
          controller = null;
        }
      }
    }
  };
}
