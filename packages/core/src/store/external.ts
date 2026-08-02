import type { Unsubscribe } from "./types.js";

export type ExternalStore<T> = {
  getSnapshot(): T;
  getServerSnapshot?: () => T;
  subscribe(listener: () => void): Unsubscribe;
};

export function createExternalStore<T>(store: ExternalStore<T>): ExternalStore<T> {
  return store;
}
