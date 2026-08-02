import type { SeoProps } from "./types.js";

export type SeoRegistry = {
  add(props: SeoProps): string | undefined;
  entries(): readonly {
    position?: string;
    value: SeoProps;
  }[];
  value(): SeoProps | undefined;
};

type GlobalSeoRuntime = {
  activeRegistry: SeoRegistry | null;
};

const GLOBAL_SEO_RUNTIME_KEY = Symbol.for("tavo.seo.runtime");

function getGlobalSeoRuntime(): GlobalSeoRuntime {
  const target = globalThis as typeof globalThis & {
    [GLOBAL_SEO_RUNTIME_KEY]?: GlobalSeoRuntime;
  };
  target[GLOBAL_SEO_RUNTIME_KEY] ??= { activeRegistry: null };
  return target[GLOBAL_SEO_RUNTIME_KEY];
}

export function createSeoRegistry(
  options: { capturePositions?: boolean } = {},
): SeoRegistry {
  let merged: SeoProps | undefined;
  let position = 0;
  const entries: Array<{
    position?: string;
    value: SeoProps;
  }> = [];
  return {
    add(props) {
      merged = {
        ...(merged ?? {}),
        ...props,
        ...(merged?.openGraph || props.openGraph
          ? { openGraph: { ...(merged?.openGraph ?? {}), ...(props.openGraph ?? {}) } }
          : {}),
        ...(merged?.twitter || props.twitter
          ? { twitter: { ...(merged?.twitter ?? {}), ...(props.twitter ?? {}) } }
          : {})
      };
      if (options.capturePositions) {
        position += 1;
        const capturedPosition = String(position);
        entries.push({ position: capturedPosition, value: merged });
        return capturedPosition;
      }
      entries.push({ value: merged });
      return undefined;
    },
    entries() {
      return entries;
    },
    value() {
      return merged;
    }
  };
}

export function getActiveSeoRegistry(): SeoRegistry | null {
  return getGlobalSeoRuntime().activeRegistry;
}

export function withSeoRegistry<T>(registry: SeoRegistry, fn: () => T): T {
  const runtime = getGlobalSeoRuntime();
  const previous = runtime.activeRegistry;
  runtime.activeRegistry = registry;
  try {
    return fn();
  } finally {
    runtime.activeRegistry = previous;
  }
}

getGlobalSeoRuntime();
