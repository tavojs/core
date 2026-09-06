import { escapeHtml, isSafeAttributeName } from "./security.js";
import {
  getActiveComponent,
  registerComponentCleanup,
  registerComponentRenderFinalizer
} from "./runtime/dom/component-runtime.js";

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
  /** Explicit browser document that owns the style element. */
  ownerDocument?: Document;
};

export type RenderStyleTagsOptions = {
  nonce?: string;
};

type GlobalStyleRuntime = {
  activeStyleRegistry: StyleRegistry | null;
  getActiveStyleRegistry(): StyleRegistry | null;
  style(id: string, css: string, options?: StyleOptions): void;
};

type ClientStyleCache = WeakMap<Document, Map<string, HTMLStyleElement>>;
type ClientStyleOwnership = {
  persistent: boolean;
  references: number;
};
type ClientStyleOwnershipCache = WeakMap<Document, Map<string, ClientStyleOwnership>>;
type ComponentStyleEntry = {
  document: Document;
  release(): void;
  seenVersion: number;
};
type ComponentStyleState = {
  entries: Map<string, ComponentStyleEntry>;
};

const GLOBAL_STYLE_RUNTIME_KEY = Symbol.for("tavo.style.runtime");
const GLOBAL_CLIENT_STYLE_CACHE_KEY = Symbol.for("tavo.style.client-registry");
const GLOBAL_CLIENT_STYLE_OWNERSHIP_KEY = Symbol.for("tavo.style.client-ownership");
const componentStyleStates = new WeakMap<object, ComponentStyleState>();

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

function getGlobalClientStyleCache(): ClientStyleCache {
  const globalTarget = globalThis as typeof globalThis & {
    [GLOBAL_CLIENT_STYLE_CACHE_KEY]?: ClientStyleCache;
  };
  globalTarget[GLOBAL_CLIENT_STYLE_CACHE_KEY] ??= new WeakMap();
  return globalTarget[GLOBAL_CLIENT_STYLE_CACHE_KEY];
}

function getGlobalClientStyleOwnershipCache(): ClientStyleOwnershipCache {
  const globalTarget = globalThis as typeof globalThis & {
    [GLOBAL_CLIENT_STYLE_OWNERSHIP_KEY]?: ClientStyleOwnershipCache;
  };
  globalTarget[GLOBAL_CLIENT_STYLE_OWNERSHIP_KEY] ??= new WeakMap();
  return globalTarget[GLOBAL_CLIENT_STYLE_OWNERSHIP_KEY];
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

function getClientStyleRegistry(targetDocument: Document): Map<string, HTMLStyleElement> {
  const cache = getGlobalClientStyleCache();
  let styles = cache.get(targetDocument);
  if (!styles) {
    styles = new Map();
    for (const node of targetDocument.head.querySelectorAll<HTMLStyleElement>("style[data-tavo-style]")) {
      const id = node.getAttribute("data-tavo-style");
      if (id && !styles.has(id)) {
        styles.set(id, node);
      }
    }
    cache.set(targetDocument, styles);
  }
  return styles;
}

function getClientStyleOwnership(targetDocument: Document): Map<string, ClientStyleOwnership> {
  const cache = getGlobalClientStyleOwnershipCache();
  let ownership = cache.get(targetDocument);
  if (!ownership) {
    ownership = new Map();
    cache.set(targetDocument, ownership);
  }
  return ownership;
}

function resolveStyleDocument(options?: StyleOptions): Document | undefined {
  return options?.ownerDocument ?? (typeof document === "undefined" ? undefined : document);
}

function writeClientStyle(targetDocument: Document, id: string, css: string, options?: StyleOptions): HTMLStyleElement {
  const styles = getClientStyleRegistry(targetDocument);
  let existing = styles.get(id);
  if (existing && (!existing.isConnected || existing.ownerDocument !== targetDocument)) {
    styles.delete(id);
    existing = undefined;
  }
  if (existing) {
    if (!existing.hasAttribute("data-tavo-style-external") && existing.textContent !== css) {
      existing.textContent = css;
    }
    return existing;
  }
  const node = targetDocument.createElement("style");
  node.setAttribute("data-tavo-style", id);
  for (const [key, value] of Object.entries(options?.attributes ?? {})) {
    if (!isSafeAttributeName(key) || value === false) {
      continue;
    }
    node.setAttribute(key, value === true ? "" : String(value));
  }
  node.textContent = css;
  targetDocument.head.appendChild(node);
  styles.set(id, node);
  return node;
}

function retainOwnedClientStyle(targetDocument: Document, id: string, css: string, options?: StyleOptions): () => void {
  writeClientStyle(targetDocument, id, css, options);
  const ownership = getClientStyleOwnership(targetDocument);
  const entry = ownership.get(id) ?? { persistent: false, references: 0 };
  entry.references += 1;
  ownership.set(id, entry);
  let active = true;
  return () => {
    if (!active) {
      return;
    }
    active = false;
    entry.references = Math.max(0, entry.references - 1);
    if (entry.references > 0 || entry.persistent) {
      return;
    }
    const styles = getClientStyleRegistry(targetDocument);
    const node = styles.get(id);
    if (node && !node.hasAttribute("data-tavo-style-external")) {
      node.remove();
      styles.delete(id);
    }
    ownership.delete(id);
  };
}

function useComponentStyle(id: string, css: string, options?: StyleOptions): boolean {
  const component = getActiveComponent();
  if (!component) {
    return false;
  }
  const targetDocument = options?.ownerDocument ?? component.start.ownerDocument;
  let state = componentStyleStates.get(component);
  if (!state) {
    state = { entries: new Map() };
    componentStyleStates.set(component, state);
    const ownedState = state;
    registerComponentRenderFinalizer(() => {
      const version = component.runtime.renderVersion;
      for (const [styleId, entry] of ownedState.entries) {
        if (entry.seenVersion === version) {
          continue;
        }
        entry.release();
        ownedState.entries.delete(styleId);
      }
    });
    registerComponentCleanup(() => {
      for (const entry of ownedState.entries.values()) {
        entry.release();
      }
      ownedState.entries.clear();
      componentStyleStates.delete(component);
    });
  }

  const existing = state.entries.get(id);
  if (existing?.document === targetDocument) {
    writeClientStyle(targetDocument, id, css, options);
    existing.seenVersion = component.runtime.renderVersion;
    return true;
  }
  existing?.release();
  state.entries.set(id, {
    document: targetDocument,
    release: retainOwnedClientStyle(targetDocument, id, css, options),
    seenVersion: component.runtime.renderVersion
  });
  return true;
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
  return registry
    .entries()
    .map((entry) => {
      const nonce = options?.nonce ? ` nonce="${escapeHtml(options.nonce)}"` : "";
      const attrs = renderAttributes(entry.attributes);
      return `<style${nonce} data-tavo-style="${escapeHtml(entry.id)}"${attrs}>${escapeStyleText(entry.css)}</style>`;
    })
    .join("");
}

export function ensureClientStyle(id: string, css: string, options?: StyleOptions): void {
  const targetDocument = resolveStyleDocument(options);
  if (!targetDocument || !id) {
    return;
  }
  writeClientStyle(targetDocument, id, css, options);
  const ownership = getClientStyleOwnership(targetDocument);
  const entry = ownership.get(id) ?? { persistent: false, references: 0 };
  entry.persistent = true;
  ownership.set(id, entry);
}

/** Mounts an owner-document-scoped style and removes it after the last disposer runs. */
export function retainClientStyle(id: string, css: string, options?: StyleOptions): () => void {
  const targetDocument = resolveStyleDocument(options);
  if (!targetDocument || !id) {
    return () => {};
  }
  return retainOwnedClientStyle(targetDocument, id, css, options);
}

export function style(id: string, css: string, options?: StyleOptions): void {
  const registry = getActiveStyleRegistry();
  if (registry) {
    registry.add(id, css, options);
    return;
  }
  if (id && useComponentStyle(id, css, options)) {
    return;
  }
  ensureClientStyle(id, css, options);
}

getGlobalStyleRuntime();
