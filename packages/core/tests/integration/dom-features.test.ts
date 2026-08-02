import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import {
  autoFocus,
  createDirective,
  createRef,
  createRoot,
  createTavo,
  h,
  lazy,
  mergeRefs,
  setRef,
  TavoController,
  transition
} from "../../src/index.tsx";

type GlobalWithDom = typeof globalThis & {
  window?: Window & typeof globalThis;
  document?: Document;
  Node?: typeof Node;
  HTMLElement?: typeof HTMLElement;
  Text?: typeof Text;
  ResizeObserver?: typeof ResizeObserver;
};

function setupDom(markup: string) {
  const dom = new JSDOM(markup, { pretendToBeVisual: true });
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
  delete globalRef.ResizeObserver;
}

function flushPostRender(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

test("className accepts strings and arrays of strings", () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const root = createRoot(app);
  root.render(h("div", { className: "card" }));
  assert.equal(app.firstElementChild?.getAttribute("class"), "card");

  root.render(h("div", { className: ["card", "card--active"] }));
  assert.equal(app.firstElementChild?.getAttribute("class"), "card card--active");
  clearDom();
});

test("element directives run on mount, rerun when changed, and clean up", () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const events: string[] = [];
  const first = createDirective((node) => {
    events.push(`first:${node.tagName.toLowerCase()}`);
    return () => events.push("first:cleanup");
  });
  const second = createDirective(() => {
    events.push("second");
    return () => events.push("second:cleanup");
  });

  const root = createRoot(app);
  root.render(h("section", { use: first }));
  root.render(h("section", { use: second }));
  root.unmount();

  assert.deepEqual(events, ["first:section", "first:cleanup", "second", "second:cleanup"]);
  clearDom();
});

test("element directive arrays run when combined with transitions", () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const events: string[] = [];
  const first = createDirective((node) => {
    events.push(`first:${node.tagName.toLowerCase()}`);
  });
  const second = createDirective(() => {
    events.push("second");
  });

  const root = createRoot(app);
  root.render(
    h("section", {
      transition: {
        onEnter: () => events.push("enter")
      },
      use: [first, undefined, false, second]
    })
  );

  assert.deepEqual(events, ["enter", "first:section", "second"]);
  clearDom();
});

test("transition directive applies enter classes and calls leave cleanup", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const events: string[] = [];
  const root = createRoot(app);
  root.render(
    h("div", {
      transition: {
        classes: { enter: "enter", enterActive: "active", leave: "leave" },
        onEnter: () => events.push("enter"),
        onLeave: () => events.push("leave")
      }
    })
  );

  const element = app.querySelector("div");
  assert.ok(element);
  assert.equal(element.classList.contains("enter"), true);
  await Promise.resolve();
  assert.equal(element.classList.contains("active"), true);

  root.unmount();
  assert.deepEqual(events, ["enter", "leave"]);
  clearDom();
});

test("controller timing helpers can access refs after render", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const events: string[] = [];
  class PanelController extends TavoController {
    panel = createRef<HTMLDivElement>();

    onMount() {
      events.push(this.panel.current?.id ?? "missing");
      return () => events.push("mount-cleanup");
    }

    afterRender() {
      events.push(`after:${this.panel.current?.tagName.toLowerCase()}`);
    }
  }

  const Panel = createTavo({
    controller: PanelController,
    view: ({ controller }) => h("div", { id: "panel", ref: controller?.panel })
  });

  const root = createRoot(app);
  root.render(h(Panel, {}));
  await flushPostRender();
  assert.deepEqual(events, ["panel", "after:div"]);
  root.unmount();
  assert.deepEqual(events, ["panel", "after:div", "mount-cleanup"]);
  clearDom();
});

test("controller observer helpers auto-disconnect on unmount", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  let disconnects = 0;
  class FakeResizeObserver {
    constructor(_listener: ResizeObserverCallback) {}
    observe(_element: Element) {}
    disconnect() {
      disconnects += 1;
    }
    unobserve(_element: Element) {}
  }

  (globalThis as GlobalWithDom).ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;

  class PanelController extends TavoController {
    panel = createRef<HTMLDivElement>();

    onMount() {
      this.observeResize(this.panel, () => {});
    }
  }

  const Panel = createTavo({
    controller: PanelController,
    view: ({ controller }) => h("div", { ref: controller?.panel })
  });

  const root = createRoot(app);
  root.render(h(Panel, {}));
  await flushPostRender();
  root.unmount();
  assert.equal(disconnects, 1);
  clearDom();
});

test("ref utilities set, merge, and clear refs", () => {
  const dom = setupDom(`<!doctype html><html><body><button></button></body></html>`);
  const button = dom.window.document.querySelector("button");
  assert.ok(button);

  const first = createRef<HTMLButtonElement>();
  const second = createRef<HTMLButtonElement>();
  const merged = mergeRefs(first, second);

  setRef(merged, button);
  assert.equal(first.current, button);
  assert.equal(second.current, button);

  setRef(merged, null);
  assert.equal(first.current, null);
  assert.equal(second.current, null);
  clearDom();
});

test("controlled text inputs restore static model values after user input", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const Field = createTavo({
    model: () => ({ text: "pinned" }),
    view: ({ state }) => h("input", { type: "text", value: state.text })
  });

  createRoot(app).render(h(Field, {}));
  const input = app.querySelector("input");
  assert.ok(input);

  input.value = "typed";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await Promise.resolve();

  assert.equal(input.value, "pinned");
  assert.equal(input.getAttribute("value"), "pinned");
  clearDom();
});

test("onChange receives live typing updates for text inputs", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  class FieldController extends TavoController {
    update(event: Event) {
      const target = event.target as HTMLInputElement;
      this.model.patch({ text: target.value });
    }
  }

  const Field = createTavo({
    model: () => ({ text: "" }),
    controller: FieldController,
    view: ({ state, controller }) =>
      h("input", {
        type: "text",
        value: state.text,
        onChange: (event: Event) => controller?.update(event)
      })
  });

  createRoot(app).render(h(Field, {}));
  const input = app.querySelector("input");
  assert.ok(input);

  input.value = "a";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await Promise.resolve();
  assert.equal(input.value, "a");
  assert.equal(input.getAttribute("value"), "a");

  input.value = "ab";
  input.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  await Promise.resolve();
  assert.equal(input.value, "ab");
  assert.equal(input.getAttribute("value"), "ab");
  clearDom();
});

test("autoFocus directive focuses after mount", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  createRoot(app).render(h("button", { use: autoFocus() }, "Focus"));
  await Promise.resolve();
  assert.equal(dom.window.document.activeElement, app.querySelector("button"));
  clearDom();
});

test("lazy components load on first DOM render and replace fallback", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  let resolveLoader: (() => void) | null = null;
  const loaderReady = new Promise<void>((resolve) => {
    resolveLoader = resolve;
  });
  const LazyPanel = lazy(
    async () => {
      await loaderReady;
      return {
        default: ({ label }: { label: string }) => h("strong", null, label)
      };
    },
    {
      fallback: h("span", { "data-state": "loading" }, "Loading")
    }
  );

  const root = createRoot(app);
  root.render(h(LazyPanel, { label: "Ready" }));
  assert.equal(app.querySelector("span")?.textContent, "Loading");

  resolveLoader?.();
  await flushPostRender();
  await flushPostRender();

  assert.equal(app.querySelector("strong")?.textContent, "Ready");
  assert.equal(app.querySelector("span"), null);
  root.unmount();
  clearDom();
});

test("lazy components render error fallback after loader failure", async () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const LazyPanel = lazy(
    async () => {
      await Promise.resolve();
      throw new Error("chunk failed");
    },
    {
      fallback: "Loading",
      errorFallback: ({ error }) =>
        h("span", { "data-state": "error" }, error instanceof Error ? error.message : "error")
    }
  );

  const root = createRoot(app);
  root.render(h(LazyPanel, {}));
  assert.equal(app.textContent, "Loading");

  await flushPostRender();
  await flushPostRender();

  assert.equal(app.querySelector("[data-state='error']")?.textContent, "chunk failed");
  root.unmount();
  clearDom();
});
