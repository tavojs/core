import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createRef, createRoot, h, renderToString } from "../../src/index.tsx";

type GlobalWithDom = typeof globalThis & {
  window?: Window & typeof globalThis;
  document?: Document;
  Node?: typeof Node;
  HTMLElement?: typeof HTMLElement;
  Text?: typeof Text;
};

function setupDom(markup: string) {
  const dom = new JSDOM(markup);
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

test("dom refs assign object refs on mount, move on patch, and clear on unmount", () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const firstRef = createRef<HTMLInputElement>();
  const secondRef = createRef<HTMLInputElement>();
  const root = createRoot(app);

  root.render(h("input", { ref: firstRef, id: "search" }));
  assert.equal(firstRef.current, app.querySelector("input"));
  assert.equal(app.querySelector("input")?.hasAttribute("ref"), false);

  root.render(h("input", { ref: secondRef, id: "search" }));
  assert.equal(firstRef.current, null);
  assert.equal(secondRef.current, app.querySelector("input"));

  root.unmount();
  assert.equal(secondRef.current, null);
  clearDom();
});

test("dom refs support callback refs during hydration and cleanup", () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"><button>Ready</button></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const calls: Array<Element | null> = [];
  const root = createRoot(app);

  root.hydrate(h("button", { ref: (node: HTMLButtonElement | null) => calls.push(node) }, "Ready"));
  assert.equal(calls[0], app.querySelector("button"));

  root.unmount();
  assert.equal(calls[1], null);
  clearDom();
});

test("dom refs remain assigned when an element is replaced with the same ref", () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  const ref = createRef<HTMLElement>();
  const root = createRoot(app);

  root.render(h("input", { ref }));
  assert.equal(ref.current?.tagName.toLowerCase(), "input");

  root.render(h("textarea", { ref }));
  assert.equal(ref.current, app.querySelector("textarea"));

  root.unmount();
  assert.equal(ref.current, null);
  clearDom();
});

test("server rendering skips ref attributes", () => {
  const ref = createRef<HTMLDivElement>();
  const html = renderToString(h("div", { ref, id: "panel" }, "Panel"));

  assert.equal(html, `<div id="panel">Panel</div>`);
  assert.equal(ref.current, null);
});
