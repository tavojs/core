import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TavoController, createExternalStore, createRoot, createTavo, h, renderToString } from "../../src/index.tsx";
import {
  createServiceKey,
  defineGlobalStore,
  getService,
  hasService,
  registerService,
  tryGetService
} from "../../src/framework/index.ts";
import { clearServices, unregisterService } from "../../src/testing.ts";

function captureWarnings(fn: () => void): string[] {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

type GlobalWithDom = typeof globalThis & {
  window?: Window & typeof globalThis;
  document?: Document;
  Node?: typeof Node;
  HTMLElement?: typeof HTMLElement;
  Text?: typeof Text;
};

function setupDom(markup: string, options?: { url?: string }) {
  const dom = new JSDOM(markup, options);
  const globalRef = globalThis as GlobalWithDom;
  globalRef.window = dom.window as unknown as Window & typeof globalThis;
  globalRef.document = dom.window.document;
  globalRef.Node = dom.window.Node;
  globalRef.HTMLElement = dom.window.HTMLElement;
  globalRef.Text = dom.window.Text;
  return dom;
}

function clearDom() {
  const globalRef = globalThis as GlobalWithDom;
  delete globalRef.window;
  delete globalRef.document;
  delete globalRef.Node;
  delete globalRef.HTMLElement;
  delete globalRef.Text;
}

test("createTavo injects model into constructor-free controllers", () => {
  class CounterController extends TavoController {
    declare props: { label: string };
    declare model: { getState(): { count: number } };

    text() {
      return `${this.props.label}:${this.model.getState().count}`;
    }
  }

  const Counter = createTavo({
    model: () => ({ count: 3 }),
    controller: CounterController,
    view: ({ controller }) => h("p", null, controller?.text())
  });

  const html = renderToString(h(Counter, { label: "ready" }));
  assert.match(html, /<p>ready:3<\/p>/);
});

test("createTavo keeps controller props current across rerenders", async () => {
  class LabelController extends TavoController {
    declare props: { label: string };
    declare model: { getState(): { count: number } };

    text() {
      return `${this.props.label}:${this.model.getState().count}`;
    }
  }

  const LabelView = createTavo({
    model: () => ({ count: 1 }),
    controller: LabelController,
    view: ({ controller }) => h("p", null, controller?.text())
  });

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const root = createRoot(app);
  root.render(h(LabelView, { label: "first" }));
  assert.equal(app.textContent, "first:1");

  root.render(h(LabelView, { label: "second" }));
  await Promise.resolve();
  assert.equal(app.textContent, "second:1");

  clearDom();
});

test("createTavo exposes grouped router helpers on controllers", () => {
  class RouteController extends TavoController {
    snapshot() {
      return [
        this.page.pathname,
        this.page.status,
        this.router.routes.length,
        typeof this.router.navigate,
        typeof this.router.pushUrl,
        typeof this.router.replaceUrl,
        typeof this.router.prefetch
      ].join(":");
    }
  }

  const RouteView = createTavo({
    controller: RouteController,
    view: ({ controller }) => h("p", null, controller?.snapshot())
  });

  const html = renderToString(h(RouteView, {}));
  assert.match(html, /<p>\/:idle:0:function:function:function:function<\/p>/);
});

test("controller router can update the URL without remounting or navigating", async () => {
  class UrlStateController extends TavoController {
    incrementAndPush() {
      this.model.set("count", (value: number) => value + 1);
      this.router.pushUrl("/login?step=2#email");
    }

    replace() {
      this.router.replaceUrl("/login?step=3");
    }
  }

  const UrlStateView = createTavo({
    model: () => ({ count: 0 }),
    controller: UrlStateController,
    view: ({ state, controller }) =>
      h(
        "div",
        null,
        h("span", null, String(state.count)),
        h("button", { type: "button", "data-kind": "push", onClick: () => controller?.incrementAndPush() }, "push"),
        h("button", { type: "button", "data-kind": "replace", onClick: () => controller?.replace() }, "replace")
      )
  });

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`, {
    url: "http://localhost:4174/login"
  });
  let popstateCount = 0;
  dom.window.addEventListener("popstate", () => {
    popstateCount += 1;
  });
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  createRoot(app).render(h(UrlStateView, {}));
  assert.equal(app.querySelector("span")?.textContent, "0");

  app.querySelector<HTMLButtonElement>("[data-kind='push']")?.dispatchEvent(
    new dom.window.Event("click", { bubbles: true })
  );
  await Promise.resolve();

  assert.equal(dom.window.location.href, "http://localhost:4174/login?step=2#email");
  assert.equal(app.querySelector("span")?.textContent, "1");
  assert.equal(popstateCount, 0);

  app.querySelector<HTMLButtonElement>("[data-kind='replace']")?.dispatchEvent(
    new dom.window.Event("click", { bubbles: true })
  );

  assert.equal(dom.window.location.href, "http://localhost:4174/login?step=3");
  assert.equal(app.querySelector("span")?.textContent, "1");
  assert.equal(popstateCount, 0);

  clearDom();
});

test("createTavo exposes grouped page data on controllers", () => {
  class PageController extends TavoController {
    snapshot() {
      return `${this.page.pathname}:${this.page.status}:${this.page.route}:${JSON.stringify(this.page.params)}`;
    }
  }

  const PageView = createTavo({
    controller: PageController,
    view: ({ controller }) => h("p", null, controller?.snapshot())
  });

  const html = renderToString(h(PageView, {}));
  assert.match(html, /<p>\/:idle:null:\{\}<\/p>/);
});

test("createTavo keeps controller internals hidden from instance properties", () => {
  class PrivateInternalsController extends TavoController {
    visibleKeys() {
      return Object.getOwnPropertyNames(this).join(",");
    }
  }

  const PrivateInternalsView = createTavo({
    controller: PrivateInternalsController,
    view: ({ controller }) => h("p", null, controller?.visibleKeys())
  });

  const html = renderToString(h(PrivateInternalsView, {}));
  assert.doesNotMatch(html, /tavoTools/);
  assert.doesNotMatch(html, /tavoActionNotify/);
});

test("createTavo exposes global stores on controllers", () => {
  defineGlobalStore("test:controller-store", () => ({
    count: 7
  }));

  class StoreController extends TavoController {
    snapshot() {
      const store = this.stores.get("test:controller-store");
      return `${this.stores.has("test:controller-store")}:${this.stores.list().includes("test:controller-store")}:${store.getState().count}`;
    }
  }

  const StoreView = createTavo({
    controller: StoreController,
    view: ({ controller }) => h("p", null, controller?.snapshot())
  });

  const html = renderToString(h(StoreView, {}));
  assert.match(html, /<p>true:true:7<\/p>/);
});

test("createTavo exposes named services on controllers", () => {
  clearServices();
  const warnings = captureWarnings(() => {
    registerService("test:controller-service", {
      version: "1.0.0"
    });
  });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /service: "test:controller-service" was registered during SSR/);

  class ServiceController extends TavoController {
    snapshot() {
      const service = this.services.get("test:controller-service");
      return `${this.services.has("test:controller-service")}:${this.services.list().includes("test:controller-service")}:${service.version}`;
    }
  }

  const ServiceView = createTavo({
    controller: ServiceController,
    view: ({ controller }) => h("p", null, controller?.snapshot())
  });

  const html = renderToString(h(ServiceView, {}));
  assert.match(html, /<p>true:true:1\.0\.0<\/p>/);
});

test("services support typed keys and optional lookup", () => {
  clearServices();
  type MetricsService = {
    version: string;
    increment(name: string): string;
  };
  const metricsKey = createServiceKey<MetricsService>("test:metrics-service");
  const missingKey = createServiceKey<MetricsService>("test:missing-metrics-service");

  captureWarnings(() => {
    registerService(metricsKey, {
      version: "2.0.0",
      increment(name) {
        return `increment:${name}`;
      }
    });
  });

  assert.equal(hasService(metricsKey), true);
  assert.equal(getService(metricsKey).increment("views"), "increment:views");
  assert.equal(tryGetService(metricsKey)?.version, "2.0.0");
  assert.equal(tryGetService(missingKey), undefined);

  class MetricsController extends TavoController {
    snapshot() {
      return this.services.tryGet(metricsKey)?.increment("clicks") ?? "missing";
    }
  }

  const MetricsView = createTavo({
    controller: MetricsController,
    view: ({ controller }) => h("p", null, controller?.snapshot())
  });

  assert.match(renderToString(h(MetricsView, {})), /<p>increment:clicks<\/p>/);
});

test("services warn on duplicate registration unless override is explicit", () => {
  clearServices();

  const duplicateWarnings = captureWarnings(() => {
    registerService("test:duplicate-service", { version: "1.0.0" });
    registerService("test:duplicate-service", { version: "2.0.0" });
  });

  assert.equal(duplicateWarnings.length, 2);
  assert.match(duplicateWarnings[0], /registered during SSR/);
  assert.match(duplicateWarnings[1], /registered more than once/);
  assert.equal(getService<{ version: string }>("test:duplicate-service").version, "2.0.0");

  clearServices();
  const overrideWarnings = captureWarnings(() => {
    registerService("test:override-service", { version: "1.0.0" });
    registerService("test:override-service", { version: "2.0.0" }, { override: true });
  });

  assert.equal(overrideWarnings.length, 1);
  assert.match(overrideWarnings[0], /registered during SSR/);
  assert.equal(getService<{ version: string }>("test:override-service").version, "2.0.0");
});

test("testing helpers can unregister and clear services", () => {
  clearServices();
  captureWarnings(() => {
    registerService("test:cleanup-service", { ready: true });
    registerService("test:other-cleanup-service", { ready: true });
  });

  assert.equal(unregisterService("test:cleanup-service"), true);
  assert.equal(hasService("test:cleanup-service"), false);
  assert.equal(hasService("test:other-cleanup-service"), true);

  clearServices();
  assert.equal(hasService("test:other-cleanup-service"), false);
});

test("createTavo controller actions expose reactive async state", async () => {
  class ActionController extends TavoController {
    declare model: { patch(partial: Record<string, never>): void };

    save = this.action(async (value: string) => {
      await Promise.resolve();
      return value.toUpperCase();
    });
  }

  const ActionView = createTavo({
    model: () => ({}),
    controller: ActionController,
    view: ({ controller }) =>
      h(
        "button",
        { type: "button", onClick: () => controller?.save.run("done") },
        controller?.save.pending
          ? "saving"
          : controller?.save.result ?? "idle"
      )
  });

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  createRoot(app).render(h(ActionView, {}));
  const button = dom.window.document.querySelector("button");
  assert.ok(button);
  assert.equal(button.textContent, "idle");

  button.dispatchEvent(new dom.window.Event("click", { bubbles: true }));
  await Promise.resolve();
  assert.equal(button.textContent, "saving");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(button.textContent, "DONE");
  clearDom();
});

test("createTavo controllers can listen to external stores", async () => {
  let snapshot = "light";
  const listeners = new Set<() => void>();
  const themeStore = createExternalStore({
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  });

  class ExternalController extends TavoController {
    declare model: { patch(partial: { theme: string }): void };

    onMount() {
      return this.listenExternal(
        themeStore,
        (theme) => this.model.patch({ theme }),
        { immediate: true }
      );
    }
  }

  const ExternalView = createTavo({
    model: () => ({ theme: "unknown" }),
    controller: ExternalController,
    view: ({ state }) => h("p", null, state.theme)
  });

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  createRoot(app).render(h(ExternalView, {}));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(app.textContent, "light");

  snapshot = "dark";
  for (const listener of listeners) {
    listener();
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(app.textContent, "dark");
  clearDom();
});

test("createTavo runs controller layout hooks before passive afterRender hooks", async () => {
  const events: string[] = [];

  class LayoutController extends TavoController {
    onLayout() {
      events.push("layout");
      return () => events.push("layout-cleanup");
    }

    afterRender() {
      events.push("afterRender");
    }
  }

  const LayoutView = createTavo({
    controller: LayoutController,
    view: () => h("p", null, "ready")
  });

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const root = createRoot(app);
  root.render(h(LayoutView, {}));
  assert.deepEqual(events, ["layout"]);

  await Promise.resolve();
  assert.deepEqual(events, ["layout", "afterRender"]);

  root.unmount();
  assert.deepEqual(events, ["layout", "afterRender", "layout-cleanup"]);
  clearDom();
});

test("createTavo timer helpers run from client lifecycle and clean up on unmount", async () => {
  const events: string[] = [];

  class TimerController extends TavoController {
    onMount() {
      events.push("mount");
      this.setTimeout(() => events.push("timeout"), 0);
      this.setInterval(() => events.push("interval"), 5);
      return () => events.push("mount-cleanup");
    }
  }

  const TimerView = createTavo({
    controller: TimerController,
    view: () => h("p", null, "timer")
  });

  const html = renderToString(h(TimerView, {}));
  assert.match(html, /<p>timer<\/p>/);
  assert.deepEqual(events, []);

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const root = createRoot(app);
  root.render(h(TimerView, {}));
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(events[0], "mount");
  assert.ok(events.includes("timeout"));
  const intervalCountBeforeUnmount = events.filter((event) => event === "interval").length;
  assert.ok(intervalCountBeforeUnmount > 0);

  root.unmount();
  assert.ok(events.includes("mount-cleanup"));

  await new Promise((resolve) => setTimeout(resolve, 20));
  const intervalCountAfterUnmount = events.filter((event) => event === "interval").length;
  assert.equal(intervalCountAfterUnmount, intervalCountBeforeUnmount);
  clearDom();
});

test("createTavo timeout helper cancels pending callbacks on unmount", async () => {
  const events: string[] = [];

  class TimeoutController extends TavoController {
    onMount() {
      events.push("mount");
      this.setTimeout(() => events.push("timeout"), 25);
    }
  }

  const TimeoutView = createTavo({
    controller: TimeoutController,
    view: () => h("p", null, "timeout")
  });

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const root = createRoot(app);
  root.render(h(TimeoutView, {}));
  await Promise.resolve();
  assert.deepEqual(events, ["mount"]);

  root.unmount();
  await new Promise((resolve) => setTimeout(resolve, 35));
  assert.deepEqual(events, ["mount"]);
  clearDom();
});
