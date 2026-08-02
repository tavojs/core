import { escapeHtml, isSafeAttributeName } from "./security.js";

export type StyleRegistryEntry = {
  id: string;
  css: string;
  attributes?: Record<string, string | number | boolean>;
};

export type StyleRegistry = {
  add(id: string, css: string, options?: StyleOptions): void;
  has(id: string): boolean;
  entries(): StyleRegistryEntry[];
};

export type StyleOptions = {
  attributes?: Record<string, string | number | boolean>;
};

export type RenderStyleTagsOptions = {
  nonce?: string;
};

type GlobalStyleRuntime = {
  activeStyleRegistry: StyleRegistry | null;
  getActiveStyleRegistry(): StyleRegistry | null;
  style(id: string, css: string, options?: StyleOptions): void;
};

const GLOBAL_STYLE_RUNTIME_KEY = Symbol.for("tavo.style.runtime");

function getGlobalStyleRuntime(): GlobalStyleRuntime {
  const globalTarget = globalThis as typeof globalThis & {
    [GLOBAL_STYLE_RUNTIME_KEY]?: GlobalStyleRuntime;
  };
  globalTarget[GLOBAL_STYLE_RUNTIME_KEY] ??= {
    activeStyleRegistry: null,
    getActiveStyleRegistry,
    style
  };
  return globalTarget[GLOBAL_STYLE_RUNTIME_KEY];
}

function escapeStyleText(value: string): string {
  return value.replace(/<\/style/gi, "<\\/style");
}

function renderAttributes(attributes?: Record<string, string | number | boolean>): string {
  if (!attributes) {
    return "";
  }

  const parts: string[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (!isSafeAttributeName(key) || value === false) {
      continue;
    }
    if (value === true) {
      parts.push(key);
      continue;
    }
    parts.push(`${key}="${escapeHtml(String(value))}"`);
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

function findClientStyle(id: string): HTMLStyleElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  for (const node of Array.from(document.head.querySelectorAll("style[data-tavo-style]"))) {
    if (node.getAttribute("data-tavo-style") === id) {
      return node as HTMLStyleElement;
    }
  }
  return null;
}

export function createStyleRegistry(): StyleRegistry {
  const styles = new Map<string, StyleRegistryEntry>();
  return {
    add(id, css, options) {
      if (!id || styles.has(id)) {
        return;
      }
      styles.set(id, {
        id,
        css,
        attributes: options?.attributes
      });
    },
    has(id) {
      return styles.has(id);
    },
    entries() {
      return Array.from(styles.values());
    }
  };
}

export function getActiveStyleRegistry(): StyleRegistry | null {
  return getGlobalStyleRuntime().activeStyleRegistry;
}

export function withStyleRegistry<T>(registry: StyleRegistry, fn: () => T): T {
  const runtime = getGlobalStyleRuntime();
  const previous = runtime.activeStyleRegistry;
  runtime.activeStyleRegistry = registry;
  try {
    const result = fn();
    if (result && typeof result === "object" && "finally" in result && typeof result.finally === "function") {
      return result.finally(() => {
        runtime.activeStyleRegistry = previous;
      }) as T;
    }
    runtime.activeStyleRegistry = previous;
    return result;
  } finally {
    if (runtime.activeStyleRegistry === registry) {
      runtime.activeStyleRegistry = previous;
    }
  }
}

export function renderStyleTags(registry: StyleRegistry, options?: RenderStyleTagsOptions): string {
  return registry.entries().map((entry) => {
    const nonce = options?.nonce ? ` nonce="${escapeHtml(options.nonce)}"` : "";
    const attrs = renderAttributes(entry.attributes);
    return `<style${nonce} data-tavo-style="${escapeHtml(entry.id)}"${attrs}>${escapeStyleText(entry.css)}</style>`;
  }).join("");
}

export function ensureClientStyle(id: string, css: string, options?: StyleOptions): void {
  if (typeof document === "undefined" || !id) {
    return;
  }
  const existing = findClientStyle(id);
  if (existing) {
    if (existing.hasAttribute("data-tavo-style-external")) {
      return;
    }
    if (existing.textContent !== css) {
      existing.textContent = css;
    }
    return;
  }
  const node = document.createElement("style");
  node.setAttribute("data-tavo-style", id);
  for (const [key, value] of Object.entries(options?.attributes ?? {})) {
    if (!isSafeAttributeName(key) || value === false) {
      continue;
    }
    node.setAttribute(key, value === true ? "" : String(value));
  }
  node.textContent = css;
  document.head.appendChild(node);
}

export function style(id: string, css: string, options?: StyleOptions): void {
  const registry = getActiveStyleRegistry();
  if (registry) {
    registry.add(id, css, options);
    return;
  }
  ensureClientStyle(id, css, options);
}

getGlobalStyleRuntime();
