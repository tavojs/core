import type { Child } from "./jsx.js";
import { renderToProgressiveStringChunks } from "./render/progressive.js";
import { renderToString } from "./render/static.js";
import { escapeHtml, escapeScriptJson, isSafeAttributeName } from "./security.js";
import {
  createStyleRegistry,
  renderStyleTags,
  withStyleRegistry,
  type StyleRegistry
} from "./style.js";
import {
  createSeoRegistry,
  withSeoRegistry,
  type SeoRegistry
} from "./components/seo-registry.js";
import { renderSeoNodes } from "./components/seo.js";

export type RenderDocumentOptions = {
  lang?: string;
  title?: string;
  unsafeHeadHtml?: string;
  bodyAttributes?: Record<string, string | number | boolean>;
  htmlAttributes?: Record<string, string | number | boolean>;
  appAttributes?: Record<string, string | number | boolean>;
  doctype?: string;
  appContainerId?: string;
  initialState?: unknown;
  stateScriptId?: string;
  nonce?: string;
  beforeRender?: () => void;
  styleRegistry?: StyleRegistry;
};

function renderAttributes(attributes?: Record<string, string | number | boolean>): string {
  if (!attributes) {
    return "";
  }

  const parts: string[] = [];
  for (const [key, value] of Object.entries(attributes)) {
    if (!isSafeAttributeName(key)) {
      continue;
    }
    if (value === false) {
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

function serializeState(value: unknown): string {
  return escapeScriptJson(JSON.stringify(value));
}

function createDocumentParts(
  appHtml: string,
  options?: RenderDocumentOptions,
  styleTags = "",
  seoRegistry?: SeoRegistry
): {
  head: string;
  app: string;
  tail: string;
} {
  const {
    lang = "en",
    title = "",
    unsafeHeadHtml = "",
    bodyAttributes,
    htmlAttributes,
    appAttributes,
    doctype = "<!doctype html>",
    appContainerId = "app",
    initialState,
    stateScriptId = "__TAVO_STATE__",
    nonce
  } = options ?? {};

  const seo = seoRegistry?.value();
  const resolvedTitle = seo?.title ?? title;
  const titleTag = resolvedTitle.length > 0 ? `<title>${escapeHtml(resolvedTitle)}</title>` : "";
  const seoHead = seo ? renderToString(renderSeoNodes(seo)) : "";
  const stateTag =
    initialState === undefined
      ? ""
      : `<script id="${escapeHtml(stateScriptId)}"${nonce ? ` nonce="${escapeHtml(nonce)}"` : ""} type="application/json">${serializeState(initialState)}</script>`;

  return {
    head:
      `${doctype}<html lang="${escapeHtml(lang)}"${renderAttributes(htmlAttributes)}` +
      `><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">` +
      `${titleTag}${styleTags}${unsafeHeadHtml}${seoHead}</head><body${renderAttributes(bodyAttributes)}` +
      `><div id="${escapeHtml(appContainerId)}"${renderAttributes(appAttributes)}>`,
    app: appHtml,
    tail: `</div>${stateTag}</body></html>`
  };
}

function renderDocumentParts(node: Child, options?: RenderDocumentOptions): {
  head: string;
  app: string;
  tail: string;
} {
  options?.beforeRender?.();
  const registry = options?.styleRegistry ?? createStyleRegistry();
  const seoRegistry = createSeoRegistry();
  const appHtml = withStyleRegistry(registry, () =>
    withSeoRegistry(seoRegistry, () => renderToString(node))
  );
  return createDocumentParts(
    appHtml,
    options,
    renderStyleTags(registry, { nonce: options?.nonce }),
    seoRegistry
  );
}

export function renderDocument(node: Child, options?: RenderDocumentOptions): string {
  const parts = renderDocumentParts(node, options);
  return `${parts.head}${parts.app}${parts.tail}`;
}

export function renderDocumentStream(node: Child, options?: RenderDocumentOptions): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const abort = new AbortController();
  let cancelled = false;
  let parts: ReturnType<typeof createDocumentParts> | undefined;
  let registry: StyleRegistry;
  let chunks: ReturnType<typeof renderToProgressiveStringChunks> | undefined;
  const cancel = async (reason?: unknown) => {
    cancelled = true;
    abort.abort(reason);
    const pending = chunks;
    chunks = undefined;
    // return() can follow an in-flight next(); abort wakes that pending read first.
    await pending?.return().catch(() => {});
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled) return;
      try {
        if (!parts) {
          registry = options?.styleRegistry ?? createStyleRegistry();
          const seoRegistry = createSeoRegistry();
          options?.beforeRender?.();
          withStyleRegistry(registry, () =>
            withSeoRegistry(seoRegistry, () => renderToString(node))
          );
          if (cancelled) return;
          parts = createDocumentParts(
            "", options, renderStyleTags(registry, { nonce: options?.nonce }), seoRegistry
          );
          controller.enqueue(encoder.encode(parts.head));
          return;
        }
        chunks ??= renderToProgressiveStringChunks(node, {
          nonce: options?.nonce,
          beforeRender: options?.beforeRender,
          styleRegistry: registry,
          signal: abort.signal
        });
        const chunk = await chunks.next();
        if (cancelled) return;
        if (chunk.done) {
          controller.enqueue(encoder.encode(parts.tail));
          controller.close();
          chunks = undefined;
          return;
        }
        options?.beforeRender?.();
        if (!cancelled) controller.enqueue(encoder.encode(chunk.value));
      } catch (error) {
        if (!cancelled) {
          controller.error(error);
          await cancel(error);
        }
      }
    },
    cancel
  }, { highWaterMark: 0 });
}

function isServerRuntime(): boolean {
  return typeof (globalThis as { document?: unknown }).document === "undefined";
}

export function defineServerOnly<T extends (...args: any[]) => unknown>(fn: T): T {
  return ((...args: Parameters<T>): ReturnType<T> => {
    if (!isServerRuntime()) {
      throw new Error(
        "Tavo.js server-only function called in the browser. Move this call behind a server-only action, loader, or middleware."
      );
    }
    return fn(...args) as ReturnType<T>;
  }) as T;
}

export * from "./session/index.js";
export * from "./ssr/index.js";
export {
  createPagesRuntimeAsync,
  renderPagesResponseFromRuntimeAsync,
} from "./framework/index.js";
