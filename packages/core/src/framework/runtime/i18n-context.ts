import type { AnyI18nService } from "../../i18n/index.js";

type LocaleStore = Map<AnyI18nService, string>;
type AsyncLocalStorageLike = {
  getStore(): LocaleStore | undefined;
  run<T>(store: LocaleStore, callback: () => T): T;
};

const storageKey = "__tavo_i18n_async_locale_storage__";
const storagePromiseKey = "__tavo_i18n_async_locale_storage_promise__";
const fallbackQueueKey = "__tavo_i18n_locale_fallback_queue__";
export const requestLocaleResolverKey = "__tavo_i18n_request_locale_resolver__";

function runtimeTarget(): Record<string, unknown> {
  return globalThis as unknown as Record<string, unknown>;
}

async function getLocaleStorage(): Promise<AsyncLocalStorageLike | null> {
  const target = runtimeTarget();
  const existing = target[storageKey] as AsyncLocalStorageLike | undefined;
  if (existing) {
    return existing;
  }
  const pending = target[storagePromiseKey] as Promise<AsyncLocalStorageLike | null> | undefined;
  if (pending) {
    return pending;
  }

  const created = (async (): Promise<AsyncLocalStorageLike | null> => {
    if (typeof window !== "undefined") {
      return null;
    }
    try {
      const runtimeImport = new Function("specifier", "return import(specifier);") as (
        specifier: string
      ) => Promise<{ AsyncLocalStorage: new () => AsyncLocalStorageLike }>;
      const { AsyncLocalStorage } = await runtimeImport("node:async_hooks");
      const storage = new AsyncLocalStorage();
      target[storageKey] = storage;
      target[requestLocaleResolverKey] = (service: AnyI18nService) =>
        storage.getStore()?.get(service);
      return storage;
    } catch {
      return null;
    }
  })();
  target[storagePromiseKey] = created;
  return created;
}

/** Runs server work with an async-request-local locale when the runtime supports it. */
export async function runWithI18nRequestLocale<T>(
  service: AnyI18nService | undefined,
  locale: string | undefined,
  operation: () => Promise<T>
): Promise<T> {
  if (!service || !locale) {
    return operation();
  }
  const storage = await getLocaleStorage();
  if (!storage) {
    const target = runtimeTarget();
    const previous = (target[fallbackQueueKey] as Promise<void> | undefined) ?? Promise.resolve();
    let release!: () => void;
    target[fallbackQueueKey] = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const priorLocale = service.locale;
    try {
      service.setLocale(locale as Parameters<AnyI18nService["setLocale"]>[0], { persist: false });
      return await operation();
    } finally {
      service.setLocale(priorLocale as Parameters<AnyI18nService["setLocale"]>[0], { persist: false });
      release();
    }
  }
  const next = new Map(storage.getStore() ?? []);
  next.set(service, locale);
  return storage.run(next, operation);
}
