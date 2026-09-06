import test from "node:test";
import assert from "node:assert/strict";
import { defineCapability, definePlugin } from "../../src/plugins/index.ts";
import { createPluginRuntime, createPluginRuntimeAsync } from "../../src/plugins/runtime.ts";
import type { PluginCapabilityToken, PluginRequestResolveContext, PluginRequestScope, TavoPluginPhase } from "../../src/plugins/types.ts";

const capability = (name: string, scope: "request" | "runtime" = "request") =>
  defineCapability<any>({ provider: "review-lifecycle", name, scope });

function configuration(tokens: PluginCapabilityToken<any, any>[], phase: TavoPluginPhase) {
  return [definePlugin({
    id: "review-lifecycle",
    version: "1.0.0",
    apiVersion: 1,
    manifest: { provides: tokens },
    server: () => phase,
  })];
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const request = () => new Request("https://example.test/");

test("review: async capability cycles reject without hanging, including concurrent roots", { timeout: 1000 }, async () => {
  const a = capability("a");
  const b = capability("b");
  const runtime = await createPluginRuntimeAsync(configuration([a, b], {
    capabilities: {
      a: async ({ resolve }: PluginRequestResolveContext) => { await Promise.resolve(); return resolve(b); },
      b: async ({ resolve }: PluginRequestResolveContext) => { await Promise.resolve(); return resolve(a); },
    },
  }));
  const one = runtime.createRequestScope(request());
  await assert.rejects(one.resolve(a), /cycle detected/);
  const two = runtime.createRequestScope(request());
  const roots = await Promise.allSettled([two.resolve(a), two.resolve(b)]);
  assert.equal(roots.length, 2);
  for (const result of roots) {
    assert.equal(result.status, "rejected");
    if (result.status === "rejected") assert.match(result.reason.message, /cycle detected/);
  }
  await one.dispose();
  await two.dispose();
  await runtime.dispose();
});

test("review: shared async dependencies coalesce without false cycle errors", async () => {
  const a = capability("a");
  const b = capability("b");
  const shared = capability("shared");
  let calls = 0;
  const runtime = await createPluginRuntimeAsync(configuration([a, b, shared], {
    capabilities: {
      a: async ({ resolve }: PluginRequestResolveContext) => Promise.all([resolve(shared), resolve(shared)]),
      b: async ({ resolve }: PluginRequestResolveContext) => resolve(shared),
      shared: async () => { calls += 1; await Promise.resolve(); return { value: "shared" }; },
    },
  }));
  const scope = runtime.createRequestScope(request());
  const [left, right, direct] = await Promise.all([scope.resolve(a), scope.resolve(b), scope.resolve(shared)]);
  assert.equal(left[0], right);
  assert.equal(left[1], direct);
  assert.equal(calls, 1);
  await scope.dispose();
  await runtime.dispose();
});

test("review: synchronous and asynchronous failed factories can be retried", async () => {
  const value = capability("value");
  let attempts = 0;
  const runtime = await createPluginRuntimeAsync(configuration([value], {
    capabilities: {
      value: () => {
        attempts += 1;
        if (attempts === 1) throw new Error("synchronous failure");
        if (attempts === 2) return Promise.reject(new Error("async failure"));
        return { attempt: attempts };
      },
    },
  }));
  const scope = runtime.createRequestScope(request());
  await assert.rejects(scope.resolve(value), /synchronous failure/);
  await assert.rejects(scope.resolve(value), /async failure/);
  assert.deepEqual(await scope.resolve(value), { attempt: 3 });
  await scope.dispose();
  await runtime.dispose();
});

test("review: request disposal drains failures once and rejects future resolution", async () => {
  const a = capability("a");
  const b = capability("b");
  const c = capability("c");
  const order: string[] = [];
  const runtime = await createPluginRuntimeAsync(configuration([a, b, c], {
    capabilities: Object.fromEntries(["a", "b", "c"].map((name) => [name, () => ({
      async dispose() {
        order.push(name);
        if (name !== "b") throw new Error(`cleanup ${name}`);
      },
    })])),
  }));
  const scope = runtime.createRequestScope(request());
  await scope.resolve(a);
  await scope.resolve(b);
  await scope.resolve(c);
  const first = scope.dispose();
  assert.equal(first, scope.dispose());
  await assert.rejects(first, (error: unknown) => error instanceof AggregateError && error.errors.length === 2);
  assert.deepEqual(order, ["c", "b", "a"]);
  await assert.rejects(scope.dispose(), AggregateError);
  assert.deepEqual(order, ["c", "b", "a"]);
  await assert.rejects(scope.resolve(a), /disposed/);
  assert.equal(await scope.tryResolve(a), undefined);
  await runtime.dispose();
});

for (const sync of [false, true]) {
  test(`review: ${sync ? "sync" : "async"} runtime disposal drains every callback and closes resolvers`, async () => {
    const a = capability("a", "runtime");
    const b = capability("b", "runtime");
    const order: string[] = [];
    const config = configuration([a, b], {
      capabilities: {
        a: () => ({ dispose() { order.push("a"); } }),
        b: () => ({ dispose() { order.push("b"); throw new Error("cleanup b"); } }),
      },
      dispose() { order.push("phase"); throw new Error("cleanup phase"); },
    });
    const runtime = sync ? createPluginRuntime(config) : await createPluginRuntimeAsync(config);
    const scope = runtime.createRequestScope(request());
    const first = runtime.dispose();
    assert.equal(first, runtime.dispose());
    await assert.rejects(first, (error: unknown) => error instanceof AggregateError && error.errors.length === 2);
    assert.deepEqual(order, ["phase", "b", "a"]);
    assert.throws(() => runtime.capabilities.resolve(a), /disposed/);
    assert.throws(() => runtime.createRequestScope(request()), /disposed/);
    await assert.rejects(scope.resolve(a), /disposed/);
    await scope.dispose();
  });
}

test("review: resources completing after request disposal are cleaned and never returned", async () => {
  const value = capability("value");
  const start = deferred<void>();
  const ready = deferred<{ dispose(): void }>();
  let disposals = 0;
  const runtime = await createPluginRuntimeAsync(configuration([value], {
    capabilities: { value: () => { start.resolve(); return ready.promise; } },
  }));
  const scope = runtime.createRequestScope(request());
  const pending = scope.resolve(value);
  await start.promise;
  await scope.dispose();
  const rejected = assert.rejects(pending, /disposed/);
  ready.resolve({ dispose() { disposals += 1; } });
  await rejected;
  assert.equal(disposals, 1);
  await scope.dispose();
  assert.equal(disposals, 1);
  await runtime.dispose();
});

test("review: disposal before a queued factory starts prevents initialization", async () => {
  const value = capability("value");
  let calls = 0;
  const runtime = await createPluginRuntimeAsync(configuration([value], {
    capabilities: { value: () => { calls += 1; return {}; } },
  }));
  const scope = runtime.createRequestScope(request());
  const pending = scope.resolve(value);
  await scope.dispose();
  await assert.rejects(pending, /disposed/);
  assert.equal(calls, 0);
  await runtime.dispose();
});

test("review: resources completing after runtime disposal are cleaned and rejected", async () => {
  const value = capability("value");
  const started = deferred<void>();
  const ready = deferred<{ dispose(): void }>();
  let disposals = 0;
  const runtime = await createPluginRuntimeAsync(configuration([value], {
    capabilities: { value: () => { started.resolve(); return ready.promise; } },
  }));
  const scope = runtime.createRequestScope(request());
  const pending = scope.resolve(value);
  await started.promise;
  await runtime.dispose();
  const rejected = assert.rejects(pending, /disposed/);
  ready.resolve({ dispose() { disposals += 1; } });
  await rejected;
  await scope.dispose();
  assert.equal(disposals, 1);
});

test("review: failed setup still tears down the phase and every initialized capability", async () => {
  for (const sync of [false, true]) {
    const value = capability("value", "runtime");
    const cleaned: string[] = [];
    const config = configuration([value], {
      capabilities: { value: () => ({ dispose() { cleaned.push("value"); } }) },
      setup() { throw new Error("setup failure"); },
      dispose() { cleaned.push("phase"); throw new Error("cleanup failure"); },
    });
    if (sync) {
      assert.throws(() => createPluginRuntime(config), /initialization failed/);
      await new Promise((resolve) => setImmediate(resolve));
    } else {
      await assert.rejects(createPluginRuntimeAsync(config), /initialization failed/);
    }
    assert.deepEqual(cleaned, ["phase", "value"]);
  }
});

test("review: rejected synchronous initialization cleans eventual async capability values", async () => {
  const value = capability("value", "runtime");
  const ready = deferred<{ dispose(): void }>();
  const cleaned = deferred<void>();
  assert.throws(() => createPluginRuntime(configuration([value], {
    capabilities: { value: () => ready.promise },
  })), /is async/);
  ready.resolve({ dispose() { cleaned.resolve(); } });
  await cleaned.promise;
});

test("review: disposal during promise settlement never returns a cleaned resource", async () => {
  const value = capability("value");
  let scope: PluginRequestScope;
  let disposed = 0;
  const runtime = await createPluginRuntimeAsync(configuration([value], {
    capabilities: {
      value: () => {
        void Promise.resolve().then(() => queueMicrotask(() => { void scope.dispose(); }));
        return { dispose() { disposed += 1; } };
      },
    },
  }));
  scope = runtime.createRequestScope(request());
  await assert.rejects(scope.resolve(value), /disposed/);
  await scope.dispose();
  assert.equal(disposed, 1);
  await runtime.dispose();
});
