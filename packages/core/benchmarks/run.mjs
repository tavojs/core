import { performance } from "node:perf_hooks";
import fs from "node:fs/promises";
import path from "node:path";
import { JSDOM } from "jsdom";
import { h, renderToString, createStore, createRoot } from "../dist/index.js";
import { computedStore } from "../dist/store/index.js";
import { createPagesRuntime, renderPagesResponseAsync } from "../dist/framework/index.js";
import { createMemoryStaticCache } from "../dist/ssr/index.js";
import { createFetchRequestHandler } from "../dist/ssr/handlers.js";
import { renderDocument, renderDocumentStream } from "../dist/server.js";
import { normalizeChildren } from "../dist/runtime/dom/utils.js";

let sink = 0;
const jsonIndex = process.argv.indexOf("--json");
const jsonOutputPath = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : null;
const baselineIndex = process.argv.indexOf("--baseline");
const baselinePath = baselineIndex >= 0 ? process.argv[baselineIndex + 1] : null;
const maxRegressionPercent = 35;
const baselinePayload = baselinePath
  ? JSON.parse(await fs.readFile(path.resolve(baselinePath), "utf8"))
  : null;
const baselineByName = new Map(
  (baselinePayload?.benchmarks ?? []).map((entry) => [entry.name, entry])
);

function consume(value) {
  if (typeof value === "number") {
    sink ^= value | 0;
    return;
  }
  if (typeof value === "string") {
    sink ^= value.length;
  }
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(value);
}

function formatDuration(value) {
  return `${value < 0.01 ? value.toFixed(6) : value.toFixed(2)} ms`;
}

async function runBenchmark(name, options, fn) {
  const rounds = options.rounds ?? 6;
  const iterations = options.iterations ?? 1_000;
  const warmupIterations = options.warmupIterations ?? Math.max(100, Math.floor(iterations / 10));
  const isAsync = options.async === true;

  for (let i = 0; i < warmupIterations; i += 1) {
    consume(isAsync ? await fn(i) : fn(i));
  }

  const samples = [];
  for (let round = 0; round < rounds; round += 1) {
    const startedAt = performance.now();
    for (let i = 0; i < iterations; i += 1) {
      consume(isAsync ? await fn(i) : fn(i));
    }
    const elapsedMs = performance.now() - startedAt;
    samples.push(elapsedMs);
  }

  const avgMs = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  return {
    name,
    iterations,
    avgMs,
    avgOpMs: avgMs / iterations,
    opsPerSecond: (iterations / avgMs) * 1_000
  };
}

function makeTree(depth, breadth, path = "n") {
  if (depth === 0) {
    return h("span", { className: "leaf" }, path);
  }

  const children = [];
  for (let i = 0; i < breadth; i += 1) {
    children.push(makeTree(depth - 1, breadth, `${path}-${i}`));
  }

  return h("section", { className: `d-${depth}` }, ...children);
}

function installDomGlobals(dom) {
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Node = dom.window.Node;
  globalThis.Text = dom.window.Text;
  globalThis.HTMLElement = dom.window.HTMLElement;
  globalThis.Event = dom.window.Event;
  globalThis.MouseEvent = dom.window.MouseEvent;
  globalThis.PopStateEvent = dom.window.PopStateEvent;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: dom.window.navigator
  });
}

async function readStream(stream) {
  const reader = stream.getReader();
  let out = "";
  const decoder = new TextDecoder();
  while (true) {
    const result = await reader.read();
    if (result.done) {
      break;
    }
    out += decoder.decode(result.value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

const staticTree = makeTree(3, 4);
const listItems = Array.from({ length: 1_000 }, (_, index) =>
  h(
    "li",
    {
      key: `item-${index}`,
      className: index % 2 === 0 ? "even" : "odd",
      style: {
        paddingInline: `${index % 5}px`
      }
    },
    `Item ${index}`
  )
);
const listTree = h("ul", { className: "items" }, ...listItems);

const store = createStore({ count: 0, label: "tavo", values: [1, 2, 3, 4] });
const derivedStore = computedStore(store, (state) => ({
  label: `${state.label}:${state.count}`
}));
store.subscribe(() => {
  sink ^= 1;
});
store.subscribeSelector(
  (state) => state.count,
  (next) => {
    sink ^= next & 1;
  }
);
store.watch("label", (next) => {
  sink ^= next.length;
});

const pageModules = {
  "/src/pages/index.tsx": {
    default: () => h("main", null, "home")
  },
  "/src/pages/blog/[id].tsx": {
    load: async ({ params }) => ({ id: params.id }),
    default: (props) => h("main", null, `blog:${props.params.id}:${props.data?.id}`)
  },
  "/src/pages/404.tsx": {
    default: (props) => h("main", null, `404:${props.pathname}`)
  }
};
const pagesRuntime = createPagesRuntime(pageModules);
const staticPageModules = {
  "/src/pages/index.tsx": {
    revalidate: 60,
    load: async () => ({ ok: true }),
    default: (props) => h("main", null, `static:${String(props.data?.ok)}`)
  }
};
const staticPagesRuntime = createPagesRuntime(staticPageModules);
const largeRouteModules = {};
for (let index = 0; index < 250; index += 1) {
  largeRouteModules[`/src/pages/bench/route-${index}/[id].tsx`] = {
    default: (props) => h("main", null, `large:${props.params.id}`)
  };
}
const largePagesRuntime = createPagesRuntime(largeRouteModules);
const manyStaticCache = createMemoryStaticCache();
const manyStaticHandler = createFetchRequestHandler({
  staticCache: manyStaticCache,
  modules: {
    "/src/pages/cache/[id].tsx": {
      static: true,
      revalidate: 120,
      load: async ({ params }) => ({ id: params.id }),
      default: (props) => h("main", null, `cache:${props.data?.id}`)
    }
  }
});
for (let index = 0; index < 100; index += 1) {
  await manyStaticHandler(new Request(`http://localhost/cache/${index}`));
}

const benchmarkDom = new JSDOM("<!doctype html><div id='app'></div>");
installDomGlobals(benchmarkDom);
const benchmarkContainer = benchmarkDom.window.document.getElementById("app");
const benchmarkRoot = createRoot(benchmarkContainer);
const keyedList = (order) =>
  h(
    "ul",
    { className: "items" },
    ...order.map((index) =>
      h("li", { key: `item-${index}`, className: index % 2 === 0 ? "even" : "odd" }, `Item ${index}`)
    )
  );
const keyedForward = Array.from({ length: 200 }, (_, index) => index);
const keyedReverse = [...keyedForward].reverse();
benchmarkRoot.render(keyedList(keyedForward));

const hydrationMarkup = renderToString(staticTree);
const hydrationTree = staticTree;
const mediumInteractiveTree = h(
  "section",
  { className: "medium" },
  ...Array.from({ length: 80 }, (_, index) =>
    h("button", { type: "button", key: `button-${index}` }, `Action ${index}`)
  )
);
const mediumHydrationMarkup = renderToString(mediumInteractiveTree);
const nestedChildInput = ["a", null, ["b", false, ["c", undefined, [1, true]]]];
let deepChildInput = "leaf";
for (let index = 0; index < 64; index += 1) {
  deepChildInput = [deepChildInput];
}

const benchmarkJobs = [
  ["h (nested child normalization)", { iterations: 200_000, maxAvgOpMs: 0.0005 }, () => {
    return h("div", { id: "nested", children: nestedChildInput }).props.children.length;
  }],
  ["h (64-level child normalization)", { iterations: 50_000, maxAvgOpMs: 0.003 }, () => {
    return h("div", { id: "deep", children: deepChildInput }).props.children.length;
  }],
  ["dom normalizeChildren (nested)", { iterations: 200_000, maxAvgOpMs: 0.0007 }, () => {
    return normalizeChildren(nestedChildInput).length;
  }],
  ["dom normalizeChildren (64 levels)", { iterations: 50_000, maxAvgOpMs: 0.003 }, () => {
    return normalizeChildren(deepChildInput).length;
  }],
  ["renderToString (nested tree)", { iterations: 2_000, maxAvgMs: 120 }, () => {
    return renderToString(staticTree);
  }],
  ["renderToString (1000 keyed list)", { iterations: 350, maxAvgOpMs: 1.25 }, () => {
    return renderToString(listTree);
  }],
  ["renderDocument (SSR html shell)", { iterations: 1_000, maxAvgOpMs: 0.05 }, () => {
    return renderDocument(staticTree, {
      title: "tavo benchmark",
      initialState: { v: 1, ok: true }
    });
  }],
  ["renderDocumentStream (SSR html shell)", { async: true, iterations: 300, maxAvgOpMs: 0.15 }, async () => {
    return readStream(
      renderDocumentStream(staticTree, {
        title: "tavo benchmark",
        initialState: { v: 1, ok: true }
      })
    );
  }],
  ["store.patch (counter updates)", { iterations: 200_000, maxAvgOpMs: 0.0003 }, () => {
    return store.patch((previous) => ({ count: previous.count + 1 })).count;
  }],
  ["store.setState (object replace)", { iterations: 100_000, maxAvgOpMs: 0.0003 }, () => {
    return store.setState((previous) => ({
      ...previous,
      count: previous.count + 1
    })).count;
  }],
  ["store.watch (nested path updates)", { iterations: 150_000, maxAvgOpMs: 0.00025 }, () => {
    return store.watch("label", () => {})();
  }],
  ["computedStore read (derived state)", { iterations: 200_000, maxAvgOpMs: 0.00008 }, () => {
    return derivedStore.getState().label;
  }],
  ["pages resolvePath (dynamic route)", { iterations: 100_000, maxAvgOpMs: 0.0004 }, () => {
    return pagesRuntime.resolvePath("/blog/hello").params.id;
  }],
  ["pages resolvePathAsync (static cache hit)", { async: true, iterations: 20_000, maxAvgOpMs: 0.005 }, async () => {
    const response = await staticPagesRuntime.resolvePathAsync("/");
    return response.status;
  }],
  ["pages resolvePath (large route tree)", { iterations: 30_000, maxAvgOpMs: 0.012 }, () => {
    return largePagesRuntime.resolvePath("/bench/route-199/hello").params.id;
  }],
  ["renderPagesResponseAsync (loader route)", { async: true, iterations: 1_000, maxAvgOpMs: 0.1 }, async () => {
    const response = await renderPagesResponseAsync(pageModules, "/blog/hello");
    return response.html;
  }],
  ["fetch handler (100 static cache entries)", { async: true, iterations: 1_000, maxAvgOpMs: 0.25 }, async (index) => {
    const response = await manyStaticHandler(new Request(`http://localhost/cache/${index % 100}`));
    return response.status;
  }],
  ["dom patch (200 keyed reverse)", { iterations: 750, maxAvgOpMs: 4.5 }, () => {
    benchmarkRoot.render(keyedList(keyedReverse));
    benchmarkRoot.render(keyedList(keyedForward));
    return benchmarkContainer.childNodes.length;
  }],
  ["dom hydrate (simple page)", { iterations: 400, maxAvgOpMs: 3 }, () => {
    const dom = new JSDOM(`<!doctype html><div id="app">${hydrationMarkup}</div>`);
    installDomGlobals(dom);
    const container = dom.window.document.getElementById("app");
    const root = createRoot(container);
    root.hydrate(hydrationTree);
    return container.childNodes.length;
  }],
  ["dom hydrate (medium interactive page)", { iterations: 200, maxAvgOpMs: 5 }, () => {
    const dom = new JSDOM(`<!doctype html><div id="app">${mediumHydrationMarkup}</div>`);
    installDomGlobals(dom);
    const container = dom.window.document.getElementById("app");
    const root = createRoot(container);
    root.hydrate(mediumInteractiveTree);
    return container.querySelectorAll("button").length;
  }]
];

const benchmarks = [];
for (const [name, options, fn] of benchmarkJobs) {
  const result = await runBenchmark(name, options, fn);
  const threshold = {
    maxAvgMs: typeof options.maxAvgMs === "number" ? options.maxAvgMs : null,
    maxAvgOpMs: typeof options.maxAvgOpMs === "number" ? options.maxAvgOpMs : null,
    maxRegressionPercent: baselineByName.has(name) ? maxRegressionPercent : null
  };
  const baseline = baselineByName.get(name);
  const regressionPercent = baseline?.avgOpMs > 0
    ? ((result.avgOpMs - baseline.avgOpMs) / baseline.avgOpMs) * 100
    : null;
  const thresholdFailures = [];
  if (threshold.maxAvgMs !== null && result.avgMs > threshold.maxAvgMs) {
    thresholdFailures.push(`avgMs expected <= ${formatDuration(threshold.maxAvgMs)}, got ${formatDuration(result.avgMs)}`);
  }
  if (threshold.maxAvgOpMs !== null && result.avgOpMs > threshold.maxAvgOpMs) {
    thresholdFailures.push(`avgOpMs expected <= ${formatDuration(threshold.maxAvgOpMs)}, got ${formatDuration(result.avgOpMs)}`);
  }
  if (
    threshold.maxRegressionPercent !== null &&
    regressionPercent !== null &&
    regressionPercent > threshold.maxRegressionPercent
  ) {
    thresholdFailures.push(
      `avgOpMs regressed ${regressionPercent.toFixed(1)}% from baseline; expected <= ${threshold.maxRegressionPercent}%`
    );
  }
  benchmarks.push({
    ...result,
    baselineAvgOpMs: baseline?.avgOpMs ?? null,
    regressionPercent,
    threshold,
    thresholdStatus: thresholdFailures.length === 0 ? "pass" : "fail",
    thresholdFailures
  });
}

const nameWidth = Math.max(...benchmarks.map((entry) => entry.name.length), 10);
const line = "-".repeat(nameWidth + 38);

console.log("\ntavo benchmark suite");
console.log(line);
console.log(
  `${"benchmark".padEnd(nameWidth)}  ${"iterations".padStart(10)}  ${"avg ms".padStart(10)}  ${"op ms".padStart(10)}  ${"ops/sec".padStart(12)}`
);
console.log(line);

for (const result of benchmarks) {
  console.log(
    `${result.name.padEnd(nameWidth)}  ${formatNumber(result.iterations).padStart(10)}  ${formatNumber(result.avgMs).padStart(10)}  ${formatNumber(result.avgOpMs).padStart(10)}  ${formatNumber(result.opsPerSecond).padStart(12)}`
  );
}

console.log(line);
console.log(`sink=${sink}`);

if (jsonOutputPath) {
  await fs.mkdir(path.dirname(path.resolve(jsonOutputPath)), { recursive: true });
  await fs.writeFile(
    jsonOutputPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      node: process.version,
      baseline: baselinePath ? path.resolve(baselinePath) : null,
      benchmarks
    }, null, 2)}\n`,
    "utf8"
  );
  console.log(`json: ${jsonOutputPath}`);
}

const failures = [];
for (const result of benchmarks) {
  for (const failure of result.thresholdFailures) {
    failures.push(`${result.name}: ${failure}`);
  }
}

if (failures.length > 0) {
  console.error("\nBenchmark thresholds exceeded:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
}
