import test from "node:test";
import assert from "node:assert/strict";
import { createMemorySessionStore, createSessionStorage } from "../../src/session/index.ts";
import type { SessionStoreEntry } from "../../src/session/types.ts";
import { createMemoryStaticCache } from "../../src/ssr/cache.ts";
import { createFetchRequestHandler } from "../../src/ssr/handlers.ts";
import { optimizeImageFromUrl } from "../../src/ssr/image.ts";
import type { SsrStaticCacheEntry } from "../../src/ssr/types.ts";
import { h } from "../../src/index.tsx";
import { mockImageRequests } from "./image-request-fixture.ts";

type NestedSession = { user: { roles: string[] }; seen: Date };
const cookieConfig = { name: "session", secrets: ["server-review-session-secret-at-least-32-bytes"] };

test("review: memory sessions isolate nested snapshots at both boundaries", async () => {
  const store = createMemorySessionStore<NestedSession>();
  const entry = { data: { user: { roles: ["reader"] }, seen: new Date(0) }, expiresAt: null };
  await store.set("one", entry);
  entry.data.user.roles.push("admin");
  entry.data.seen.setFullYear(2026);
  const first = (await store.get("one"))!;
  assert.deepEqual(first.data.user.roles, ["reader"]);
  assert.equal(first.data.seen.getTime(), 0);
  first.data.user.roles.push("writer");
  assert.deepEqual((await store.get("one"))!.data.user.roles, ["reader"]);
});

test("review: session storage isolates adapter references and concurrent requests", async () => {
  const entries = new Map<string, SessionStoreEntry<NestedSession>>();
  const sessions = createSessionStorage<NestedSession>({
    cookie: cookieConfig,
    store: {
      get: (id) => entries.get(id) ?? null,
      set: (id, entry) => { entries.set(id, entry); },
      delete: (id) => { entries.delete(id); }
    }
  });
  const original = await sessions.getSession();
  original.set("user", { roles: ["reader"] });
  original.set("seen", new Date(0));
  const cookie = await sessions.commitSession(original);
  original.data.user.roles.push("admin");
  const request = new Request("https://example.com/", { headers: { cookie } });
  const [left, right] = await Promise.all([sessions.getSession(request), sessions.getSession(request)]);
  assert.deepEqual(left.data.user.roles, ["reader"]);
  left.data.user.roles.push("writer");
  assert.deepEqual(right.data.user.roles, ["reader"]);
  assert.deepEqual(entries.get(original.id)!.data.user.roles, ["reader"]);
  await sessions.commitSession(left);
  left.data.user.roles.push("owner");
  assert.deepEqual((await sessions.getSession(request)).data.user.roles, ["reader", "writer"]);
});

function staticModules() {
  return {
    "/src/pages/index.tsx": {
      static: true,
      cacheTags: ["review"],
      default: () => h("main", null, "cached")
    }
  };
}

test("review: renderer delegates native invalidation without retaining evicted keys", async (context) => {
  const cache = createMemoryStaticCache({ maxEntries: 2 });
  const invalidate = context.mock.method(cache, "invalidateTags");
  const remove = context.mock.method(cache, "delete");
  const handler = createFetchRequestHandler({ staticCache: cache, modules: staticModules() });
  for (let index = 0; index < 30; index += 1) {
    assert.equal((await handler(new Request(`https://example.com/?key=${index}`))).status, 200);
  }
  assert.equal(cache.size(), 2);
  await handler.invalidateCache("review");
  assert.equal(cache.size(), 0);
  assert.equal(invalidate.mock.callCount(), 1);
  assert.equal(remove.mock.callCount(), 0);
});

test("review: minimal cache adapters remain bounded and keep every stored entry invalidatable", async () => {
  const entries = new Map<string, SsrStaticCacheEntry>();
  let refuseEviction = false;
  const handler = createFetchRequestHandler({
    modules: staticModules(),
    staticCache: {
      get: (key) => entries.get(key) ?? null,
      async set(key, entry) { entries.set(key, entry); },
      async delete(key) {
        if (refuseEviction) throw new Error("cache temporarily unavailable");
        entries.delete(key);
      }
    }
  });
  for (let start = 0; start < 1050; start += 50) {
    await Promise.all(Array.from({ length: 50 }, (_, offset) =>
      handler(new Request(`https://example.com/?key=${start + offset}`))));
  }
  assert.equal(entries.size, 1024);
  refuseEviction = true;
  assert.equal((await handler(new Request("https://example.com/?key=failed-eviction"))).status, 200);
  assert.equal(entries.size, 1024);
  refuseEviction = false;
  await handler.invalidateCache("review");
  assert.equal(entries.size, 0);
  await handler(new Request("https://example.com/?key=fresh"));
  await handler.clearCache();
  assert.equal(entries.size, 0);
});

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>';
const imageUrl = (src: string) => new URL(`https://example.com/_tavo/image?src=${encodeURIComponent(src)}&w=320`);

test("review: remote image sockets use validated DNS records and preserve their hostname", async (context) => {
  let resolutions = 0;
  let requests = 0;
  mockImageRequests(context, (url, options) => {
    requests += 1;
    assert.equal(url.hostname, "fcdn.example.com");
    assert.equal(options.agent, false);
    const lookup = options.lookup as Function;
    lookup(url.hostname, { all: true }, (error: Error | null, addresses: unknown) => {
      assert.equal(error, null);
      assert.deepEqual(addresses, [{ address: "93.184.216.34", family: 4 }]);
    });
    lookup(url.hostname, {}, (error: Error | null, address: string, family: number) => {
      assert.equal(error, null);
      assert.equal(address, "93.184.216.34");
      assert.equal(family, 4);
    });
    return { body: svg };
  });
  const result = await optimizeImageFromUrl(imageUrl("https://fcdn.example.com/image.svg"), {
    allowRemote: true,
    remotePatterns: ["fcdn.example.com"],
    resolveHostname: async () => [{ address: ++resolutions === 1 ? "93.184.216.34" : "127.0.0.1" }]
  });
  assert.ok(result!.body.byteLength > 0);
  assert.equal(resolutions, 1);
  assert.equal(requests, 1);
});

test("review: same-host redirects revalidate DNS before opening another socket", async (context) => {
  let resolutions = 0;
  let requests = 0;
  mockImageRequests(context, () => {
    requests += 1;
    return { status: 302, headers: { location: "/redirected.svg" } };
  });
  await assert.rejects(optimizeImageFromUrl(imageUrl("https://cdn.example.com/image.svg"), {
    allowRemote: true,
    remotePatterns: ["cdn.example.com"],
    resolveHostname: async () => [{ address: ++resolutions === 1 ? "93.184.216.34" : "127.0.0.1" }]
  }), /private network/);
  assert.equal(resolutions, 2);
  assert.equal(requests, 1);
});

test("review: image DNS validation rejects expanded private IPv6 and non-address records", async () => {
  for (const address of ["0:0:0:0:0:0:0:1", "0:0:0:0:0:ffff:7f00:1", "private.example.com"]) {
    await assert.rejects(optimizeImageFromUrl(imageUrl("https://cdn.example.com/image.svg"), {
      allowRemote: true,
      remotePatterns: ["cdn.example.com"],
      resolveHostname: async () => [{ address }]
    }), /private network/);
  }
});

test("review: image timeout includes stalled DNS resolution", async () => {
  await assert.rejects(optimizeImageFromUrl(imageUrl("https://cdn.example.com/image.svg"), {
    allowRemote: true,
    remotePatterns: ["cdn.example.com"],
    timeoutMs: 10,
    resolveHostname: async () => new Promise(() => {})
  }), /abort/i);
});

test("review: remote image byte limit contains oversized streaming bodies", async (context) => {
  mockImageRequests(context, () => ({ body: svg }));
  await assert.rejects(optimizeImageFromUrl(imageUrl("https://cdn.example.com/image.svg"), {
    allowRemote: true,
    remotePatterns: ["cdn.example.com"],
    maxBytes: 8,
    resolveHostname: async () => [{ address: "93.184.216.34" }]
  }), /maxBytes/);
});
