import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { bootTavo } from "../../src/client.ts";
import { createI18n } from "../../src/i18n/index.ts";
import { Deferred, createStore, h } from "../../src/index.tsx";
import { createRoot } from "../../src/dom.ts";
import { renderPagesResponseAsync } from "../../src/framework/index.ts";

type GlobalWithDom = typeof globalThis & {
  window?: Window & typeof globalThis;
  document?: Document;
  Node?: typeof Node;
  HTMLElement?: typeof HTMLElement;
  Text?: typeof Text;
  Event?: typeof Event;
  MouseEvent?: typeof MouseEvent;
  PopStateEvent?: typeof PopStateEvent;
};

function setupDom(markup: string, url: string) {
  const dom = new JSDOM(markup, { url });
  const globalRef = globalThis as GlobalWithDom;
  globalRef.window = dom.window as unknown as Window & typeof globalThis;
  globalRef.document = dom.window.document;
  globalRef.Node = dom.window.Node;
  globalRef.HTMLElement = dom.window.HTMLElement;
  globalRef.Text = dom.window.Text;
  globalRef.Event = dom.window.Event;
  globalRef.MouseEvent = dom.window.MouseEvent;
  globalRef.PopStateEvent = dom.window.PopStateEvent;
  return dom;
}

function clearDom() {
  const globalRef = globalThis as GlobalWithDom;
  delete globalRef.window;
  delete globalRef.document;
  delete globalRef.Node;
  delete globalRef.HTMLElement;
  delete globalRef.Text;
  delete globalRef.Event;
  delete globalRef.MouseEvent;
  delete globalRef.PopStateEvent;
}

function nextTick(ms = 25) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test("parity: SSR output hydrates and navigates with stable layout, params, i18n, and store state", async () => {
  let rootLoadCalls = 0;
  let blogLoadCalls = 0;
  let docsLoadCalls = 0;
  const visits = createStore({ count: 0 });
  const i18n = createI18n({
    defaultLocale: "es",
    fallbackLocale: "en",
    serviceName: false,
    messages: {
      en: { route: { label: "Hello" } },
      es: { route: { label: "Hola" } }
    }
  });
  const modules = {
    "/src/pages/_root.tsx": {
      load: async ({ pathname }: { pathname: string }) => {
        rootLoadCalls += 1;
        return { shell: "root", pathname };
      },
      default: (props: any) =>
        h("section", { id: "root" }, h("span", { id: "root-shell" }, `root:${props.data?.shell}`), props.children)
    },
    "/src/pages/_layout.tsx": {
      default: (props: any) =>
        h("div", { id: "layout" }, h("span", { id: "layout-shell" }, "layout:"), props.children)
    },
    "/src/pages/index.tsx": {
      default: () => h("main", null, h("a", { href: "/blog/ada" }, "Blog Ada"))
    },
    "/src/pages/blog/[id].tsx": {
      load: async ({ params, url }: { params: Record<string, string>; url: URL }) => {
        blogLoadCalls += 1;
        visits.patch({ count: visits.getState().count + 1 });
        return { id: params.id, from: url.searchParams.get("from") };
      },
      default: (props: any) =>
        h(
          "main",
          null,
          h("h1", null, `${i18n.t("route.label")} ${props.params.id}`),
          h("p", { id: "data" }, `data:${props.data?.id}:${props.data?.from}`),
          h("p", { id: "visits" }, `visits:${visits.getState().count}`),
          h("a", { href: "/docs/intro" }, "Docs intro")
        )
    },
    "/src/pages/docs/[[section]].tsx": {
      load: async ({ params }: { params: Record<string, string | undefined> }) => {
        docsLoadCalls += 1;
        return { section: params.section ?? "none" };
      },
      default: (props: any) => h("main", null, `docs:${props.data?.section}:${i18n.t("route.label")}`)
    }
  };

  const response = await renderPagesResponseAsync(modules, "/blog/ada", {
    i18n,
    request: new Request("http://localhost/blog/ada?from=ssr")
  });
  assert.equal(response.status, 200);
  assert.match(response.html, /<html lang="es"/);
  assert.match(response.html, /root:root/);
  assert.match(response.html, /layout:/);
  assert.match(response.html, /Hola ada/);
  assert.match(response.html, /data:ada:ssr/);
  assert.match(response.html, /visits:1/);
  assert.equal(rootLoadCalls, 1);
  assert.equal(blogLoadCalls, 1);

  visits.patch({ count: 0 });
  const dom = setupDom("<!doctype html><html><body><div id=\"app\"></div></body></html>", "http://localhost/");
  try {
    const result = await bootTavo({ modules, i18n });
    assert.equal(result.mode, "client");
    await nextTick();

    const blogLink = dom.window.document.querySelector<HTMLAnchorElement>("a[href='/blog/ada']");
    assert.ok(blogLink);
    blogLink.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick(50);

    assert.equal(dom.window.document.querySelector("#visits")?.textContent, "visits:1");

    const link = dom.window.document.querySelector<HTMLAnchorElement>("a[href='/docs/intro']");
    assert.ok(link);
    link.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true, cancelable: true }));
    await nextTick(50);

    assert.equal(dom.window.location.pathname, "/docs/intro");
    assert.equal(docsLoadCalls, 1);
    assert.equal(dom.window.document.querySelector("main")?.textContent, "docs:intro:Hola");
  } finally {
    clearDom();
  }
});

test("parity: CSR-only routes skip SSR body output and mount loader data in the browser", async () => {
  let loadCalls = 0;
  let renderCalls = 0;
  const modules = {
    "/src/pages/csr.tsx": {
      render: "csr" as const,
      load: async () => {
        loadCalls += 1;
        return { name: "client" };
      },
      default: ({ data }: { data?: { name?: string } }) => {
        renderCalls += 1;
        return h("main", null, `csr:${data?.name ?? "missing"}`);
      }
    }
  };

  const response = await renderPagesResponseAsync(modules, "/csr");
  assert.equal(response.resolved.renderMode, "csr");
  assert.doesNotMatch(response.html, /csr:/);
  assert.equal(loadCalls, 0);
  assert.equal(renderCalls, 0);

  const dom = setupDom(response.html, "http://localhost/csr");
  try {
    const result = await bootTavo({ modules });
    assert.equal(result.mode, "client");
    await nextTick();

    assert.equal(loadCalls, 1);
    assert.ok(renderCalls >= 1);
    assert.equal(dom.window.document.querySelector("main")?.textContent, "csr:client");
  } finally {
    clearDom();
  }
});

test("parity: deferred hydration reuses server state instead of restoring fallback text", async () => {
  const dom = setupDom(
    '<!doctype html><html><body><script id="__TAVO_STATE__" type="application/json">{"enabled":true}</script><div id="app"></div></body></html>',
    "http://localhost/deferred"
  );
  try {
    (dom.window as Window & typeof globalThis & {
      __TAVO_DEFERRED__?: Record<string, { status: "resolved"; data: unknown }>;
    }).__TAVO_DEFERRED__ = {
      parity: { status: "resolved", data: "ready" }
    };
    const app = dom.window.document.getElementById("app");
    assert.ok(app);
    createRoot(app).render(
      h(
        Deferred,
        {
          id: "parity",
          value: new Promise<string>(() => {}),
          fallback: h("span", null, "loading")
        },
        (value: string) => h("strong", null, `deferred:${value}`)
      )
    );
    await nextTick(50);

    assert.equal(dom.window.document.querySelector("strong")?.textContent, "deferred:ready");
    assert.doesNotMatch(dom.window.document.body.textContent ?? "", /loading/);
  } finally {
    clearDom();
  }
});
