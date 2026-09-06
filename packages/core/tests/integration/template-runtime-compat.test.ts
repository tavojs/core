import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { TavoController, createDirective, createRoot, createTavo, h, style } from "../../src/index.tsx";
import { getComponentRuntimeDiagnostics } from "../../src/runtime/dom/component-runtime.ts";
import { getScheduledUpdateCount } from "../../src/runtime/dom/scheduler.ts";

type GlobalWithDom = typeof globalThis & {
  window?: Window & typeof globalThis;
  document?: Document;
  Node?: typeof Node;
  Element?: typeof Element;
  HTMLElement?: typeof HTMLElement;
  Text?: typeof Text;
};

function setupDom() {
  const dom = new JSDOM('<!doctype html><html><head></head><body><div id="app"></div></body></html>', {
    pretendToBeVisual: true
  });
  const target = globalThis as GlobalWithDom;
  target.window = dom.window as unknown as Window & typeof globalThis;
  target.document = dom.window.document;
  target.Node = dom.window.Node;
  target.Element = dom.window.Element;
  target.HTMLElement = dom.window.HTMLElement;
  target.Text = dom.window.Text;
  const container = dom.window.document.querySelector("#app");
  assert.ok(container);
  return { dom, container };
}

function clearDom(): void {
  const target = globalThis as GlobalWithDom;
  delete target.window;
  delete target.document;
  delete target.Node;
  delete target.Element;
  delete target.HTMLElement;
  delete target.Text;
}

test("checked root commits expose failures and release a partially failed root", async () => {
  const { container } = setupDom();
  const failure = new Error("synthetic trusted component failure");
  const observed: unknown[] = [];
  let destroyed = 0;
  let directiveCleanup = 0;

  class StableController extends TavoController {
    onDestroy() {
      destroyed += 1;
    }
  }

  const Stable = createTavo({
    model: () => ({ ready: true }),
    controller: StableController,
    view: () => h("p", null, "last good")
  });
  const cleanedDirective = createDirective(() => () => {
    directiveCleanup += 1;
  });
  const throwingDirective = createDirective(() => {
    throw failure;
  });

  try {
    const root = createRoot(container, {
      onError(error) {
        observed.push(error);
      }
    });
    assert.deepEqual(root.renderChecked(h(Stable, {})), { ok: true });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    assert.equal(container.textContent, "last good");

    const outcome = root.renderChecked(h("section", { use: [cleanedDirective, throwingDirective] }, h(Stable, {})));
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.error, failure);
    assert.deepEqual(observed, [failure]);
    assert.equal(container.childNodes.length, 0);
    assert.equal(destroyed, 2);
    assert.equal(directiveCleanup, 1);
    assert.deepEqual(getComponentRuntimeDiagnostics(), {
      mountedComponents: 0,
      pendingPassiveEffects: 0
    });
    assert.equal(getScheduledUpdateCount(), 0);

    assert.doesNotThrow(() => root.unmount());
    assert.doesNotThrow(() => root.unmount());
  } finally {
    clearDom();
  }
});

test("checked hydration failures release component and style resources", () => {
  const { container } = setupDom();
  const failure = new Error("synthetic hydration failure");
  let destroyed = 0;

  class HydratedController extends TavoController {
    onDestroy() {
      destroyed += 1;
    }
  }

  const FailingHydration = createTavo({
    model: () => ({ ready: true }),
    controller: HydratedController,
    view: () => {
      style("failed-hydration-style", ".failed-hydration { color: red; }");
      throw failure;
    }
  });

  try {
    container.innerHTML = "<p>server content</p>";
    const root = createRoot(container);
    const outcome = root.hydrateChecked(h(FailingHydration, {}));

    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.equal(outcome.error, failure);
    assert.equal(container.childNodes.length, 0);
    assert.equal(destroyed, 1);
    assert.equal(document.querySelector('[data-tavo-style="failed-hydration-style"]'), null);
    assert.deepEqual(getComponentRuntimeDiagnostics(), {
      mountedComponents: 0,
      pendingPassiveEffects: 0
    });
    assert.doesNotThrow(() => root.unmount());
  } finally {
    clearDom();
  }
});

test("a key change on a component's single child resets identity", () => {
  const { container } = setupDom();
  let instances = 0;

  const Stateful = createTavo({
    model: () => ({ instance: ++instances }),
    view: ({ props, state }) => h("span", { "data-id": props.id }, `${String(props.id)}:${state.instance}`)
  });
  const Shell = ({ id }: { id: string }) => h(Stateful, { id, key: id });

  try {
    const root = createRoot(container);
    assert.equal(root.renderChecked(h(Shell, { id: "alpha" })).ok, true);
    const first = container.querySelector("span");
    assert.equal(first?.textContent, "alpha:1");

    assert.equal(root.renderChecked(h(Shell, { id: "beta" })).ok, true);
    const second = container.querySelector("span");
    assert.equal(second?.textContent, "beta:2");
    assert.notEqual(second, first);
    root.unmount();
  } finally {
    clearDom();
  }
});

test("keyed sibling reorder preserves each component store and DOM identity", () => {
  const { container } = setupDom();
  let instances = 0;

  const Item = createTavo({
    model: () => ({ instance: ++instances }),
    view: ({ props, state }) => h("li", { "data-id": props.id }, `${String(props.id)}:${state.instance}`)
  });
  const List = ({ ids }: { ids: string[] }) =>
    h(
      "ul",
      null,
      ids.map((id) => h(Item, { id, key: id }))
    );

  try {
    const root = createRoot(container);
    assert.equal(root.renderChecked(h(List, { ids: ["a", "b", "c"] })).ok, true);
    const original = new Map(
      Array.from(container.querySelectorAll("li"), (node) => [node.getAttribute("data-id"), node])
    );

    assert.equal(root.renderChecked(h(List, { ids: ["c", "a", "b"] })).ok, true);
    assert.deepEqual(
      Array.from(container.querySelectorAll("li"), (node) => node.textContent),
      ["c:3", "a:1", "b:2"]
    );
    for (const node of container.querySelectorAll("li")) {
      assert.equal(node, original.get(node.getAttribute("data-id")));
    }
    root.unmount();
    assert.equal(getComponentRuntimeDiagnostics().mountedComponents, 0);
  } finally {
    clearDom();
  }
});

test("duplicate sibling keys fail deterministically before mounting duplicates", () => {
  const { container } = setupDom();
  try {
    const root = createRoot(container);
    const outcome = root.renderChecked(
      h("ul", null, [h("li", { key: "same" }, "first"), h("li", { key: "same" }, "second")])
    );
    assert.equal(outcome.ok, false);
    if (!outcome.ok) assert.match(String(outcome.error), /duplicate key "same"/);
    assert.equal(container.childNodes.length, 0);
    root.unmount();
  } finally {
    clearDom();
  }
});
