import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { createRoot } from "../../src/dom.ts";
import { h, renderToString, type Component } from "../../src/index.tsx";
import {
  createSvgComponentPlugin,
  transformSvgToTavoComponent
} from "../../src/config/svg-component.ts";

type GlobalWithDom = typeof globalThis & {
  window?: Window & typeof globalThis;
  document?: Document;
  Node?: typeof Node;
  Element?: typeof Element;
  HTMLElement?: typeof HTMLElement;
  SVGElement?: typeof SVGElement;
  Text?: typeof Text;
};

function setupDom(markup: string) {
  const dom = new JSDOM(markup, { pretendToBeVisual: true });
  const globalRef = globalThis as GlobalWithDom;
  globalRef.window = dom.window as unknown as Window & typeof globalThis;
  globalRef.document = dom.window.document;
  globalRef.Node = dom.window.Node;
  globalRef.Element = dom.window.Element;
  globalRef.HTMLElement = dom.window.HTMLElement;
  globalRef.SVGElement = dom.window.SVGElement;
  globalRef.Text = dom.window.Text;
  return dom;
}

function clearDom() {
  const globalRef = globalThis as GlobalWithDom;
  delete globalRef.window;
  delete globalRef.document;
  delete globalRef.Node;
  delete globalRef.Element;
  delete globalRef.HTMLElement;
  delete globalRef.SVGElement;
  delete globalRef.Text;
}

function evaluateGeneratedComponent(code: string): Component<Record<string, unknown>> {
  const body = code
    .replace('import { h } from "@tavojs/core";', "")
    .replace("export default function SvgComponent", "return function SvgComponent");
  return new Function("h", body)(h) as Component<Record<string, unknown>>;
}

test("svg component transformer converts nested SVG into a Tavo component", () => {
  const code = transformSvgToTavoComponent(`
    <svg viewBox="0 0 24 24" class="source" onclick="bad()">
      <title>Tavo &amp; SVG</title>
      <g fill="currentColor">
        <path d="M4 4h16v16H4z" stroke-width="2" />
      </g>
      <script>alert("bad")</script>
    </svg>
  `);
  const Icon = evaluateGeneratedComponent(code);
  const html = renderToString(
    h(Icon, {
      className: "consumer",
      style: { color: "tomato" },
      "aria-label": "Tavo"
    })
  );

  assert.match(html, /<svg /);
  assert.match(html, /viewBox="0 0 24 24"/);
  assert.match(html, /class="consumer"/);
  assert.match(html, /style="color:tomato"/);
  assert.match(html, /aria-label="Tavo"/);
  assert.match(html, /fill="currentColor"/);
  assert.match(html, /stroke-width="2"/);
  assert.match(html, /Tavo &amp; SVG/);
  assert.doesNotMatch(html, /onclick/);
  assert.doesNotMatch(html, /script/);
});

test("svg component Vite plugin only handles svg component query imports", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-svg-component-"));
  try {
    const file = path.join(root, "icon.svg");
    await fs.writeFile(file, '<svg viewBox="0 0 1 1"><circle cx="0.5" cy="0.5" r="0.5"/></svg>');
    const plugin = createSvgComponentPlugin();

    assert.equal(await plugin.load(`${file}`), null);
    const code = await plugin.load(`${file}?component`);

    assert.ok(code);
    assert.match(code, /export default function SvgComponent/);
    assert.match(code, /h\("circle"/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("svg elements mount in the SVG namespace", () => {
  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  createRoot(app).render(
    h("svg", { viewBox: "0 0 24 24" }, h("path", { d: "M4 4h16v16H4z" }))
  );

  const svg = app.querySelector("svg");
  const pathNode = app.querySelector("path");
  assert.ok(svg);
  assert.ok(pathNode);
  assert.equal(svg.namespaceURI, "http://www.w3.org/2000/svg");
  assert.equal(pathNode.namespaceURI, "http://www.w3.org/2000/svg");
  clearDom();
});

test("svg SSR output hydrates without replacing the existing node", () => {
  const vnode = h("svg", { viewBox: "0 0 24 24" }, h("path", { d: "M4 4h16v16H4z" }));
  const html = renderToString(vnode);
  const dom = setupDom(`<!doctype html><html><body><div id="app">${html}</div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);
  const originalSvg = app.querySelector("svg");
  assert.ok(originalSvg);

  createRoot(app).hydrate(vnode);

  assert.equal(app.querySelector("svg"), originalSvg);
  assert.equal(originalSvg.namespaceURI, "http://www.w3.org/2000/svg");
  clearDom();
});
