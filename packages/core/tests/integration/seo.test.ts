import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Seo, h } from "../../src/index.tsx";
import { bootTavo } from "../../src/client.ts";
import { applyResolvedHead } from "../../src/auto-pages/state.ts";
import {
  renderPagesResponseAsync,
  renderPagesStreamResponseAsync
} from "../../src/framework/index.ts";
import { normalizeHead } from "../../src/framework/runtime/head.ts";

function seoModules(title = "Page title", description = "Page description") {
  return {
    "/src/pages/index.tsx": {
      default: () => h("main", { id: "content" },
        h(Seo, {
          title,
          description,
          canonical: "https://example.test/page",
          robots: "index, follow",
          keywords: ["tavo", "framework"],
          openGraph: {
            title: `${title} OG`,
            description: `${description} OG`,
            type: "website"
          },
          twitter: {
            card: "summary_large_image",
            title: `${title} Twitter`
          }
        }),
        h("h1", null, title)
      )
    }
  };
}

function parse(html: string): Document {
  return new JSDOM(html).window.document;
}

test("seo: SSR hoists component metadata into head and replaces the document title", async () => {
  const response = await renderPagesResponseAsync(seoModules(), "/", {
    document: { title: "Fallback title" }
  });
  const document = parse(response.html);

  assert.equal(document.head.querySelectorAll("title").length, 1);
  assert.equal(document.title, "Page title");
  assert.equal(document.head.querySelector('meta[name="description"]')?.getAttribute("content"), "Page description");
  assert.equal(document.head.querySelector('meta[name="keywords"]')?.getAttribute("content"), "tavo, framework");
  assert.equal(document.head.querySelector('meta[name="robots"]')?.getAttribute("content"), "index, follow");
  assert.equal(document.head.querySelector('meta[property="og:title"]')?.getAttribute("content"), "Page title OG");
  assert.equal(document.head.querySelector('meta[name="twitter:title"]')?.getAttribute("content"), "Page title Twitter");
  assert.equal(document.head.querySelector('link[rel="canonical"]')?.getAttribute("href"), "https://example.test/page");
  assert.equal(document.querySelector("#app title, #app meta, #app link[rel=canonical]"), null);
});

test("seo: route head exports normalize Seo metadata", async () => {
  const response = await renderPagesResponseAsync({
    "/src/pages/generated.tsx": {
      head: h(Seo, {
        title: "Generated title",
        description: "Generated description"
      }),
      default: () => h("main", null, "Generated page")
    }
  }, "/generated");
  const document = parse(response.html);

  assert.equal(document.title, "Generated title");
  assert.equal(
    document.head.querySelector('meta[name="description"]')?.getAttribute("content"),
    "Generated description"
  );
  assert.equal(document.querySelector("#app title, #app meta"), null);
});

test("seo: route head exports update metadata during client navigation", () => {
  const dom = new JSDOM(
    "<!doctype html><html><head><title>Initial</title></head><body></body></html>",
    { url: "http://localhost/first" },
  );
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    const firstHead = normalizeHead(h(Seo, {
      title: "First route",
      description: "First description",
    }));
    applyResolvedHead({ head: firstHead } as any);
    assert.equal(dom.window.document.title, "First route");
    assert.equal(
      dom.window.document.head.querySelector('meta[name="description"]')?.getAttribute("content"),
      "First description",
    );

    const nextHead = normalizeHead([
      h(Seo, {
        title: "Next route",
        description: "Next description",
      }),
      h("meta", {
        name: "robots",
        content: "noindex",
      }),
    ]);
    applyResolvedHead({ head: nextHead } as any);

    assert.equal(dom.window.document.title, "Next route");
    assert.equal(dom.window.document.head.querySelectorAll('meta[name="description"]').length, 1);
    assert.equal(
      dom.window.document.head.querySelector('meta[name="description"]')?.getAttribute("content"),
      "Next description",
    );
    assert.equal(
      dom.window.document.head.querySelector('meta[name="robots"]')?.getAttribute("content"),
      "noindex",
    );
    assert.doesNotMatch(dom.window.document.head.innerHTML, /First description/);

    applyResolvedHead({ head: {} } as any);
    assert.equal(dom.window.document.title, "Initial");
    assert.equal(dom.window.document.head.querySelector('meta[name="description"]'), null);
  } finally {
    globalThis.document = previousDocument;
    dom.window.close();
  }
});

test("seo: page route metadata overrides keyed layout metadata during SSR", async () => {
  const response = await renderPagesResponseAsync({
    "/src/pages/_layout.tsx": {
      head: h(Seo, {
        title: "Layout title",
        description: "Layout description",
      }),
      default: ({ children }: any) => h("div", null, children),
    },
    "/src/pages/index.tsx": {
      head: h(Seo, {
        title: "Page title",
        description: "Page description",
      }),
      default: () => h("main", null, "Page"),
    },
  }, "/");
  const document = parse(response.html);

  assert.equal(document.title, "Page title");
  assert.equal(document.head.querySelectorAll('meta[name="description"]').length, 1);
  assert.equal(
    document.head.querySelector('meta[name="description"]')?.getAttribute("content"),
    "Page description",
  );
});

test("seo: route head layers preserve contribution order around keyed metadata", async () => {
  const response = await renderPagesResponseAsync({
    "/src/pages/_layout.tsx": {
      head: h(Seo, { description: "Layout description" }),
      default: ({ children }: any) => h("div", null, children),
    },
    "/src/pages/index.tsx": {
      head: h("meta", {
        name: "description",
        content: "Page description",
      }),
      default: () => h("main", null, "Page"),
    },
  }, "/");
  const descriptions = Array.from(
    parse(response.html).head.querySelectorAll('meta[name="description"]'),
    (node) => node.getAttribute("content"),
  );

  assert.deepEqual(descriptions, ["Layout description", "Page description"]);
});

test("seo: mixed route head nodes preserve their order within one export", async () => {
  const modules = {
    "/src/pages/seo-first.tsx": {
      head: [
        h(Seo, { description: "SEO first" }),
        h("meta", { name: "description", content: "Raw second" }),
      ],
      default: () => h("main", null, "SEO first"),
    },
    "/src/pages/seo-last.tsx": {
      head: [
        h("meta", { name: "description", content: "Raw first" }),
        h(Seo, { description: "SEO second" }),
      ],
      default: () => h("main", null, "SEO second"),
    },
  };
  const [seoFirst, seoLast] = await Promise.all([
    renderPagesResponseAsync(modules, "/seo-first"),
    renderPagesResponseAsync(modules, "/seo-last"),
  ]);
  const descriptions = (html: string) => Array.from(
    parse(html).head.querySelectorAll('meta[name="description"]'),
    (node) => node.getAttribute("content"),
  );

  assert.deepEqual(descriptions(seoFirst.html), ["SEO first", "Raw second"]);
  assert.deepEqual(descriptions(seoLast.html), ["Raw first", "SEO second"]);
});

test("seo: multiple declarations retain distinct metadata positions", async () => {
  const response = await renderPagesResponseAsync({
    "/src/pages/index.tsx": {
      head: [
        h(Seo, { description: "SEO first" }),
        h("meta", { name: "robots", content: "Raw middle" }),
        h(Seo, { title: "SEO last" }),
      ],
      default: () => h("main", null, "Page"),
    },
  }, "/");
  const nodes = Array.from(
    parse(response.html).head.querySelectorAll(
      'meta[name="description"], meta[name="robots"], meta[property="og:title"]',
    ),
    (node) =>
      node.getAttribute("content"),
  );

  assert.deepEqual(nodes, ["SEO first", "Raw middle", "SEO last"]);
});

test("seo: explicit nested metadata survives later top-level fallbacks", async () => {
  const response = await renderPagesResponseAsync({
    "/src/pages/index.tsx": {
      head: [
        h(Seo, { twitter: { title: "Explicit Twitter" } }),
        h("meta", { name: "robots", content: "Raw middle" }),
        h(Seo, { title: "Later page" }),
      ],
      default: () => h("main", null, "Page"),
    },
  }, "/");
  const document = parse(response.html);

  assert.equal(
    document.head.querySelector('meta[name="twitter:title"]')
      ?.getAttribute("content"),
    "Explicit Twitter",
  );
  assert.equal(
    document.head.querySelector('meta[property="og:title"]')
      ?.getAttribute("content"),
    "Later page",
  );
});

test("seo: client navigation restores the configured title after SSR hydration", async () => {
  const response = await renderPagesResponseAsync({
    "/src/pages/index.tsx": {
      head: { title: "Initial route" },
      default: () => h("main", null, "Initial"),
    },
  }, "/", {
    document: { title: "Application fallback" },
  });
  const dom = new JSDOM(response.html, { url: "http://localhost/" });
  const previousDocument = globalThis.document;
  globalThis.document = dom.window.document;
  try {
    applyResolvedHead(response.resolved);
    assert.equal(dom.window.document.title, "Initial route");

    applyResolvedHead({ head: {} } as any);
    assert.equal(dom.window.document.title, "Application fallback");
  } finally {
    globalThis.document = previousDocument;
    dom.window.close();
  }
});

test("seo: later page declarations override layout defaults deterministically", async () => {
  const modules = {
    "/src/pages/_layout.tsx": {
      default: ({ children }: any) => h("div", null,
        h(Seo, {
          title: "Layout title",
          description: "Layout description",
          openGraph: { siteName: "Layout site", title: "Layout OG" }
        }),
        children
      )
    },
    "/src/pages/index.tsx": {
      default: () => h("main", null,
        h(Seo, {
          title: "Page title",
          description: "Page description",
          openGraph: { title: "Page OG" }
        })
      )
    }
  };
  const response = await renderPagesResponseAsync(modules, "/");
  const document = parse(response.html);

  assert.equal(document.title, "Page title");
  assert.equal(document.head.querySelectorAll('meta[name="description"]').length, 1);
  assert.equal(document.head.querySelector('meta[name="description"]')?.getAttribute("content"), "Page description");
  assert.equal(document.head.querySelector('meta[property="og:title"]')?.getAttribute("content"), "Page OG");
  assert.equal(document.head.querySelector('meta[property="og:site_name"]')?.getAttribute("content"), "Layout site");
});

test("seo: concurrent SSR documents do not leak metadata", async () => {
  const [alpha, beta] = await Promise.all([
    renderPagesResponseAsync(seoModules("Alpha", "Alpha description"), "/"),
    renderPagesResponseAsync(seoModules("Beta", "Beta description"), "/")
  ]);

  assert.equal(parse(alpha.html).title, "Alpha");
  assert.equal(parse(beta.html).title, "Beta");
  assert.doesNotMatch(alpha.html, /Beta description/);
  assert.doesNotMatch(beta.html, /Alpha description/);
});

test("seo: streaming SSR emits metadata in head before application content", async () => {
  const response = await renderPagesStreamResponseAsync(seoModules("Stream title", "Stream description"), "/");
  const html = await new Response(response.stream).text();
  const document = parse(html);

  assert.equal(document.title, "Stream title");
  assert.equal(document.head.querySelector('meta[name="description"]')?.getAttribute("content"), "Stream description");
  assert.equal(document.querySelector("#app title, #app meta, #app link[rel=canonical]"), null);
  assert.ok(html.indexOf("Stream description") < html.indexOf("<body"));
});

test("seo: hydration replaces managed SSR metadata instead of duplicating it", async () => {
  const modules = seoModules("Hydrated title", "Hydrated description");
  const response = await renderPagesResponseAsync(modules, "/");
  const dom = new JSDOM(response.html, { url: "http://localhost/" });
  const previous = {
    window: globalThis.window,
    document: globalThis.document,
    Node: globalThis.Node,
    HTMLElement: globalThis.HTMLElement,
    Text: globalThis.Text
  };
  Object.assign(globalThis, {
    window: dom.window,
    document: dom.window.document,
    Node: dom.window.Node,
    HTMLElement: dom.window.HTMLElement,
    Text: dom.window.Text
  });
  try {
    await bootTavo({ modules });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(dom.window.document.head.querySelectorAll('meta[name="description"]').length, 1);
    assert.equal(dom.window.document.head.querySelectorAll('link[rel="canonical"]').length, 1);
    assert.equal(dom.window.document.querySelector("#app title, #app meta, #app link[rel=canonical]"), null);
  } finally {
    Object.assign(globalThis, previous);
    dom.window.close();
  }
});
