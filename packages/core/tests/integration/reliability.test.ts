import test from "node:test";
import assert from "node:assert/strict";
import { h } from "../../src/index.tsx";
import {
  definePlugin,
  definePluginPhase,
} from "../../src/plugins/index.ts";
import { inspectPluginGraph } from "../../src/plugins/compiler.ts";
import { createNodeRequestHandler } from "../../src/ssr/index.ts";
import { createFetchRequestHandler } from "../../src/ssr/handlers.ts";
import type { SsrStaticCache } from "../../src/ssr/index.ts";
import { createResource } from "../../src/resources/index.ts";
import { responseHeadersFromFetch } from "../../src/ssr/headers.ts";
import { createPagesRuntime, defineAction } from "../../src/framework/index.ts";
import { isTavoError, TavoError } from "../../src/diagnostics.ts";
import { getApiStability, TAVO_API_STABILITY } from "../../src/stability.ts";
import {
  createInstrumentation,
  createOpenTelemetryInstrumentation,
  type TavoInstrumentationEvent,
} from "../../src/instrumentation.ts";

test("reliability: Fetch header conversion emits one canonical Set-Cookie entry", () => {
  const headers = new Headers();
  headers.append("Set-Cookie", "a=1; Path=/");
  headers.append("Set-Cookie", "b=2; Path=/");

  const converted = responseHeadersFromFetch(headers);

  assert.equal(
    Object.keys(converted).filter((key) => key.toLowerCase() === "set-cookie")
      .length,
    1,
  );
  assert.deepEqual(converted["Set-Cookie"], ["a=1; Path=/", "b=2; Path=/"]);
});

test("reliability: framework errors expose stable diagnostic codes and remediation context", () => {
  assert.throws(
    () => createPagesRuntime({}, { maxResolvedCacheEntries: -1 }),
    (error: unknown) => {
      assert.equal(isTavoError(error), true);
      assert.ok(error instanceof TavoError);
      assert.equal(error.code, "TAVO_PAGES_001");
      assert.match(error.message, /^\[TAVO_PAGES_001\]/);
      assert.match(error.hint ?? "", /Use 0 to disable reuse/);
      return true;
    },
  );
});

test("reliability: public entry points publish machine-readable stability levels", () => {
  assert.equal(getApiStability("@tavojs/core").level, "stable");
  assert.equal(getApiStability("@tavojs/core/router").level, "stable");
  assert.equal(getApiStability("@tavojs/core/server").level, "stable");
  assert.equal(getApiStability("@tavojs/core/plugin").level, "stable");
  assert.equal(getApiStability("@tavojs/core/dev").level, "experimental");
  assert.equal(Object.keys(TAVO_API_STABILITY).length, 9);
  assert.ok(Object.values(TAVO_API_STABILITY).every((entry) => entry.since === "1.0"));
});

test("reliability: structured instrumentation reports timing without affecting runtime work", async () => {
  const events: TavoInstrumentationEvent[] = [];
  const runtime = createPagesRuntime(
    {
      "/src/pages/items/[id].tsx": {
        static: true,
        cacheTags: ({ params }) => `item:${params.id}`,
        load: async ({ params }) => ({ id: params.id }),
        default: (props: any) => h("main", null, props.data.id),
      },
    },
    {
      instrumentation: createInstrumentation((event) => {
        events.push(event);
      }),
    },
  );

  await runtime.resolvePathAsync("/items/one");
  await runtime.resolvePathAsync("/items/one");
  runtime.invalidateCache("item:one");

  assert.ok(
    events.some(
      (event) => event.name === "route.loader" && event.phase === "end",
    ),
  );
  assert.ok(
    events.some(
      (event) => event.name === "route.cache" && event.phase === "hit",
    ),
  );
  assert.ok(
    events.some(
      (event) => event.name === "route.cache" && event.phase === "invalidate",
    ),
  );
  assert.ok(events.every((event) => typeof event.timestamp === "number"));
  assert.equal(
    events.some((event) => "data" in event || "headers" in event),
    false,
  );

  const resilient = createPagesRuntime(
    {
      "/src/pages/index.tsx": { default: () => h("main", null, "ok") },
    },
    {
      instrumentation: {
        emit() {
          throw new Error("observer failed");
        },
      },
    },
  );
  assert.equal((await resilient.resolvePathAsync("/")).status, 200);
});

test("reliability: OpenTelemetry adapter pairs events without exporting errors by default", () => {
  const spans: Array<{
    attributes: Record<string, unknown>;
    ended: boolean;
    errors: unknown[];
  }> = [];
  const instrumentation = createOpenTelemetryInstrumentation({
    startSpan(_name, options) {
      const record = {
        attributes: { ...options?.attributes },
        ended: false,
        errors: [] as unknown[],
      };
      spans.push(record);
      return {
        setAttribute(name, value) {
          record.attributes[name] = value;
        },
        recordException(error) {
          record.errors.push(error);
        },
        end() {
          record.ended = true;
        },
      };
    },
  });

  instrumentation.emit({
    name: "route.loader",
    phase: "start",
    timestamp: 10,
    requestId: "r1",
    route: "/item",
  });
  instrumentation.emit({
    name: "route.loader",
    phase: "error",
    timestamp: 15,
    requestId: "r1",
    route: "/item",
    durationMs: 5,
    error: new Error("private"),
  });

  assert.equal(spans.length, 1);
  assert.equal(spans[0]?.ended, true);
  assert.equal(spans[0]?.attributes["tavo.duration_ms"], 5);
  assert.deepEqual(spans[0]?.errors, []);
});

test("reliability: runtime inspection exposes operational state without loader data", async () => {
  const runtime = createPagesRuntime({
    "/src/pages/private.tsx": {
      static: true,
      cacheTags: "private-page",
      load: async () => ({ secret: "DO_NOT_EXPOSE" }),
      default: () => h("main", null, "private"),
    },
  });
  await runtime.resolvePathAsync("/private");

  const inspection = runtime.inspect();
  assert.equal(inspection.routeCount, 1);
  assert.equal(inspection.cacheEntries, 1);
  assert.deepEqual(inspection.routes[0]?.tags, ["private-page"]);
  assert.doesNotMatch(JSON.stringify(inspection), /DO_NOT_EXPOSE/);
});

test("reliability: plugin server handler failures return a contained 500 response", async () => {
  const plugin = definePlugin({
    id: "crashy-server-route",
    version: "1.0.0",
    apiVersion: 1,
    manifest: {
      endpoints: [
        {
          id: "crash",
          methods: ["GET"],
          match: { kind: "exact", path: "/api/crash" },
        },
      ],
    },
    server: () =>
      definePluginPhase({
        endpoints: {
          crash: () => {
            throw new Error("plugin failed");
          },
        },
      }),
  });
  const handle = createFetchRequestHandler({
    modules: {
      "/src/pages/index.tsx": {
        default: () => h("main", null, "home survives"),
      },
    },
    plugins: [{ plugin, expose: { server: "/" } }],
  });

  const failed = await handle(new Request("http://localhost/api/crash"));
  assert.equal(failed.status, 500);
  assert.equal(await failed.text(), "Internal Server Error");
  assert.equal(failed.headers.get("x-content-type-options"), "nosniff");

  const recovered = await handle(new Request("http://localhost/"));
  assert.equal(recovered.status, 200);
  assert.match(await recovered.text(), /home survives/);
});

test("reliability: action and render exceptions return hardened generic 500 responses", async () => {
  const actionHandler = createFetchRequestHandler({
    modules: {
      "/src/pages/crash.tsx": {
        action: defineAction(async () => {
          throw new Error("TOP_SECRET_ACTION_FAILURE");
        }),
        default: () => h("main", null, "crash"),
      },
    },
  });
  const renderHandler = createFetchRequestHandler({
    modules: {
      "/src/pages/index.tsx": {
        default: () => {
          throw new Error("TOP_SECRET_RENDER_FAILURE");
        },
      },
    },
  });

  const actionResponse = await actionHandler(
    new Request("http://localhost/crash", { method: "POST" }),
  );
  const renderResponse = await renderHandler(new Request("http://localhost/"));

  for (const response of [actionResponse, renderResponse]) {
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await response.text(), "Internal Server Error");
  }
});

test("reliability: Node streaming waits for response backpressure", async () => {
  const handle = createNodeRequestHandler({
    stream: true,
    modules: {
      "/src/pages/index.tsx": { default: () => h("main", null, "streamed") },
    },
  });
  const listeners = new Map<string, Set<() => void>>();
  let writes = 0;
  let drainObserved = false;

  await handle(
    { url: "/", method: "GET", headers: { host: "localhost" } },
    {
      headersSent: false,
      writeHead() {
        this.headersSent = true;
      },
      write() {
        writes += 1;
        if (writes === 1) {
          queueMicrotask(() => {
            drainObserved = true;
            for (const listener of listeners.get("drain") ?? []) listener();
          });
          return false;
        }
        assert.equal(drainObserved, true);
        return true;
      },
      once(event, listener) {
        const group = listeners.get(event) ?? new Set();
        group.add(listener);
        listeners.set(event, group);
      },
      off(event, listener) {
        listeners.get(event)?.delete(listener);
      },
      end() {},
    },
  );

  assert.ok(writes >= 2);
});

test("reliability: static cache adapter failures do not prevent SSR responses", async () => {
  let loadCalls = 0;
  const failingCache: SsrStaticCache = {
    async get() {
      throw new Error("cache get failed");
    },
    async set() {
      throw new Error("cache set failed");
    },
    async delete() {
      throw new Error("cache delete failed");
    },
  };
  const handle = createFetchRequestHandler({
    staticCache: failingCache,
    modules: {
      "/src/pages/index.tsx": {
        static: true,
        revalidate: 60,
        load: async () => {
          loadCalls += 1;
          return { loadCalls };
        },
        default: (props: any) =>
          h("main", null, `load:${props.data?.loadCalls}`),
      },
    },
  });

  const first = await handle(new Request("http://localhost/"));
  assert.equal(first.status, 200);
  assert.match(await first.text(), /load:1/);

  const second = await handle(new Request("http://localhost/"));
  assert.equal(second.status, 200);
  assert.match(await second.text(), /load:1/);
  assert.equal(loadCalls, 1);
});

test("reliability: plugin dependency cycles are fatal preflight diagnostics", () => {
  const first = definePlugin({
    id: "first",
    version: "1.0.0",
    apiVersion: 1,
    manifest: {
      dependencies: [{ id: "second", version: "*" }],
    },
  });
  const second = definePlugin({
    id: "second",
    version: "1.0.0",
    apiVersion: 1,
    manifest: {
      dependencies: [{ id: "first", version: "*" }],
    },
  });

  const inspection = inspectPluginGraph([first, second]);

  assert.equal(inspection.valid, false);
  assert.match(
    inspection.diagnostics.map((item) => item.message).join("\n"),
    /cycle/i,
  );
});

test("reliability: resource reset and newer loads reject stale completions", async () => {
  const resolvers: Array<(value: string) => void> = [];
  const resource = createResource(
    () => new Promise<string>((resolve) => resolvers.push(resolve)),
  );

  const first = resource.load();
  const second = resource.load();
  resolvers[1]?.("new");
  await second;
  resolvers[0]?.("old");
  await first;
  assert.equal(resource.read().data, "new");

  const third = resource.load();
  resource.reset();
  resolvers[2]?.("late");
  await third;
  assert.equal(resource.read().status, "idle");
  assert.equal(resource.read().data, null);
});

test("reliability: resources abort superseded work and return to idle", async () => {
  const signals: AbortSignal[] = [];
  const resource = createResource(({ signal }) => {
    signals.push(signal);
    return new Promise<string>((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  });

  const first = resource.load();
  const second = resource.load();

  assert.equal(signals[0]?.aborted, true);
  assert.equal(signals[1]?.aborted, false);
  assert.equal((await first).status, "loading");

  resource.abort("test abort");
  assert.equal(signals[1]?.aborted, true);
  await second;
  assert.equal(resource.read().status, "idle");
  assert.equal(resource.read().error, null);
});

test("reliability: resource abort settles even when a loader ignores its signal", async () => {
  const resource = createResource(async () => new Promise<string>(() => {}));
  const pending = resource.load();

  resource.abort();

  const settled = await pending;
  assert.equal(settled.status, "idle");
  assert.equal(resource.read().status, "idle");
});

test("reliability: route loaders receive and honor request cancellation", async () => {
  let loaderSignal: AbortSignal | undefined;
  let markStarted: (() => void) | undefined;
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const runtime = createPagesRuntime({
    "/src/pages/slow.tsx": {
      load: ({ signal }) => {
        loaderSignal = signal;
        markStarted?.();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
      default: () => h("main", null, "slow"),
    },
  });
  const controller = new AbortController();
  const pending = runtime.resolvePathAsync(
    "/slow",
    new Request("http://localhost/slow", { signal: controller.signal }),
  );

  await started;
  controller.abort(new DOMException("Superseded", "AbortError"));

  await assert.rejects(pending, (error: unknown) => {
    return error instanceof DOMException && error.name === "AbortError";
  });
  assert.ok(loaderSignal instanceof AbortSignal);
  assert.equal(loaderSignal?.aborted, true);
});
