import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRoot } from "../../src/dom.ts";
import { createTavo, h, TavoController } from "../../src/index.tsx";
import { createI18n } from "../../src/i18n/index.ts";
import { createRouter, Link, RouterProvider } from "../../src/router/index.ts";

type GlobalWithDom = typeof globalThis & {
  window?: Window & typeof globalThis;
  document?: Document;
  Node?: typeof Node;
  HTMLElement?: typeof HTMLElement;
  Text?: typeof Text;
  MouseEvent?: typeof MouseEvent;
  PopStateEvent?: typeof PopStateEvent;
  requestAnimationFrame?: typeof requestAnimationFrame;
  cancelAnimationFrame?: typeof cancelAnimationFrame;
};

function setupDom(markup: string, url = "http://example.com/") {
  const dom = new JSDOM(markup, { url, pretendToBeVisual: true });
  let scrollX = 0;
  let scrollY = 0;
  Object.defineProperties(dom.window, {
    scrollX: {
      configurable: true,
      get: () => scrollX
    },
    scrollY: {
      configurable: true,
      get: () => scrollY
    },
    pageXOffset: {
      configurable: true,
      get: () => scrollX
    },
    pageYOffset: {
      configurable: true,
      get: () => scrollY
    }
  });
  dom.window.scrollTo = ((x: number | ScrollToOptions, y?: number) => {
    if (typeof x === "object") {
      scrollX = Number(x.left ?? scrollX);
      scrollY = Number(x.top ?? scrollY);
      return;
    }
    scrollX = Number(x);
    scrollY = Number(y ?? scrollY);
  }) as typeof dom.window.scrollTo;
  dom.window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
    const element = this as HTMLElement;
    element.dataset.scrollCount = String(Number(element.dataset.scrollCount ?? 0) + 1);
    const top = Number(element.dataset.scrollTop ?? 0);
    dom.window.scrollTo(0, top);
  };
  const globalRef = globalThis as GlobalWithDom;
  globalRef.window = dom.window as unknown as Window & typeof globalThis;
  globalRef.document = dom.window.document;
  globalRef.Node = dom.window.Node;
  globalRef.HTMLElement = dom.window.HTMLElement;
  globalRef.Text = dom.window.Text;
  globalRef.MouseEvent = dom.window.MouseEvent;
  globalRef.PopStateEvent = dom.window.PopStateEvent;
  globalRef.requestAnimationFrame = dom.window.requestAnimationFrame.bind(dom.window) as typeof requestAnimationFrame;
  globalRef.cancelAnimationFrame = dom.window.cancelAnimationFrame.bind(dom.window) as typeof cancelAnimationFrame;
  return dom;
}

function clearDom() {
  const globalRef = globalThis as GlobalWithDom;
  delete globalRef.window;
  delete globalRef.document;
  delete globalRef.Node;
  delete globalRef.HTMLElement;
  delete globalRef.Text;
  delete globalRef.MouseEvent;
  delete globalRef.PopStateEvent;
  delete globalRef.requestAnimationFrame;
  delete globalRef.cancelAnimationFrame;
}

test("router: Link marks the active route with aria-current", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const router = createRouter([]);
  const root = createRoot(app);
  root.render(h(RouterProvider, {
    router,
    children: h(Link, { to: "/", className: "home-link" }, "Home")
  }));

  await Promise.resolve();
  const link = app.querySelector(".home-link");
  assert.equal(link?.getAttribute("aria-current"), "page");
  clearDom();
});

test("router: Link treats search and hash targets as active for the current pathname", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, "http://example.com/docs?tab=intro");
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const router = createRouter([]);
  const root = createRoot(app);
  root.render(h(RouterProvider, {
    router,
    children: h(Link, { to: "/docs?tab=api#install", className: "docs-link" }, "Docs")
  }));

  await Promise.resolve();
  const link = app.querySelector(".docs-link");
  assert.equal(link?.getAttribute("aria-current"), "page");
  clearDom();
});

test("router: Link handles delegated internal clicks", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const router = createRouter([]);
  const root = createRoot(app);
  root.render(h(RouterProvider, {
    router,
    children: h(Link, { to: "/about?tab=team#intro", className: "about-link" }, "About")
  }));

  await Promise.resolve();
  const internal = app.querySelector(".about-link");
  assert.ok(internal);
  internal.dispatchEvent(new dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0
  }));
  assert.equal(dom.window.location.pathname, "/about");
  assert.equal(dom.window.location.search, "?tab=team");
  assert.equal(dom.window.location.hash, "#intro");
  clearDom();
});

test("router: Link localizes internal hrefs with the active i18n locale", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const i18n = createI18n({
    defaultLocale: "en",
    routing: {
      enabled: true
    },
    messages: {
      en: { common: { label: "Settings" } },
      es: { common: { label: "Configuracion" } }
    }
  });
  i18n.setLocale("es");

  const router = createRouter([]);
  const root = createRoot(app);
  root.render(h(RouterProvider, {
    router,
    children: h(Link, { to: "/settings?tab=billing#plans", className: "settings-link" }, "Settings")
  }));

  await Promise.resolve();
  const link = app.querySelector(".settings-link");
  assert.equal(link?.getAttribute("href"), "/es/settings?tab=billing#plans");

  link?.dispatchEvent(new dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0
  }));
  assert.equal(dom.window.location.pathname, "/es/settings");
  assert.equal(dom.window.location.search, "?tab=billing");
  assert.equal(dom.window.location.hash, "#plans");

  i18n.setLocale("en");
  clearDom();
});

test("router: Link active state ignores locale prefixes", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, "http://example.com/es/settings");
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const i18n = createI18n({
    defaultLocale: "en",
    routing: {
      enabled: true
    },
    messages: {
      en: { common: { label: "Settings" } },
      es: { common: { label: "Configuracion" } }
    }
  });
  i18n.setLocale("es");

  const router = createRouter([]);
  const root = createRoot(app);
  root.render(h(RouterProvider, {
    router,
    children: h(Link, { to: "/settings", className: "settings-link" }, "Settings")
  }));

  await Promise.resolve();
  const link = app.querySelector(".settings-link");
  assert.equal(link?.getAttribute("href"), "/es/settings");
  assert.equal(link?.getAttribute("aria-current"), "page");

  i18n.setLocale("en");
  clearDom();
});


test("router: RouterProvider renders a live region for route announcements", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const router = createRouter([
    {
      path: "/",
      component: () => h("main", { "data-tavo-route-focus": "true" }, h("h1", null, "Home"))
    },
    {
      path: "/about",
      component: () => h("main", { "data-tavo-route-focus": "true" }, h("h1", null, "About"))
    }
  ]);
  const root = createRoot(app);
  root.render(h(RouterProvider, { router }));

  await Promise.resolve();
  router.navigate("/about");
  await Promise.resolve();
  await Promise.resolve();

  const region = app.querySelector('[aria-live="polite"]');
  assert.ok(region);
  assert.match(region?.textContent ?? "", /About|\/about/);
  clearDom();
});

test("router: RouterProvider exposes a route container with busy state", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const router = createRouter([]);
  const root = createRoot(app);
  root.render(h(RouterProvider, {
    router,
    busy: true,
    contentId: "page-content",
    children: h("section", null, "Hello")
  }));

  await Promise.resolve();
  const container = app.querySelector("#page-content");
  assert.ok(container);
  assert.equal(container?.getAttribute("aria-busy"), "true");
  assert.equal(container?.getAttribute("data-tavo-route-region"), "true");
  clearDom();
});

test("router: focus restoration waits for client navigation", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const router = createRouter([
    {
      path: "/",
      component: () => h("main", null, h("h1", null, "Home"))
    },
    {
      path: "/about",
      component: () => h("main", null, h("h1", null, "About"))
    }
  ]);
  const root = createRoot(app);
  root.render(h(RouterProvider, { router, contentId: "page-content" }));

  await Promise.resolve();
  assert.equal(dom.window.document.activeElement, dom.window.document.body);

  router.navigate("/about");
  await new Promise((resolve) => dom.window.setTimeout(resolve, 10));
  assert.equal(dom.window.document.activeElement?.tagName, "MAIN");
  clearDom();
});

test("router: client navigation scrolls to the top after rendering", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const router = createRouter([
    {
      path: "/",
      component: () => h("main", null, h("h1", null, "Home"))
    },
    {
      path: "/about",
      component: () => h("main", null, h("h1", null, "About"))
    }
  ]);
  const root = createRoot(app);
  root.render(h(RouterProvider, { router, contentId: "page-content" }));

  await Promise.resolve();
  dom.window.scrollTo(0, 320);
  router.navigate("/about");
  await new Promise((resolve) => dom.window.setTimeout(resolve, 10));

  assert.equal(dom.window.scrollY, 0);
  clearDom();
});

test("router: client navigation can preserve scroll", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const router = createRouter([
    {
      path: "/",
      component: () => h("main", null, h("h1", null, "Home"))
    },
    {
      path: "/about",
      component: () => h("main", null, h("h1", null, "About"))
    }
  ]);
  const root = createRoot(app);
  root.render(h(RouterProvider, { router, contentId: "page-content" }));

  await Promise.resolve();
  dom.window.scrollTo(0, 320);
  router.navigate("/about", { scroll: false });
  await new Promise((resolve) => dom.window.setTimeout(resolve, 10));

  assert.equal(dom.window.scrollY, 320);
  clearDom();
});

test("router: client navigation scrolls to hash targets after rendering", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const router = createRouter([
    {
      path: "/",
      component: () => h("main", null, h("h1", null, "Home"))
    },
    {
      path: "/about",
      component: () => h("main", null, [
        h("h1", null, "About"),
        h("section", { id: "team", "data-scroll-top": "640" }, "Team")
      ])
    }
  ]);
  const root = createRoot(app);
  root.render(h(RouterProvider, { router, contentId: "page-content" }));

  await Promise.resolve();
  router.navigate("/about#team");
  await new Promise((resolve) => dom.window.setTimeout(resolve, 10));

  assert.equal(dom.window.scrollY, 640);
  clearDom();
});

test("router: client Link navigation retries a hash target rendered after the initial route lifecycle", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  class DelayedTargetController extends TavoController {
    onMount() {
      this.setTimeout(() => this.model.patch({ ready: true }), 0);
    }
  }

  const DelayedTarget = createTavo({
    model: () => ({ ready: false }),
    controller: DelayedTargetController,
    view: ({ state }) => state.ready
      ? h("section", { id: "team", "data-scroll-top": "640" }, "Team")
      : null
  });
  const router = createRouter([
    {
      path: "/",
      component: () => h("main", null, [
        h("h1", null, "Home"),
        h(Link, { to: "/about#team", className: "team-link" }, "Team")
      ])
    },
    {
      path: "/about",
      component: () => h("main", null, [
        h("h1", null, "About"),
        h(DelayedTarget, {})
      ])
    }
  ]);
  const root = createRoot(app);
  root.render(h(RouterProvider, { router, contentId: "page-content" }));

  await Promise.resolve();
  const link = app.querySelector(".team-link");
  assert.ok(link);
  link.dispatchEvent(new dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0
  }));
  await new Promise((resolve) => dom.window.setTimeout(resolve, 50));

  const target = app.querySelector<HTMLElement>("#team");
  assert.ok(target);
  assert.equal(dom.window.location.pathname, "/about");
  assert.equal(dom.window.location.hash, "#team");
  assert.equal(dom.window.scrollY, 640);
  assert.equal(target.dataset.scrollCount, "1");
  clearDom();
});

test("router: a missing hash target falls back to the top after bounded retries", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const router = createRouter([
    {
      path: "/",
      component: () => h("main", null, h("h1", null, "Home"))
    },
    {
      path: "/about",
      component: () => h("main", null, h("h1", null, "About"))
    }
  ]);
  const root = createRoot(app);
  root.render(h(RouterProvider, { router, contentId: "page-content" }));

  await Promise.resolve();
  dom.window.scrollTo(0, 320);
  router.navigate("/about#missing");
  await new Promise((resolve) => dom.window.setTimeout(resolve, 200));
  assert.equal(dom.window.scrollY, 0);

  const lateTarget = dom.window.document.createElement("section");
  lateTarget.id = "missing";
  lateTarget.dataset.scrollTop = "640";
  app.appendChild(lateTarget);
  await new Promise((resolve) => dom.window.setTimeout(resolve, 50));

  assert.equal(dom.window.scrollY, 0);
  assert.equal(lateTarget.dataset.scrollCount, undefined);
  clearDom();
});

test("router: browser back restores saved scroll position", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const router = createRouter([
    {
      path: "/",
      component: () => h("main", null, h("h1", null, "Home"))
    },
    {
      path: "/about",
      component: () => h("main", null, h("h1", null, "About"))
    }
  ]);
  const root = createRoot(app);
  root.render(h(RouterProvider, { router, contentId: "page-content" }));

  await Promise.resolve();
  dom.window.scrollTo(0, 320);
  router.navigate("/about");
  await new Promise((resolve) => dom.window.setTimeout(resolve, 10));
  dom.window.scrollTo(0, 120);
  dom.window.history.back();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 10));

  assert.equal(dom.window.location.pathname, "/");
  assert.equal(dom.window.scrollY, 320);

  dom.window.history.forward();
  await new Promise((resolve) => dom.window.setTimeout(resolve, 10));

  assert.equal(dom.window.location.pathname, "/about");
  assert.equal(dom.window.scrollY, 120);
  clearDom();
});

test("router: Link leaves same-page hash navigation to the browser", async () => {
  const dom = setupDom(
    `<!doctype html><html><body><div id="app"></div><section id="details"></section></body></html>`,
    "http://example.com/docs"
  );
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const router = createRouter([]);
  const root = createRoot(app);
  root.render(h(RouterProvider, {
    router,
    children: h(Link, { to: "/docs#details", className: "details-link" }, "Details")
  }));

  await Promise.resolve();
  const link = app.querySelector(".details-link");
  assert.ok(link);
  const event = new dom.window.MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0
  });
  link.dispatchEvent(event);

  assert.equal(event.defaultPrevented, false);
  clearDom();
});
