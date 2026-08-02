import type { Store } from "../store/index.js";

export type ResourceState<T> = {
  status: "idle" | "loading" | "success" | "error";
  data: T | null;
  error: unknown;
  updatedAt: number | null;
};

export type Resource<T> = {
  store: Store<ResourceState<T>>;
  read(): ResourceState<T>;
  load(options?: { signal?: AbortSignal }): Promise<ResourceState<T>>;
  preload(options?: { signal?: AbortSignal }): Promise<ResourceState<T>>;
  abort(reason?: unknown): void;
  reset(): void;
};
