import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { h } from "../../src/index.tsx";
import { renderPagesResponseAsync } from "../../src/framework/index.ts";
import { renderDocument, renderDocumentStream } from "../../src/server.ts";
import {
  createStyleRegistry,
  ensureClientStyle,
  renderStyleTags,
  style,
  withStyleRegistry
} from "../../src/style.ts";
import { resolveInlineViteStyleTags } from "../../src/ssr/vite-dev/style.ts";
import type { ViteDevServerLike } from "../../src/ssr/types.ts";

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    html += decoder.decode(value, { stream: true });
  }
  html += decoder.decode();
  return html;
}

test("style registry renders style tags with dedupe, nonce, and escaped text", () => {
  const registry = createStyleRegistry();
  withStyleRegistry(registry, () => {
    style("demo.card", ".card{color:red}</style><style>");
    style("demo.card", ".card{color:blue}");
  });

  const html = renderStyleTags(registry, { nonce: "abc123" });

  assert.match(html, /nonce="abc123"/);
  assert.match(html, /data-tavo-style="demo.card"/);
  assert.match(html, /\.card\{color:red\}<\\\/style><style>/);
  assert.doesNotMatch(html, /color:blue/);
});

test("renderDocument collects styles into document head", () => {
  function Card() {
    style("demo.card", ".card{color:red}");
    return h("article", { className: "card" }, "Card");
  }

  const html = renderDocument(h(Card, {}), { nonce: "abc123" });
  const styleIndex = html.indexOf('data-tavo-style="demo.card"');
  const bodyIndex = html.indexOf("<body");

  assert.ok(styleIndex > -1);
  assert.ok(styleIndex < bodyIndex);
  assert.match(html, /nonce="abc123"/);
  assert.match(html, /<article class="card">Card<\/article>/);
});

test("style registry uses an existing global runtime shared by linked module copies", () => {
  const key = Symbol.for("tavo.style.runtime");
  const globalTarget = globalThis as typeof globalThis & {
    [key]?: {
      activeStyleRegistry: ReturnType<typeof createStyleRegistry> | null;
      style(id: string, css: string): void;
    };
  };
  const previousRuntime = globalTarget[key];
  const sharedRuntime = {
    activeStyleRegistry: null as ReturnType<typeof createStyleRegistry> | null,
    style(id: string, css: string) {
      this.activeStyleRegistry?.add(id, css);
    }
  };

  globalTarget[key] = sharedRuntime;
  try {
    const registry = createStyleRegistry();
    withStyleRegistry(registry, () => {
      sharedRuntime.style("demo.shared", ".shared{display:block}");
    });

    assert.match(renderStyleTags(registry), /data-tavo-style="demo.shared"/);
  } finally {
    if (previousRuntime === undefined) {
      delete globalTarget[key];
    } else {
      globalTarget[key] = previousRuntime;
    }
  }
});

test("ensureClientStyle dedupes existing server-rendered style tags", () => {
  const dom = new JSDOM("<!doctype html><html><head><style data-tavo-style=\"demo.card\">.card{color:red}</style></head><body></body></html>");
  const previousDocument = globalThis.document;
  (globalThis as { document?: Document }).document = dom.window.document;
  try {
    ensureClientStyle("demo.card", ".card{color:blue}");
    ensureClientStyle("demo.panel", ".panel{color:green}");

    assert.equal(dom.window.document.head.querySelectorAll("style[data-tavo-style='demo.card']").length, 1);
    assert.equal(dom.window.document.head.querySelectorAll("style[data-tavo-style='demo.panel']").length, 1);
  } finally {
    if (previousDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      (globalThis as { document?: Document }).document = previousDocument;
    }
  }
});

test("ensureClientStyle repairs stale server-rendered style CSS", () => {
  const dom = new JSDOM("<!doctype html><html><head><style data-tavo-style=\"demo.responsive\"></style></head><body></body></html>");
  const previousDocument = globalThis.document;
  (globalThis as { document?: Document }).document = dom.window.document;
  try {
    ensureClientStyle("demo.responsive", ".demo{display:none}");

    const styleTags = dom.window.document.head.querySelectorAll("style");
    const styleTag = styleTags[0];
    assert.equal(styleTags.length, 1);
    assert.equal(styleTag.getAttribute("data-tavo-style"), "demo.responsive");
    assert.equal(styleTag.textContent, ".demo{display:none}");
  } finally {
    if (previousDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      (globalThis as { document?: Document }).document = previousDocument;
    }
  }
});

test("ensureClientStyle preserves externalized prerender style markers", () => {
  const dom = new JSDOM("<!doctype html><html><head><style data-tavo-style=\"demo.external\" data-tavo-style-external></style></head><body></body></html>");
  const previousDocument = globalThis.document;
  (globalThis as { document?: Document }).document = dom.window.document;
  try {
    ensureClientStyle("demo.external", ".external{display:grid}");

    const styleTag = dom.window.document.head.querySelector("style[data-tavo-style='demo.external']");
    assert.ok(styleTag);
    assert.equal(styleTag.textContent, "");
    assert.equal(styleTag.hasAttribute("data-tavo-style-external"), true);
  } finally {
    if (previousDocument === undefined) {
      delete (globalThis as { document?: Document }).document;
    } else {
      (globalThis as { document?: Document }).document = previousDocument;
    }
  }
});

test("pages SSR collects component styles", async () => {
  function Page() {
    style("demo.page", ".page{display:block}");
    return h("main", { className: "page" }, "Styled page");
  }

  const response = await renderPagesResponseAsync({
    "/src/pages/index.tsx": {
      default: Page
    }
  }, "/");

  assert.match(response.html, /data-tavo-style="demo.page"/);
  assert.match(response.html, /\.page\{display:block}/);
});

test("streaming SSR prepass emits styles before body content", async () => {
  function Page() {
    style("demo.stream", ".stream{display:grid}");
    return h("main", { className: "stream" }, "Streaming page");
  }

  const html = await readStream(renderDocumentStream(h(Page, {})));
  const styleIndex = html.indexOf('data-tavo-style="demo.stream"');
  const bodyTextIndex = html.indexOf("Streaming page");

  assert.ok(styleIndex > -1);
  assert.ok(bodyTextIndex > -1);
  assert.ok(styleIndex < bodyTextIndex);
});

test("Vite SSR dev emits current CSS modules as Vite-adoptable style tags", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-vite-style-"));
  const pageFile = path.join(root, "src/pages/index.tsx");
  const componentFile = path.join(root, "src/components/Hero.tsx");
  const styleFile = path.join(root, "src/components/Hero.module.scss");

  await fs.mkdir(path.dirname(pageFile), { recursive: true });
  await fs.mkdir(path.dirname(componentFile), { recursive: true });
  await fs.writeFile(pageFile, 'import { Hero } from "src/components/Hero";\nexport default Hero;');
  await fs.writeFile(componentFile, 'import styles from "./Hero.module.scss";\nexport function Hero() { return styles.hero; }');
  await fs.writeFile(styleFile, ".hero { min-height: 42rem; padding-top: 5rem; }");

  const vite = {
    middlewares() {},
    async transformRequest(id: string) {
      if (id === "/src/components/Hero.module.scss") {
        return {
          code: `const __vite__css = ${JSON.stringify(".stale-hero { min-height: 10rem; }")};`
        };
      }
      return null;
    },
    pluginContainer: {
      async resolveId(id: string, importer?: string) {
        if (id.startsWith("src/")) {
          const absolute = path.join(root, id);
          return { id: path.extname(absolute) ? absolute : `${absolute}.tsx` };
        }
        if (id.startsWith(".") && importer) {
          return { id: path.resolve(path.dirname(importer), id) };
        }
        return null;
      }
    },
    async ssrLoadModule(id: string) {
      if (id === "/src/components/Hero.module.scss?inline") {
        return {
          default: ".hero { min-height: 42rem; padding: 0 calc(var(--space) + var(--space)); } .hero + .hero { margin-top: 5rem; }"
        };
      }
      return {};
    },
    ssrFixStacktrace() {},
    async close() {}
  } satisfies ViteDevServerLike;

  try {
    const tags = await resolveInlineViteStyleTags(vite, root, "src/pages");

    assert.equal(tags.length, 1);
    assert.match(tags[0] ?? "", /type="text\/css"/);
    assert.match(
      tags[0] ?? "",
      new RegExp(`data-vite-dev-id="${styleFile.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`)
    );
    assert.doesNotMatch(tags[0] ?? "", /data-tavo-style=/);
    assert.match(
      tags[0] ?? "",
      /\.hero\{min-height:42rem;padding:0 calc\(var\(--space\) \+ var\(--space\)\)\}/
    );
    assert.match(tags[0] ?? "", /\.hero \+ \.hero\{margin-top:5rem\}/);
    assert.doesNotMatch(tags[0] ?? "", /stale-hero/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
