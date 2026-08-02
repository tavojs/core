import test from "node:test";
import assert from "node:assert/strict";
import {
  createMemorySessionStore,
  createSessionStorage
} from "../../src/session/index.ts";

const CURRENT_SECRET = "current-session-secret-32-bytes-ok";
const OLD_SECRET = "old-session-secret-value-32-bytes";
const NEW_SECRET = "new-session-secret-value-32-bytes";

test("session storage signs opaque ids and restores stored data", async () => {
  const sessions = createSessionStorage<{ userId: string }>({
    cookie: {
      name: "__session",
      secrets: [CURRENT_SECRET],
      maxAge: 60
    }
  });

  const session = await sessions.getSession(new Request("https://example.com/login"));
  session.set("userId", "ada");
  const cookie = await sessions.commitSession(session);

  assert.match(cookie, /__session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=lax/);

  const restored = await sessions.getSession(new Request("https://example.com/", {
    headers: { cookie }
  }));
  assert.equal(restored.get("userId"), "ada");
});

test("session storage rejects tampered cookies", async () => {
  const sessions = createSessionStorage<{ userId: string }>({
    cookie: {
      name: "__session",
      secrets: [CURRENT_SECRET]
    }
  });

  const session = await sessions.getSession(new Request("https://example.com/login"));
  session.set("userId", "ada");
  const cookie = await sessions.commitSession(session);
  const cookieValue = cookie.match(/__session=([^;]+)/)?.[1] ?? "";
  const tamperedValue = `${cookieValue.slice(0, -1)}${cookieValue.endsWith("x") ? "y" : "x"}`;
  const tampered = cookie.replace(cookieValue, tamperedValue);

  const restored = await sessions.getSession(new Request("https://example.com/", {
    headers: { cookie: tampered }
  }));
  assert.equal(restored.get("userId"), undefined);
  assert.equal(restored.isNew, true);
});

test("session storage supports secret rotation", async () => {
  const store = createMemorySessionStore<{ userId: string }>();
  const oldSessions = createSessionStorage<{ userId: string }>({
    cookie: {
      name: "__session",
      secrets: [OLD_SECRET]
    },
    store
  });
  const newSessions = createSessionStorage<{ userId: string }>({
    cookie: {
      name: "__session",
      secrets: [NEW_SECRET, OLD_SECRET]
    },
    store
  });

  const session = await oldSessions.getSession(new Request("https://example.com/login"));
  session.set("userId", "ada");
  const cookie = await oldSessions.commitSession(session);
  const restored = await newSessions.getSession(new Request("https://example.com/", {
    headers: { cookie }
  }));

  assert.equal(restored.get("userId"), "ada");
});

test("session rotation replaces the stored session id", async () => {
  const store = createMemorySessionStore<{ userId: string }>();
  const sessions = createSessionStorage<{ userId: string }>({
    cookie: {
      name: "__session",
      secrets: [CURRENT_SECRET]
    },
    store
  });

  const session = await sessions.getSession(new Request("https://example.com/login"));
  const originalId = session.id;
  session.set("userId", "ada");
  session.rotate();
  await sessions.commitSession(session);

  assert.notEqual(session.id, originalId);
  assert.equal(await store.get(originalId), null);
  assert.equal((await store.get(session.id))?.data.userId, "ada");
});

test("destroySession clears cookie and deletes stored data", async () => {
  const store = createMemorySessionStore<{ userId: string }>();
  const sessions = createSessionStorage<{ userId: string }>({
    cookie: {
      name: "__session",
      secrets: [CURRENT_SECRET]
    },
    store
  });

  const session = await sessions.getSession(new Request("https://example.com/login"));
  session.set("userId", "ada");
  await sessions.commitSession(session);
  const cleared = await sessions.destroySession(session);

  assert.match(cleared, /Max-Age=0/);
  assert.equal(await store.get(session.id), null);
});

test("session storage rejects weak signing secrets", () => {
  assert.throws(
    () => createSessionStorage<{ userId: string }>({
      cookie: {
        name: "__session",
        secrets: ["short"]
      }
    }),
    /at least 32 bytes/
  );
});

test("memory session store evicts oldest entries at its configured bound", async () => {
  const store = createMemorySessionStore<{ value: number }>({ maxEntries: 2 });

  await store.set("one", { data: { value: 1 }, expiresAt: null });
  await store.set("two", { data: { value: 2 }, expiresAt: null });
  await store.set("three", { data: { value: 3 }, expiresAt: null });

  assert.equal(await store.get("one"), null);
  assert.deepEqual(await store.get("two"), { data: { value: 2 }, expiresAt: null });
  assert.deepEqual(await store.get("three"), { data: { value: 3 }, expiresAt: null });
  assert.equal(store.size(), 2);
});

test("session cookie configuration rejects header-injection characters", () => {
  assert.throws(
    () => createSessionStorage({
      cookie: {
        name: "session",
        path: "/; Domain=evil.example",
        secrets: ["a-secure-session-secret-with-32-bytes"]
      }
    }),
    /cookie\.path contains invalid characters/
  );
});
