import test from "node:test";
import assert from "node:assert/strict";
import { h, lazy, renderToString, type Child } from "../../src/index.tsx";
import { renderToProgressiveStringChunks } from "../../src/render.ts";
import { normalizeChildren } from "../../src/runtime/dom/utils.ts";

async function collectProgressiveHtml(node: Parameters<typeof renderToProgressiveStringChunks>[0]) {
  let html = "";
  for await (const chunk of renderToProgressiveStringChunks(node)) {
    html += chunk;
  }
  return html;
}

test("SSR serializes void elements without closing tags", () => {
  const html = renderToString(
    h("main", null,
      "One",
      h("br", null),
      "Two",
      h("img", { src: "/coin.png", alt: "Coin" }),
      h("input", { type: "text", value: "BTC" })
    )
  );

  assert.equal(html, `<main>One<br>Two<img src="/coin.png" alt="Coin"><input type="text" value="BTC"></main>`);
  assert.doesNotMatch(html, /<\/(?:br|img|input)>/);
});

test("SSR joins className arrays with spaces", () => {
  assert.equal(
    renderToString(h("div", { className: ["card", "card--active"] })),
    `<div class="card card--active"></div>`
  );
});

test("progressive SSR serializes void elements without closing tags", async () => {
  const html = await collectProgressiveHtml(
    h("h1", null,
      "The Ultimate Crypto Tracker for Your",
      h("br", null),
      " Wallets & Exchanges"
    )
  );

  assert.equal(html, "<h1>The Ultimate Crypto Tracker for Your<br> Wallets &amp; Exchanges</h1>");
  assert.doesNotMatch(html, /<\/br>/);
});

test("lazy components render fallback during synchronous SSR", () => {
  let loadCalls = 0;
  const LazyPanel = lazy(
    async () => {
      loadCalls += 1;
      return () => h("strong", null, "Loaded");
    },
    {
      fallback: h("span", null, "Loading")
    }
  );

  const html = renderToString(h(LazyPanel, {}));

  assert.equal(html, "<span>Loading</span>");
  assert.equal(loadCalls, 0);
});

test("preloaded lazy components render loaded output during SSR", async () => {
  const LazyPanel = lazy(async () => ({
    default: ({ label }: { label: string }) => h("strong", null, label)
  }));

  await LazyPanel.preload();
  const html = renderToString(h(LazyPanel, { label: "Loaded" }));

  assert.equal(html, "<strong>Loaded</strong>");
});

test("h flattens deeply nested children without changing filtering or precedence", () => {
  let deeplyNested: Child = "deep";
  for (let index = 0; index < 10_000; index += 1) {
    deeplyNested = [deeplyNested];
  }

  const fromProps = h("div", {
    id: "nested",
    children: ["first", null, [false, "second", [undefined, true, deeplyNested]]]
  });
  assert.deepEqual(fromProps.props.children, ["first", "second", true, "deep"]);
  assert.deepEqual(Object.keys(fromProps.props), ["id", "children"]);

  const variadicWins = h(
    "div",
    { children: "ignored", title: "example" },
    ["kept", [null, "last"]]
  );
  assert.deepEqual(variadicWins.props.children, ["kept", "last"]);
  assert.deepEqual(Object.keys(variadicWins.props), ["title", "children"]);
});

test("DOM child normalization flattens deep arrays and coalesces adjacent text", () => {
  let deeplyNested: Child = ["c", 3, null, false, true, undefined, "d"];
  for (let index = 0; index < 10_000; index += 1) {
    deeplyNested = [deeplyNested];
  }

  const separator = h("strong", null, "separator");
  assert.deepEqual(
    normalizeChildren(["a", 1, ["b", 2, deeplyNested], separator, ["e", 4]]),
    ["a1b2c3d", separator, "e4"]
  );
});
