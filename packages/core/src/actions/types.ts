import type { Store } from "../store/index.js";

export type ActionStatus = "idle" | "running" | "success" | "error";

export type ActionState<TResult = unknown> = {
  status: ActionStatus;
  data: TResult | null;
  error: unknown;
  submittedAt: number | null;
  completedAt: number | null;
};

export type ActionContext<TInput> = {
  input: TInput;
  signal: AbortSignal;
};

export type Action<TInput, TResult> = {
  store: Store<ActionState<TResult>>;
  getState(): ActionState<TResult>;
  run(input: TInput): Promise<ActionState<TResult>>;
  abort(): void;
  reset(): void;
};
