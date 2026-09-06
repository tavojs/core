import test from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { Deferred, Seo, h, renderToString } from "../../src/index.tsx";
import { renderDocumentStream } from "../../src/server.ts";
import { renderToProgressiveStringChunks } from "../../src/render/progressive.ts";
import { style } from "../../src/style.ts";

const decode = (value: Uint8Array | undefined) => new TextDecoder().decode(value);
const nextTurn = () => new Promise<void>((resolve) => setImmediate(resolve));

function pendingValue<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("document streams render only requested chunks while retaining head styles and SEO", async () => {
  let passes = 0;
  const rendered: number[] = [];
  function Page() {
    passes += 1;
    style("stream.pressure", ".pressure{color:red}");
    return h("main", null,
      h(Seo, { title: "Stream title" }),
      [0, 1, 2].map((index) => h(Deferred, {
        id: `boundary-${index}`, value: Promise.resolve(index), fallback: "loading"
      }, (value: number) => { rendered.push(value); return h("b", null, value); }))
    );
  }
  const stream = renderDocumentStream(h(Page, {}), { initialState: { ready: true }, nonce: "stream-nonce" });
  await nextTurn();
  assert.equal(passes, 0);
  const reader = stream.getReader();
  const head = decode((await reader.read()).value);
  assert.match(head, /<title>Stream title<\/title>/);
  assert.match(head, /data-tavo-style="stream.pressure"/);
  assert.match(head, /nonce="stream-nonce"/);
  assert.equal(passes, 1);
  await nextTurn();
  assert.equal(passes, 1);
  assert.deepEqual(rendered, []);
  const body = decode((await reader.read()).value);
  assert.match(body, /data-tavo-deferred="pending"/);
  await nextTurn();
  assert.deepEqual(rendered, []);
  for (const count of [1, 2, 3]) {
    assert.match(decode((await reader.read()).value), /__TAVO_DEFERRED__/);
    await nextTurn();
    assert.equal(rendered.length, count);
  }
  const tail = decode((await reader.read()).value);
  assert.match(tail, /^<\/div><script id="__TAVO_STATE__" nonce="stream-nonce"/);
  assert.match(tail, /<\/body><\/html>$/);
  assert.equal((await reader.read()).done, true);
});

test("cancelling before the first read does not render the document", async () => {
  let renders = 0;
  const stream = renderDocumentStream(h(() => { renders += 1; return "page"; }, {}));
  await stream.cancel("unused");
  await nextTurn();
  assert.equal(renders, 0);
  assert.equal((await stream.getReader().read()).done, true);
});

test("cancelling after the head never starts the body render", async () => {
  let renders = 0;
  const reader = renderDocumentStream(h(() => { renders += 1; return "page"; }, {})).getReader();
  await reader.read();
  await reader.cancel("disconnected");
  await nextTurn();
  assert.equal(renders, 1);
});

for (const rejection of [false, true]) {
  test(`cancelling a pending body update handles later ${rejection ? "rejection" : "resolution"} without rendering`, async () => {
    const value = pendingValue<string>();
    let renders = 0;
    const node = h(Deferred, {
      id: "cancelled", value: value.promise, fallback: "loading",
      serialize: (result: string) => { renders += 1; return result; },
      errorFallback: () => { renders += 1; return "failed"; }
    }, () => { renders += 1; return "ready"; });
    const reader = renderDocumentStream(node).getReader();
    await reader.read();
    await reader.read();
    const pending = reader.read();
    await nextTurn();
    await reader.cancel("disconnected");
    assert.equal((await pending).done, true);
    if (rejection) value.reject(new Error("late failure"));
    else value.resolve("late success");
    await nextTurn();
    assert.equal(renders, 0);
    assert.equal((await reader.read()).done, true);
  });
}

test("cancelling while paused after a patch stops later ready patches", async () => {
  let renders = 0;
  const nodes = [0, 1, 2].map((index) => h(Deferred, {
    id: `cancel-${index}`, value: Promise.resolve(index), fallback: "loading"
  }, () => { renders += 1; return "ready"; }));
  const reader = renderDocumentStream(nodes).getReader();
  await reader.read();
  await reader.read();
  await reader.read();
  assert.equal(renders, 1);
  await reader.cancel();
  await nextTurn();
  assert.equal(renders, 1);
});

test("rejected values are safely observed while the consumer pauses after the head", async () => {
  const value = pendingValue<string>();
  const reader = renderDocumentStream(h(Deferred, {
    value: value.promise, fallback: "loading", errorFallback: "safe failure"
  }, (result: string) => result)).getReader();
  await reader.read();
  value.reject(new Error("private failure"));
  await nextTurn();
  await reader.read();
  const patch = decode((await reader.read()).value);
  assert.match(patch, /safe failure/);
  assert.doesNotMatch(patch, /private failure/);
  await reader.cancel();
});

test("static SSR observes rejected deferred values while rendering fallbacks", async () => {
  const html = renderToString(h(Deferred, {
    value: Promise.reject(new Error("ignored static failure")), fallback: "static loading"
  }, (result: string) => result));
  assert.match(html, /static loading/);
  await nextTurn();
});

for (const failingPass of [1, 2]) {
  test(`document stream surfaces errors from render pass ${failingPass}`, async () => {
    const error = new Error("render failed");
    let passes = 0;
    const reader = renderDocumentStream(h(() => {
      passes += 1;
      if (passes === failingPass) throw error;
      return "ready";
    }, {})).getReader();
    if (failingPass === 2) await reader.read();
    await assert.rejects(reader.read(), (caught) => caught === error);
    await assert.rejects(reader.read(), (caught) => caught === error);
  });
}

test("a failed deferred error fallback errors its document stream", async () => {
  const error = new Error("fallback failed");
  const reader = renderDocumentStream(h(Deferred, {
    value: Promise.resolve("ready"), fallback: "loading", errorFallback: () => { throw error; }
  }, () => { throw new Error("render failed"); })).getReader();
  await reader.read();
  await reader.read();
  await assert.rejects(reader.read(), (caught) => caught === error);
});

test("aborting progressive consumption wakes pending reads and removes its abort listener", async () => {
  const abort = new AbortController();
  const error = new Error("cancelled");
  const stream = renderToProgressiveStringChunks(h(Deferred, {
    value: new Promise(() => {}), fallback: "loading"
  }, () => "ready"), { signal: abort.signal });
  await stream.next();
  assert.equal(getEventListeners(abort.signal, "abort").length, 1);
  const pending = stream.next();
  abort.abort(error);
  await assert.rejects(pending, (caught) => caught === error);
  assert.equal(getEventListeners(abort.signal, "abort").length, 0);
});
