import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Deferred, TavoController, createStore, createTavo, h, renderToString } from "../../src/index.tsx";
import {
  bootTavo as bootTavoRuntime,
  getTavoBootMode,
  resolveTavoActionUrl
} from "../../src/client.ts";
import { createRoot } from "../../src/dom.ts";
import { configureDevDiagnostics } from "../../src/dev.ts";
import { defineServerOnly } from "../../src/server.ts";
import { flushSync, startTransition } from "../../src/scheduler.ts";
import { inspectTavoRuntime, installTavoDevtoolsPanel } from "../../src/devtools.ts";
import { navigate } from "../../src/router/index.ts";
import {
  createPagesRuntime,
  defineMiddleware,
  defineServerLoader,
  defineServerMiddleware,
  inspectPages,
  isClientRuntime,
  isServerRuntime,
  renderPagesResponseAsync,
  renderPagesResponseFromRuntimeAsync
} from "../../src/framework/index.ts";

type GlobalWithDom = typeof globalThis & {
  window?: Window & typeof globalThis;
  document?: Document;
  FormData?: typeof FormData;
  HTMLFormElement?: typeof HTMLFormElement;
  Node?: typeof Node;
  SubmitEvent?: typeof SubmitEvent;
  HTMLElement?: typeof HTMLElement;
  Text?: typeof Text;
};

const mountedBootRoots = new Set<
  Extract<Awaited<ReturnType<typeof bootTavoRuntime>>, { mode: "client" }>["root"]
>();

async function bootTavo(...args: Parameters<typeof bootTavoRuntime>) {
  const result = await bootTavoRuntime(...args);
  if (result.mode === "client") {
    mountedBootRoots.add(result.root);
  }
  return result;
}

function setupDom(markup: string, options?: { url?: string }) {
  const dom = new JSDOM(markup, options);
  const globalRef = globalThis as GlobalWithDom;
  globalRef.window = dom.window as unknown as Window & typeof globalThis;
  globalRef.document = dom.window.document;
  globalRef.FormData = dom.window.FormData;
  globalRef.HTMLFormElement = dom.window.HTMLFormElement;
  globalRef.Node = dom.window.Node;
  globalRef.SubmitEvent = dom.window.SubmitEvent;
  globalRef.HTMLElement = dom.window.HTMLElement;
  globalRef.Text = dom.window.Text;
  return dom;
}

function clearDom() {
  for (const root of mountedBootRoots) {
    root.unmount();
  }
  mountedBootRoots.clear();
  const globalRef = globalThis as GlobalWithDom;
  delete globalRef.window;
  delete globalRef.document;
  delete globalRef.FormData;
  delete globalRef.HTMLFormElement;
  delete globalRef.Node;
  delete globalRef.SubmitEvent;
  delete globalRef.HTMLElement;
  delete globalRef.Text;
}

async function waitFor(predicate: () => boolean, timeoutMs = 100): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

test("bootTavo hydrates pages SSR documents with serialized state", async () => {
  class CounterController extends TavoController {
    declare model: { getState(): { count: number }; patch(next: { count: number }): void };

    increment() {
      this.model.patch({ count: this.model.getState().count + 1 });
    }
  }

  const Counter = createTavo({
    model: () => ({ count: 1 }),
    controller: CounterController,
    view: ({ state, controller }) =>
      h("button", { type: "button", onClick: () => controller?.increment() }, String(state.count))
  });

  const modules = {
    "/src/pages/index.tsx": {
      default: () => h(Counter, {})
    }
  };

  const response = await renderPagesResponseAsync(modules, "/");
  assert.match(response.html, /id="__TAVO_STATE__"/);

  const dom = setupDom(response.html, { url: "http://localhost/" });
  const button = dom.window.document.querySelector("button");
  assert.ok(button);
  assert.equal(button.textContent, "1");

  const result = await bootTavo({ modules });
  assert.equal(result.mode, "client");

  button.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(button.textContent, "2");
  clearDom();
});

test("bootTavo renders a route pending export during client navigation", async () => {
  let releasePageLoad!: () => void;
  class PendingController extends TavoController {
    onInit() {
      this.model.patch({
        route: this.page.route?.path ?? "missing"
      });
    }
  }
  const Pending = createTavo({
    model: () => ({ route: "missing" }),
    controller: PendingController,
    view: ({ state }) => h(
      "main",
      {
        "data-pending": "true",
        "data-pending-route": state.route
      },
      "Loading report"
    )
  });
  const lazyReport = Object.assign(async () => ({
    pending: Pending,
    load: () => new Promise<{ title: string }>((resolve) => {
      releasePageLoad = () => resolve({ title: "Annual report" });
    }),
    default: ({ data }: { data: { title: string } }) =>
      h("main", { "data-report": "true" }, data.title)
  }), { __tavo_loader__: true as const });
  const modules = {
    "/src/pages/index.tsx": {
      default: () => h("main", null,
        h("a", { href: "/report" }, "Open report")
      )
    },
    "/src/pages/report.tsx": lazyReport
  };
  const dom = setupDom(
    `<!doctype html><html><body><div id="app"></div></body></html>`,
    { url: "http://localhost/" }
  );

  await bootTavo({ modules });
  await waitFor(() => dom.window.document.querySelector("a") !== null);
  navigate("/report");

  await waitFor(() => dom.window.document.querySelector("[data-pending='true']") !== null);
  assert.equal(dom.window.location.pathname, "/report");
  assert.equal(
    dom.window.document.querySelector("[data-pending='true']")?.textContent,
    "Loading report"
  );
  assert.equal(
    dom.window.document.querySelector("[data-pending='true']")?.getAttribute("data-pending-route"),
    "/report"
  );
  releasePageLoad();
  await waitFor(() => dom.window.document.querySelector("[data-report='true']") !== null);
  assert.equal(dom.window.document.querySelector("main")?.textContent, "Annual report");
  assert.equal(dom.window.document.querySelector("[data-pending='true']"), null);
  clearDom();
});

test("bootTavo preserves a static SSR page when hydrating a trailing-slash URL", async () => {
  const docsModule = {
    default: () => h("main", null, h("h1", null, "Documentation"))
  };
  const notFoundModule = {
    default: () => h("main", null, "Page not found")
  };
  const response = await renderPagesResponseAsync(
    {
      "/src/pages/docs/index.tsx": docsModule,
      "/src/pages/404.tsx": notFoundModule
    },
    "/docs/"
  );
  assert.equal(response.status, 200);
  assert.match(response.html, /<h1>Documentation<\/h1>/);

  let docsLoads = 0;
  let notFoundLoads = 0;
  const lazyDocs = Object.assign(async () => {
    docsLoads += 1;
    return docsModule;
  }, { __tavo_loader__: true as const });
  const lazyNotFound = Object.assign(async () => {
    notFoundLoads += 1;
    return notFoundModule;
  }, { __tavo_loader__: true as const });
  const dom = setupDom(response.html, { url: "http://localhost/docs/" });

  try {
    const result = await bootTavo({
      modules: {
        "/src/pages/docs/index.tsx": lazyDocs,
        "/src/pages/404.tsx": lazyNotFound
      }
    });
    assert.equal(result.mode, "client");
    await waitFor(() => dom.window.document.querySelector("h1")?.textContent === "Documentation");

    assert.equal(dom.window.location.pathname, "/docs/");
    assert.equal(dom.window.document.querySelector("h1")?.textContent, "Documentation");
    assert.equal(docsLoads, 1);
    assert.equal(notFoundLoads, 0);
  } finally {
    clearDom();
  }
});

test("getTavoBootMode reports server without a browser document", () => {
  assert.equal(getTavoBootMode(), "server");
});

test("getTavoBootMode reports csr for static browser documents", () => {
  setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/"
  });
  try {
    assert.equal(getTavoBootMode(), "csr");
  } finally {
    clearDom();
  }
});

test("getTavoBootMode reports ssr for hydration documents", () => {
  setupDom(
    `<!doctype html><html><body><script id="__TAVO_STATE__" type="application/json">{}</script><div id="app"></div></body></html>`,
    { url: "http://localhost/" }
  );
  try {
    assert.equal(getTavoBootMode(), "ssr");
  } finally {
    clearDom();
  }
});

test("getTavoBootMode reports csr when an SSR shell contains a CSR route", () => {
  setupDom(
    `<!doctype html><html><body><script id="__TAVO_STATE__" type="application/json">{}</script><div id="app" data-tavo-render-mode="csr"></div></body></html>`,
    { url: "http://localhost/" }
  );
  try {
    assert.equal(getTavoBootMode(), "csr");
  } finally {
    clearDom();
  }
});

test("getTavoBootMode reports none when the client root is missing", () => {
  setupDom(`<!doctype html><html><body></body></html>`, {
    url: "http://localhost/"
  });
  try {
    assert.equal(getTavoBootMode(), "none");
  } finally {
    clearDom();
  }
});

test("resolveTavoActionUrl falls back to the route action path without csrActions", async () => {
  const modules = {
    "/src/pages/login.tsx": {
      default: () => h("main", null, resolveTavoActionUrl("/login"))
    }
  };
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/login"
  });
  try {
    await bootTavo({ modules });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(dom.window.document.querySelector("main")?.textContent, "/login");
  } finally {
    clearDom();
  }
});

test("resolveTavoActionUrl uses the active csrActions URL mapping", async () => {
  const modules = {
    "/src/pages/login.tsx": {
      default: () => h("main", null, resolveTavoActionUrl("/login"))
    }
  };
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/login"
  });
  try {
    await bootTavo({
      modules,
      csrActions: {
        enabled: true,
        resolveUrl({ pathname }) {
          return pathname === "/login"
            ? "https://api.example.com/auth/login"
            : `https://api.example.com${pathname}`;
        }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(dom.window.document.querySelector("main")?.textContent, "https://api.example.com/auth/login");
  } finally {
    clearDom();
  }
});

test("resolveTavoActionUrl keeps SSR hydration on the route action path", async () => {
  const modules = {
    "/src/pages/login.tsx": {
      default: () => h("main", null, resolveTavoActionUrl("/login"))
    }
  };
  const response = await renderPagesResponseAsync(modules, "/login");
  assert.match(response.html, />\/login</);

  const dom = setupDom(response.html, {
    url: "http://localhost/login"
  });
  try {
    await bootTavo({
      modules,
      csrActions: {
        enabled: true,
        resolveUrl({ pathname }) {
          return pathname === "/login"
            ? "https://api.example.com/auth/login"
            : `https://api.example.com${pathname}`;
        }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    assert.equal(getTavoBootMode(), "ssr");
    assert.equal(dom.window.document.querySelector("main")?.textContent, "/login");
  } finally {
    clearDom();
  }
});

test("bootTavo reuses SSR loader data without rerunning the initial load", async () => {
  let loadCalls = 0;

  const Profile = createTavo({
    model: (props: { data?: { name?: string } }) => ({
      name: props.data?.name ?? "missing"
    }),
    view: ({ state }) => h("main", null, `name:${state.name}`)
  });
  const modules = {
    "/src/pages/profile.tsx": {
      load: async () => {
        loadCalls += 1;
        return { name: "Ada" };
      },
      default: Profile
    }
  };

  const response = await renderPagesResponseAsync(modules, "/profile");
  assert.equal(loadCalls, 1);
  assert.match(response.html, /id="__TAVO_STATE__"/);
  assert.match(response.html, /name:Ada/);

  const dom = setupDom(response.html, { url: "http://localhost/profile" });
  const result = await bootTavo({ modules });
  assert.equal(result.mode, "client");

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(loadCalls, 1);
  assert.equal(dom.window.document.querySelector("main")?.textContent, "name:Ada");
  clearDom();
});

test("bootTavo reuses SSR root layout loader data without rerunning load on hydration", async () => {
  let rootLoadCalls = 0;

  const Root = ({ children }: { children?: unknown }) => h("section", null, children);
  const Home = () => h("main", null, "Home");
  const modules = {
    "/src/pages/_root.tsx": {
      load: async () => {
        rootLoadCalls += 1;
      },
      default: Root
    },
    "/src/pages/index.tsx": {
      default: Home
    }
  };

  const response = await renderPagesResponseAsync(modules, "/");
  assert.equal(rootLoadCalls, 1);
  assert.match(response.html, /id="__TAVO_STATE__"/);
  assert.match(response.html, /Home/);

  const dom = setupDom(response.html, { url: "http://localhost/" });
  const result = await bootTavo({ modules });
  assert.equal(result.mode, "client");

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(rootLoadCalls, 1);
  assert.equal(dom.window.document.querySelector("main")?.textContent, "Home");
  clearDom();
});

test("defineServerLoader runs during SSR and is skipped during CSR route resolution", async () => {
  let loadCalls = 0;
  const modules = {
    "/src/pages/server-data.tsx": {
      load: defineServerLoader(async () => {
        loadCalls += 1;
        return { name: "Ada" };
      }),
      default: ({ data }: { data?: { name?: string } }) => h("main", null, data?.name ?? "missing")
    }
  };

  const response = await renderPagesResponseAsync(modules, "/server-data");
  assert.deepEqual(response.resolved.data, { name: "Ada" });
  assert.equal(loadCalls, 1);

  setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/server-data"
  });
  try {
    const runtime = createPagesRuntime(modules);
    const resolved = await runtime.resolvePathAsync("/server-data");
    assert.equal(resolved.data, null);
    assert.equal(loadCalls, 1);
    assert.equal(renderToString(resolved.node), "<main>missing</main>");
  } finally {
    clearDom();
  }
});

test("defineServerLoader skips root layout loaders during CSR route resolution", async () => {
  let rootLoadCalls = 0;
  const modules = {
    "/src/pages/_root.tsx": {
      load: defineServerLoader(async () => {
        rootLoadCalls += 1;
        return { user: { id: "1", name: "Ada" } };
      }),
      default: ({ children }: { children?: unknown }) => h("section", null, children)
    },
    "/src/pages/index.tsx": {
      default: () => h("main", null, "Home")
    }
  };

  const response = await renderPagesResponseAsync(modules, "/");
  assert.deepEqual(response.resolved.layers[0]?.data, { user: { id: "1", name: "Ada" } });
  assert.equal(rootLoadCalls, 1);

  setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/"
  });
  try {
    const runtime = createPagesRuntime(modules);
    const resolved = await runtime.resolvePathAsync("/");
    assert.equal(resolved.layers[0]?.data, null);
    assert.equal(rootLoadCalls, 1);
  } finally {
    clearDom();
  }
});

test("bootTavo restores stores written by SSR loaders without rerunning load", async () => {
  let rootLoadCalls = 0;
  const sharedStore = createStore({
    items: [] as string[],
    setItems(items: string[]) {
      sharedStore.patch({ items });
    }
  });

  const Root = ({ children }: { children?: unknown }) => h("section", null, children);
  const Home = () => h("main", null, `items:${sharedStore.getState().items.join(",")}`);
  const modules = {
    "/src/pages/_root.tsx": {
      load: async () => {
        rootLoadCalls += 1;
        sharedStore.getState().setItems(["Ada", "Grace"]);
      },
      default: Root
    },
    "/src/pages/index.tsx": {
      default: Home
    }
  };

  const response = await renderPagesResponseAsync(modules, "/");
  assert.equal(rootLoadCalls, 1);
  assert.match(response.html, /id="__TAVO_STATE__"/);
  assert.match(response.html, /"storeState":/);
  assert.match(response.html, /items:Ada,Grace/);

  sharedStore.patch({ items: [] });
  const dom = setupDom(response.html, { url: "http://localhost/" });
  const result = await bootTavo({ modules });
  assert.equal(result.mode, "client");

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(rootLoadCalls, 1);
  assert.deepEqual(sharedStore.getState().items, ["Ada", "Grace"]);
  assert.equal(dom.window.document.querySelector("main")?.textContent, "items:Ada,Grace");
  clearDom();
});

test("concurrent SSR renders isolate store reads and serialized snapshots", async () => {
  const sharedStore = createStore({ value: "initial" });
  let markAlphaWritten!: () => void;
  let markBetaWritten!: () => void;
  const alphaWritten = new Promise<void>((resolve) => {
    markAlphaWritten = resolve;
  });
  const betaWritten = new Promise<void>((resolve) => {
    markBetaWritten = resolve;
  });
  const modules = {
    "/src/pages/[id].tsx": {
      load: async ({ params }: any) => {
        if (params.id === "beta") {
          await alphaWritten;
        }
        sharedStore.patch({ value: params.id });
        if (params.id === "alpha") {
          markAlphaWritten();
          await betaWritten;
        } else {
          markBetaWritten();
        }
        return params.id;
      },
      default: ({ data }: { data?: string }) =>
        h("main", null, `${data}:${sharedStore.getState().value}`)
    }
  };

  const alpha = renderPagesResponseAsync(modules, "/alpha");
  const beta = renderPagesResponseAsync(modules, "/beta");
  const [alphaResponse, betaResponse] = await Promise.all([alpha, beta]);

  assert.match(alphaResponse.html, /<main>alpha:alpha<\/main>/);
  assert.match(betaResponse.html, /<main>beta:beta<\/main>/);
  assert.match(alphaResponse.html, /"storeState":/);
  assert.match(alphaResponse.html, /"value":"alpha"/);
  assert.match(betaResponse.html, /"storeState":/);
  assert.match(betaResponse.html, /"value":"beta"/);
  assert.equal(sharedStore.getState().value, "initial");
});

test("static route cache restores request-local store state", async () => {
  const sharedStore = createStore({ value: "initial" });
  let loads = 0;
  const runtime = createPagesRuntime({
    "/src/pages/index.tsx": {
      static: true,
      load: () => {
        loads += 1;
        sharedStore.patch({ value: `loaded-${loads}` });
      },
      default: () => h("main", null, sharedStore.getState().value)
    }
  });

  const first = await renderPagesResponseFromRuntimeAsync(runtime, "/");
  const cached = await renderPagesResponseFromRuntimeAsync(runtime, "/");

  assert.equal(loads, 1);
  assert.match(first.html, /<main>loaded-1<\/main>/);
  assert.match(cached.html, /<main>loaded-1<\/main>/);
  assert.match(cached.html, /"storeState":/);
  assert.match(cached.html, /"value":"loaded-1"/);
  assert.equal(sharedStore.getState().value, "initial");
});

test("bootTavo resolves CSR page loaders before mounting page components", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/profile"
  });
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const Profile = createTavo({
    model: (props: { data?: { name?: string } }) => ({
      name: props.data?.name ?? "missing"
    }),
    view: ({ state }) => h("main", null, `name:${state.name}`)
  });
  const modules = {
    "/src/pages/profile.tsx": {
      load: async ({ request }: { request: Request }) => {
        assert.ok(request instanceof Request);
        assert.equal(new URL(request.url).pathname, "/profile");
        await Promise.resolve();
        return { name: "Ada" };
      },
      default: Profile
    }
  };

  const result = await bootTavo({ modules });
  assert.equal(result.mode, "client");

  await new Promise((resolve) => setTimeout(resolve, 20));

  const main = app.querySelector("main");
  assert.ok(main);
  assert.equal(main.textContent, "name:Ada");
  assert.doesNotMatch(app.textContent ?? "", /missing/);
  clearDom();
});

test("bootTavo resolves initial CSR root layout loader only once", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/"
  });
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  let rootLoadCalls = 0;
  const modules = {
    "/src/pages/_root.tsx": {
      load: async () => {
        rootLoadCalls += 1;
        await Promise.resolve();
        return { root: "loaded" };
      },
      default: ({ children, data }: { children?: unknown; data?: { root?: string } }) =>
        h("section", { "data-root": data?.root ?? "missing" }, children)
    },
    "/src/pages/index.tsx": {
      default: () => h("main", null, "Home")
    }
  };

  const result = await bootTavo({ modules });
  assert.equal(result.mode, "client");

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(rootLoadCalls, 1);
  assert.equal(app.querySelector("section")?.getAttribute("data-root"), "loaded");
  assert.equal(app.querySelector("main")?.textContent, "Home");
  clearDom();
});

test("bootTavo resolves initial CSR redirects before mounting the app route", async () => {
  let protectedRenderCalls = 0;
  const modules = {
    "/src/pages/protected.tsx": {
      middleware: async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
        return { redirect: "/login" };
      },
      default: () => {
        protectedRenderCalls += 1;
        return h("main", null, "Protected");
      }
    },
    "/src/pages/login.tsx": {
      default: () => h("main", null, "Login")
    }
  };

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/protected"
  });
  try {
    const result = await bootTavo({ modules });

    assert.equal(result.mode, "client");
    assert.equal(dom.window.location.pathname, "/login");
    assert.equal(dom.window.document.querySelector("main")?.textContent, "Login");
    assert.equal(protectedRenderCalls, 0);
  } finally {
    clearDom();
  }
});

test("page render csr skips server body render and resolves in the browser", async () => {
  let loadCalls = 0;
  let renderCalls = 0;
  const modules = {
    "/src/pages/csr.tsx": {
      render: "csr" as const,
      load: async () => {
        loadCalls += 1;
        return { name: "Ada" };
      },
      default: ({ data }: { data?: { name?: string } }) => {
        renderCalls += 1;
        return h("main", null, `name:${data?.name ?? "missing"}`);
      }
    }
  };

  const response = await renderPagesResponseAsync(modules, "/csr");
  assert.equal(response.resolved.renderMode, "csr");
  assert.equal(loadCalls, 0);
  assert.equal(renderCalls, 0);
  assert.doesNotMatch(response.html, /name:/);
  assert.doesNotMatch(response.html, /id="__TAVO_STATE__"/);
  assert.match(response.html, /data-tavo-render-mode="csr"/);

  const dom = setupDom(response.html, { url: "http://localhost/csr" });
  const result = await bootTavo({ modules });
  assert.equal(result.mode, "client");

  await new Promise((resolve) => setTimeout(resolve, 20));

  const main = dom.window.document.querySelector("main");
  assert.ok(main);
  assert.equal(main.textContent, "name:Ada");
  assert.equal(loadCalls, 1);
  assert.ok(renderCalls >= 1);
  clearDom();
});

test("page prerender named export enables static generation", async () => {
  let loadCalls = 0;
  const modules = {
    "/src/pages/prerendered.tsx": {
      prerender: true,
      load: async () => {
        loadCalls += 1;
        return { ok: true };
      },
      default: ({ data }: { data?: { ok?: boolean } }) => h("main", null, data?.ok ? "ok" : "missing")
    }
  };

  const response = await renderPagesResponseAsync(modules, "/prerendered");
  assert.equal(response.resolved.renderMode, "ssr");
  assert.equal(response.resolved.cache.static, true);
  assert.equal(loadCalls, 1);
  assert.match(response.html, />ok</);
});

test("page render csr reports ignored static SSR options", () => {
  const inspection = inspectPages({
    "/src/pages/conflict.tsx": {
      render: "csr" as const,
      static: true,
      revalidate: 60,
      vary: "x-tenant",
      generateStaticParams: () => [],
      default: () => h("main", null, "conflict")
    }
  });

  assert.match(inspection.diagnostics.join("\n"), /render: "csr"; prerender\/static, revalidate, vary, and generateStaticParams settings are ignored/);
  assert.equal(inspection.routes[0]?.renderMode, "csr");
  assert.equal(inspection.routes[0]?.cache.static, false);
});

test("page render csr reports dynamic head timing", () => {
  const inspection = inspectPages({
    "/src/pages/csr-dynamic-head.tsx": {
      render: "csr" as const,
      head: () => ({ title: "Dynamic CSR head" }),
      default: () => h("main", null, "csr")
    }
  });

  assert.match(inspection.diagnostics.join("\n"), /dynamic head\(\) function; it runs in the browser/);
});

test("layout render csr makes child routes csr", async () => {
  let loadCalls = 0;
  const modules = {
    "/src/pages/_layout.tsx": {
      render: "csr" as const,
      default: ({ children }: { children?: unknown }) => h("section", null, children)
    },
    "/src/pages/layout-child.tsx": {
      load: async () => {
        loadCalls += 1;
        return { ok: true };
      },
      default: ({ data }: { data?: { ok?: boolean } }) => h("main", null, data?.ok ? "ok" : "missing")
    }
  };

  const inspection = inspectPages(modules);
  assert.equal(inspection.routes[0]?.renderMode, "csr");

  const response = await renderPagesResponseAsync(modules, "/layout-child");
  assert.equal(response.resolved.renderMode, "csr");
  assert.equal(loadCalls, 0);
  assert.match(response.html, /data-tavo-render-mode="csr"/);
  assert.doesNotMatch(response.html, />ok</);
});

test("layout render csr reports ignored child static options", () => {
  const inspection = inspectPages({
    "/src/pages/_layout.tsx": {
      render: "csr" as const,
      default: ({ children }: { children?: unknown }) => h("section", null, children)
    },
    "/src/pages/static-child.tsx": {
      static: true,
      default: () => h("main", null, "static")
    }
  });

  assert.equal(inspection.routes[0]?.renderMode, "csr");
  assert.equal(inspection.routes[0]?.cache.static, false);
  assert.match(inspection.diagnostics.join("\n"), /render: "csr"; prerender\/static, revalidate, vary, and generateStaticParams settings are ignored/);
});

test("page render csr applies static head without running loaders", async () => {
  let loadCalls = 0;
  const modules = {
    "/src/pages/csr-head.tsx": {
      render: "csr" as const,
      head: {
        title: "CSR static head",
        unsafeHeadHtml: `<meta name="description" content="static csr head">`
      },
      load: async () => {
        loadCalls += 1;
        return { ok: true };
      },
      default: ({ data }: { data?: { ok?: boolean } }) => h("main", null, data?.ok ? "ok" : "missing")
    }
  };

  const response = await renderPagesResponseAsync(modules, "/csr-head");
  assert.equal(loadCalls, 0);
  assert.match(response.html, /<title>CSR static head<\/title>/);
  assert.match(response.html, /name="description" content="static csr head"/);
  assert.doesNotMatch(response.html, />ok</);
});

test("page render csr can include a server fallback shell", async () => {
  const modules = {
    "/src/pages/csr-fallback.tsx": {
      render: "csr" as const,
      load: async () => ({ ok: true }),
      default: ({ data }: { data?: { ok?: boolean } }) => h("main", null, data?.ok ? "ok" : "missing")
    }
  };

  const response = await renderPagesResponseAsync(modules, "/csr-fallback", {
    csrFallback: ({ pathname }) => h("main", { "data-fallback": "true" }, `Loading ${pathname}`)
  });
  assert.match(response.html, /data-fallback="true"/);
  assert.match(response.html, /Loading \/csr-fallback/);
  assert.doesNotMatch(response.html, />ok</);

  const dom = setupDom(response.html, { url: "http://localhost/csr-fallback" });
  await bootTavo({ modules });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(dom.window.document.querySelector("main")?.textContent, "ok");
  clearDom();
});

test("bootTavo csrActions submits forms without an explicit action to the current API route", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{
    url: string;
    method: string;
    credentials: RequestCredentials | undefined;
    fields: Record<string, FormDataEntryValue>;
  }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const body = init?.body as FormData;
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      credentials: init?.credentials,
      fields: Object.fromEntries(body.entries())
    });
    return new Response("ok");
  }) as typeof fetch;

  const modules = {
    "/src/pages/login.tsx": {
      default: () =>
        h(
          "main",
          null,
          h(
            "form",
            { method: "post" },
            h("input", { name: "email", value: "ada@example.com" }),
            h("button", { type: "submit" }, "Log in")
          )
        )
    }
  };

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/login?next=%2Fdashboard"
  });
  try {
    await bootTavo({
      modules,
      csrActions: {
        enabled: true,
        baseUrl: "https://api.example.com"
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const form = dom.window.document.querySelector("form");
    assert.ok(form);
    const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
    const dispatched = form.dispatchEvent(event);
    assert.equal(dispatched, false);

    await waitFor(() => calls.length === 1);
    assert.equal(calls[0].url, "https://api.example.com/login?next=%2Fdashboard");
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].credentials, "include");
    assert.equal(calls[0].fields.email, "ada@example.com");
  } finally {
    globalThis.fetch = originalFetch;
    clearDom();
  }
});

test("bootTavo csrActions submits explicit relative form actions and custom headers", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; headers: HeadersInit | undefined; fields: Record<string, FormDataEntryValue> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      headers: init?.headers,
      fields: Object.fromEntries((init?.body as FormData).entries())
    });
    return new Response("ok");
  }) as typeof fetch;

  const modules = {
    "/src/pages/profile.tsx": {
      default: () =>
        h(
          "form",
          { method: "post", action: "/auth/session" },
          h("input", { name: "intent", value: "login" }),
          h("button", { type: "submit" }, "Submit")
        )
    }
  };

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/profile"
  });
  try {
    await bootTavo({
      modules,
      csrActions: {
        enabled: true,
        baseUrl: "https://api.example.com",
        headers: ({ pathname }) => ({ "X-Tavo-Action": pathname })
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    dom.window.document.querySelector("form")?.dispatchEvent(
      new dom.window.Event("submit", { bubbles: true, cancelable: true })
    );

    await waitFor(() => calls.length === 1);
    assert.equal(calls[0].url, "https://api.example.com/auth/session");
    assert.deepEqual(calls[0].headers, { "X-Tavo-Action": "/auth/session" });
    assert.equal(calls[0].fields.intent, "login");
  } finally {
    globalThis.fetch = originalFetch;
    clearDom();
  }
});

test("bootTavo csrActions leaves unsupported forms to native browser behavior", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response("ok");
  }) as typeof fetch;

  const modules = {
    "/src/pages/forms.tsx": {
      default: () =>
        h(
          "main",
          null,
          h("form", { method: "get", "data-kind": "get" }, h("button", { type: "submit" }, "Get")),
          h("form", { method: "post", action: "https://other.example/login", "data-kind": "external" }, h("button", { type: "submit" }, "External")),
          h("form", { method: "post", target: "_blank", "data-kind": "blank" }, h("button", { type: "submit" }, "Blank")),
          h("form", { method: "post", "data-tavo-native": "", "data-kind": "native" }, h("button", { type: "submit" }, "Native"))
        )
    }
  };

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/forms"
  });
  try {
    await bootTavo({
      modules,
      csrActions: {
        enabled: true,
        baseUrl: "https://api.example.com"
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (const form of Array.from(dom.window.document.querySelectorAll("form"))) {
      const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
      const dispatched = form.dispatchEvent(event);
      assert.equal(dispatched, true);
      assert.equal(event.defaultPrevented, false);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    clearDom();
  }
});

test("bootTavo warns for static CSR post forms when csrActions are not configured", async () => {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };

  const modules = {
    "/src/pages/login.tsx": {
      default: () => h("form", { method: "post" }, h("button", { type: "submit" }, "Submit"))
    }
  };

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/login"
  });
  try {
    await bootTavo({ modules });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const event = new dom.window.Event("submit", { bubbles: true, cancelable: true });
    const dispatched = dom.window.document.querySelector("form")?.dispatchEvent(event);
    assert.equal(dispatched, true);
    assert.equal(event.defaultPrevented, false);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /bootTavo\(\{ csrActions \}\)/);
  } finally {
    console.warn = originalWarn;
    clearDom();
  }
});

test("bootTavo csrActions follows same-origin redirects through Tavo navigation", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return new Response(null, { status: 303, headers: { Location: "/dashboard?from=login" } });
  }) as typeof fetch;

  const modules = {
    "/src/pages/login.tsx": {
      default: () => h("form", { method: "post" }, h("button", { type: "submit" }, "Submit"))
    },
    "/src/pages/dashboard.tsx": {
      default: () => h("main", null, "Dashboard")
    }
  };

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/login"
  });
  try {
    await bootTavo({
      modules,
      csrActions: {
        enabled: true,
        baseUrl: "https://api.example.com"
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const form = dom.window.document.querySelector("form");
    assert.ok(form);
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => dom.window.location.pathname === "/dashboard");
    assert.equal(dom.window.location.search, "?from=login");
    assert.match(dom.window.document.body.textContent ?? "", /Dashboard/);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    clearDom();
  }
});

test("bootTavo csrActions handles hash redirects and failed responses without crashing routing", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => {
    calls += 1;
    return calls === 1
      ? new Response(null, { status: 303, headers: { Location: "#done" } })
      : new Response("nope", { status: 500 });
  }) as typeof fetch;

  const modules = {
    "/src/pages/login.tsx": {
      default: () => h("form", { method: "post" }, h("button", { type: "submit" }, "Submit"))
    }
  };

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/login"
  });
  try {
    await bootTavo({
      modules,
      csrActions: {
        enabled: true,
        baseUrl: "https://api.example.com"
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const form = dom.window.document.querySelector("form");
    assert.ok(form);
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => dom.window.location.hash === "#done");
    form.dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
    await waitFor(() => calls === 2);
    assert.equal(dom.window.document.querySelector("form"), form);
  } finally {
    globalThis.fetch = originalFetch;
    clearDom();
  }
});

test("page load and middleware receive normalized Request context in SSR and CSR", async () => {
  const seen: string[] = [];
  const modules = {
    "/src/pages/request.tsx": {
      middleware: ({ request, rawRequest, url, headers, method }: {
        request: Request;
        rawRequest?: unknown;
        url: URL;
        headers: Headers;
        method: string;
      }) => {
        assert.ok(request instanceof Request);
        assert.equal(url.pathname, "/request");
        assert.equal(method, "GET");
        assert.ok(headers.get("x-mode") === "ssr" || headers.get("x-mode") === null);
        assert.ok(rawRequest);
      },
      load: async ({ request, rawRequest, url, headers, method }: {
        request: Request;
        rawRequest?: unknown;
        url: URL;
        headers: Headers;
        method: string;
      }) => {
        seen.push(`${method}:${url.pathname}:${headers.get("x-mode")}:${rawRequest ? "raw" : "none"}`);
        assert.ok(request instanceof Request);
        return { ok: true };
      },
      default: ({ data }: { data?: { ok?: boolean } }) => h("main", null, data?.ok ? "ok" : "missing")
    }
  };

  const response = await renderPagesResponseAsync(modules, "/request", {
    request: {
      url: "/request",
      method: "GET",
      headers: {
        host: "localhost",
        "x-mode": "ssr"
      }
    }
  });
  assert.match(response.html, />ok</);
  assert.deepEqual(seen, ["GET:/request:ssr:raw"]);

  seen.length = 0;
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/request"
  });
  await bootTavo({ modules });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(dom.window.document.querySelector("main")?.textContent, "ok");
  assert.deepEqual(seen, ["GET:/request:null:raw"]);
  clearDom();
});

test("middleware runtime options skip server-only handlers during CSR resolution", async () => {
  let serverOnlyCalls = 0;
  let clientOnlyCalls = 0;
  let bothCalls = 0;
  const modules = {
    "/src/pages/server-only.tsx": {
      middleware: [
        defineMiddleware(async () => {
          serverOnlyCalls += 1;
          await Promise.resolve();
          return { redirect: "/server-redirect" };
        }, { runtime: "server" }),
        defineMiddleware(() => {
          clientOnlyCalls += 1;
          return { redirect: "/client-redirect" };
        }, { runtime: "client" }),
        defineMiddleware(() => {
          bothCalls += 1;
        })
      ],
      default: () => h("main", null, "protected")
    }
  };

  const serverResponse = await renderPagesResponseAsync(modules, "/server-only");
  assert.equal(serverResponse.resolved.redirect, "/server-redirect");
  assert.equal(serverOnlyCalls, 1);
  assert.equal(clientOnlyCalls, 0);
  assert.equal(bothCalls, 0);

  serverOnlyCalls = 0;
  clientOnlyCalls = 0;
  bothCalls = 0;
  setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/server-only"
  });
  try {
    const runtime = createPagesRuntime(modules);
    const clientResolved = await runtime.resolvePathAsync("/server-only");
    assert.equal(clientResolved.redirect, "/client-redirect");
    assert.equal(serverOnlyCalls, 0);
    assert.equal(clientOnlyCalls, 1);
    assert.equal(bothCalls, 0);
  } finally {
    clearDom();
  }
});

test("defineServerMiddleware skips handlers during CSR resolution", async () => {
  let calls = 0;
  const modules = {
    "/src/pages/server-middleware.tsx": {
      middleware: defineServerMiddleware(() => {
        calls += 1;
        return { redirect: "/server-only" };
      }),
      default: () => h("main", null, "protected")
    }
  };

  const serverResponse = await renderPagesResponseAsync(modules, "/server-middleware");
  assert.equal(serverResponse.resolved.redirect, "/server-only");
  assert.equal(calls, 1);

  calls = 0;
  setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost/server-middleware"
  });
  try {
    const runtime = createPagesRuntime(modules);
    const clientResolved = await runtime.resolvePathAsync("/server-middleware");
    assert.equal(clientResolved.redirect, undefined);
    assert.equal(calls, 0);
  } finally {
    clearDom();
  }
});

test("runtime environment helpers distinguish server and client execution", () => {
  assert.equal(isServerRuntime(), true);
  assert.equal(isClientRuntime(), false);

  setupDom(`<!doctype html><html><body></body></html>`);
  try {
    assert.equal(isServerRuntime(), false);
    assert.equal(isClientRuntime(), true);
  } finally {
    clearDom();
  }
});

test("defineServerOnly throws when a server-only helper is called in the browser", () => {
  const readSecret = defineServerOnly(() => "secret");
  assert.equal(readSecret(), "secret");

  setupDom(`<!doctype html><html><body></body></html>`);
  try {
    assert.throws(() => readSecret(), /server-only function called in the browser/);
  } finally {
    clearDom();
  }
});

test("same page code produces matching interactive DOM in SSR and CSR modes", async () => {
  class CounterController extends TavoController {
    declare model: { getState(): { count: number }; patch(next: { count: number }): void };

    increment() {
      this.model.patch({ count: this.model.getState().count + 1 });
    }
  }

  const ProfileCounter = createTavo<
    { data?: { name?: string }; params?: { mode?: string } },
    { count: number },
    CounterController
  >({
    model: () => ({ count: 1 }),
    controller: CounterController,
    view: ({ props, state, controller }) =>
      h(
        "main",
        null,
        h("p", { "data-testid": "summary" }, `${props.params?.mode}:${props.data?.name}:count:${state.count}`),
        h("button", { type: "button", onClick: () => controller?.increment() }, "increment")
      )
  });

  const load = async () => ({ name: "Ada" });
  const createModules = (render?: "csr") => ({
    "/src/pages/[mode].tsx": {
      ...(render ? { render } : {}),
      load,
      default: ProfileCounter
    }
  });

  async function runClientScenario(html: string, url: string, modules: ReturnType<typeof createModules>) {
    const dom = setupDom(html, { url });
    try {
      const result = await bootTavo({ modules });
      assert.equal(result.mode, "client");
      await new Promise((resolve) => setTimeout(resolve, 20));

      const summary = dom.window.document.querySelector("[data-testid='summary']");
      const button = dom.window.document.querySelector("button");
      assert.ok(summary);
      assert.ok(button);
      const initialText = summary.textContent;
      button.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      const clickedText = summary.textContent;
      return { initialText, clickedText };
    } finally {
      clearDom();
    }
  }

  const ssrModules = createModules();
  const csrModules = createModules("csr");
  const ssrResponse = await renderPagesResponseAsync(ssrModules, "/same");
  const csrResponse = await renderPagesResponseAsync(csrModules, "/same");

  assert.equal(ssrResponse.resolved.renderMode, "ssr");
  assert.equal(csrResponse.resolved.renderMode, "csr");
  assert.match(ssrResponse.html, /same:Ada:count:1/);
  assert.doesNotMatch(csrResponse.html, /same:Ada:count:1/);

  const ssr = await runClientScenario(ssrResponse.html, "http://localhost/same", ssrModules);
  const csr = await runClientScenario(csrResponse.html, "http://localhost/same", csrModules);

  assert.deepEqual(ssr, csr);
  assert.deepEqual(ssr, {
    initialText: "same:Ada:count:1",
    clickedText: "same:Ada:count:2"
  });
});

test("controller createId is stable across server render and hydration", () => {
  class FieldController extends TavoController {
    id: string;

    constructor(context: { createId(prefix?: string): string }) {
      super();
      this.id = context.createId("field");
    }
  }

  const Field = createTavo<Record<string, never>, Record<string, never>, FieldController>({
    model: () => ({}),
    controller: FieldController,
    view: ({ controller }) => h("label", { for: controller?.id }, h("input", { id: controller?.id }))
  });

  const html = renderToString(h(Field, {}));
  const dom = setupDom(`<!doctype html><html><body><div id="app">${html}</div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);
  const inputBefore = dom.window.document.querySelector("input");
  assert.ok(inputBefore);
  const idBefore = inputBefore.id;

  createRoot(app).hydrate(h(Field, {}));

  const inputAfter = dom.window.document.querySelector("input");
  const labelAfter = dom.window.document.querySelector("label");
  assert.ok(inputAfter);
  assert.ok(labelAfter);
  assert.equal(inputAfter.id, idBefore);
  assert.equal(labelAfter.getAttribute("for"), idBefore);
  clearDom();
});

test("hydrate reports mismatch payload in dev mode", () => {
  const mismatches: Array<{ message: string; kind?: string; pathSegments?: string[]; recovery?: string }> = [];
  const dom = setupDom(`<!doctype html><html><body><div id="app"><p>server</p></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  configureDevDiagnostics({
    enabled: true,
    devMode: true,
    onHydrationMismatch(event) {
      mismatches.push(event);
    }
  });

  createRoot(app).hydrate(h("p", null, "client"));

  assert.ok(mismatches.length > 0);
  assert.ok(mismatches[0].message.length > 0);
  assert.ok(Array.isArray(mismatches[0].pathSegments));
  assert.equal(mismatches[0].recovery, "text");

  configureDevDiagnostics({
    enabled: false,
    devMode: false,
    onHydrationMismatch: null
  });
  clearDom();
});

test("strict hydration turns local mismatches into coded CI failures", () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"><p>server</p></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  configureDevDiagnostics({
    enabled: true,
    devMode: false,
    strictHydration: true,
    onError: () => {}
  });

  assert.throws(
    () => createRoot(app).hydrate(h("p", null, "client")),
    (error: unknown) => {
      assert.equal((error as { code?: string }).code, "TAVO_HYDRATION_001");
      assert.equal(
        ((error as { details?: { event?: { recovery?: string } } }).details?.event?.recovery),
        "text"
      );
      return true;
    }
  );

  configureDevDiagnostics({
    enabled: false,
    devMode: false,
    strictHydration: false,
    onError: null,
    onHydrationMismatch: null
  });
  clearDom();
});

test("scheduler priorities defer transitions and allow explicit synchronous updates", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);
  let counter: ReturnType<typeof createStore<{ count: number }>> | undefined;
  class CounterController extends TavoController {
    onInit() {
      counter = this.model as ReturnType<typeof createStore<{ count: number }>>;
    }
  }
  const Counter = createTavo({
    model: () => ({ count: 0 }),
    controller: CounterController,
    view: ({ state }) => h("p", null, String(state.count))
  });
  createRoot(app).render(h(Counter, {}));
  await Promise.resolve();
  assert.ok(counter);

  startTransition(() => counter?.patch({ count: 1 }));
  assert.equal(app.textContent, "0");
  await Promise.resolve();
  assert.equal(app.textContent, "0");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(app.textContent, "1");

  flushSync(() => counter?.patch({ count: 2 }));
  assert.equal(app.textContent, "2");
  clearDom();
});

test("unmount removes components from lifecycle and scheduler diagnostics", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);
  const baseline = inspectTavoRuntime().dom.mountedComponents;
  const Example = createTavo({
    model: () => ({ value: 1 }),
    view: ({ state }) => h("p", null, String(state.value))
  });
  const root = createRoot(app);
  root.render(h(Example, {}));
  assert.equal(inspectTavoRuntime().dom.mountedComponents, baseline + 1);

  root.unmount();
  await Promise.resolve();
  const after = inspectTavoRuntime().dom;
  assert.equal(after.mountedComponents, baseline);
  assert.equal(after.pendingUpdates, 0);
  clearDom();
});

test("repeated mount and unmount cycles leave no component or scheduler work behind", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);
  const baseline = inspectTavoRuntime().dom.mountedComponents;
  const Example = createTavo({
    model: () => ({ value: 1 }),
    view: ({ state }) => h("p", null, String(state.value))
  });

  for (let index = 0; index < 100; index += 1) {
    const root = createRoot(app);
    root.render(h(Example, {}));
    root.unmount();
  }

  await Promise.resolve();
  assert.deepEqual(inspectTavoRuntime().dom, {
    mountedComponents: baseline,
    pendingPassiveEffects: 0,
    pendingUpdates: 0
  });
  clearDom();
});

test("the opt-in browser devtools panel renders and disposes privacy-safe snapshots", () => {
  const dom = setupDom(`<!doctype html><html><body></body></html>`);
  const panel = installTavoDevtoolsPanel({ initiallyOpen: true });

  assert.equal(dom.window.document.querySelectorAll("[data-tavo-devtools]").length, 1);
  assert.match(panel.element.textContent ?? "", /mountedComponents/);
  assert.doesNotMatch(panel.element.textContent ?? "", /cookie|authorization/i);

  panel.dispose();
  assert.equal(dom.window.document.querySelectorAll("[data-tavo-devtools]").length, 0);
  clearDom();
});

test("hydrate does not report mismatch when markup matches", () => {
  const mismatches: unknown[] = [];
  const dom = setupDom(`<!doctype html><html><body><div id="app"><p>same</p></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  configureDevDiagnostics({
    enabled: true,
    devMode: true,
    onHydrationMismatch(event) {
      mismatches.push(event);
    }
  });

  createRoot(app).hydrate(h("p", null, "same"));
  assert.equal(mismatches.length, 0);

  configureDevDiagnostics({
    enabled: false,
    devMode: false,
    onHydrationMismatch: null
  });
  clearDom();
});

test("csr promise-backed deferred renders fallback without client stream resolution", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  let resolveValue: ((value: string) => void) | null = null;
  const delayed = new Promise<string>((resolve) => {
    resolveValue = resolve;
  });

  createRoot(app).render(
    h(
      Deferred,
      {
        value: delayed,
        fallback: h("p", null, "csr fallback")
      },
      (value: string) => h("p", null, value)
    )
  );

  assert.match(app.innerHTML, /csr fallback/);

  assert.ok(resolveValue);
  resolveValue("client stream value");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.match(app.innerHTML, /csr fallback/);
  assert.doesNotMatch(app.innerHTML, /client stream value/);
  clearDom();
});

test("ssr deferred state is reused without restarting client promise", async () => {
  const dom = setupDom(
    `<!doctype html><html><body><script id="__TAVO_STATE__" type="application/json">{"enabled":true}</script><div id="app"></div></body></html>`
  );
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  (dom.window as Window & typeof globalThis & {
    __TAVO_DEFERRED__?: Record<string, { status: "resolved"; data: unknown }>;
  }).__TAVO_DEFERRED__ = {
    demo: {
      status: "resolved",
      data: "server deferred value"
    }
  };

  let resolveValue: ((value: string) => void) | null = null;
  const delayed = new Promise<string>((resolve) => {
    resolveValue = resolve;
  });

  createRoot(app).render(
    h(
      Deferred,
      {
        id: "demo",
        value: delayed,
        fallback: h("p", null, "loading")
      },
      (value: string) => h("p", null, value)
    )
  );

  assert.match(app.innerHTML, /server deferred value/);

  assert.ok(resolveValue);
  resolveValue("client deferred value");
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.match(app.innerHTML, /server deferred value/);
  assert.doesNotMatch(app.innerHTML, /client deferred value/);
  clearDom();
});

test("ssr deferred timeout state renders timeout fallback during hydration", () => {
  const dom = setupDom(
    `<!doctype html><html><body><script id="__TAVO_STATE__" type="application/json">{"enabled":true}</script><div id="app"></div></body></html>`
  );
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  (dom.window as Window & typeof globalThis & {
    __TAVO_DEFERRED__?: Record<string, { status: "rejected"; error: unknown }>;
  }).__TAVO_DEFERRED__ = {
    slow: {
      status: "rejected",
      error: {
        code: "TAVO_DEFERRED_TIMEOUT",
        id: "slow",
        timeoutMs: 10,
        message: "timeout"
      }
    }
  };

  createRoot(app).render(
    h(
      Deferred,
      {
        id: "slow",
        value: new Promise<string>(() => {}),
        fallback: h("p", null, "loading"),
        timeoutFallback: h("p", null, "timed out")
      },
      (value: string) => h("p", null, value)
    )
  );

  assert.match(app.innerHTML, /timed out/);
  assert.doesNotMatch(app.innerHTML, /loading/);
  clearDom();
});
