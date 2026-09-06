import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { Deferred, createDeferredValue, h } from "../../src/index.tsx";
import { renderToProgressiveStringChunks } from "../../src/render.ts";

test("progressive output retains every settled boundary while the consumer is paused", async () => {
  const blocks = Array.from({ length: 5 }, (_, index) => h(Deferred, {
    id: `block-${index}`,
    value: index === 3 ? Promise.reject(new Error("private detail")) : Promise.resolve(`ready-${index}`),
    fallback: "loading",
    errorFallback: "failed safely",
  }, (value: string) => h("strong", null, value)));
  const chunks = renderToProgressiveStringChunks(h("main", null, blocks));
  const shell = await chunks.next();
  assert.equal(shell.done, false);
  await new Promise((resolve) => setTimeout(resolve, 5));
  let html = shell.value as string;
  for await (const chunk of chunks) html += chunk;
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  try {
    assert.equal(dom.window.document.querySelectorAll("[data-tavo-deferred]").length, 0);
    assert.equal(dom.window.document.querySelectorAll("strong").length, 4);
    assert.match(dom.window.document.body.textContent ?? "", /failed safely/);
    assert.doesNotMatch(html, /private detail/);
  } finally {
    dom.window.close();
  }
});

test("already settled shared values update late shell targets and nested boundaries", async () => {
  const value = createDeferredValue(Promise.resolve("shared result"), { id: "shared" });
  const boundary = (fallback: ReturnType<typeof h> | string) => h(Deferred, {
    value, fallback,
  }, (result: string) => h("b", null, result));
  const nested = h(Deferred, { id: "outer", value: Promise.resolve("outer"), fallback: "outer loading" },
    () => h("section", null, boundary("inner loading")));
  let html = "";
  for await (const chunk of renderToProgressiveStringChunks(h("main", null,
    boundary("first loading"), boundary(h("section", null, h("p", null, "deep fallback"))), nested,
  ))) html += chunk;
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  try {
    assert.equal(dom.window.document.querySelectorAll("[data-tavo-deferred]").length, 0);
    assert.deepEqual(Array.from(dom.window.document.querySelectorAll("b"), (node) => node.textContent),
      ["shared result", "shared result", "shared result"]);
  } finally {
    dom.window.close();
  }
});
