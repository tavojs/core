import test from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../../src/index.tsx";
import { defineGlobalStore } from "../../src/framework/index.ts";
import { computedStore, persistStore } from "../../src/store/index.ts";

function captureWarnings(fn: () => void): string[] {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    fn();
  } finally {
    console.warn = originalWarn;
  }
  return warnings;
}

test("createStore initializer can define actions with set helper", () => {
  const store = createStore((set) => ({
    theme: "sunset",
    authenticated: false,
    setTheme(value: "sunset" | "mint") {
      set({ theme: value });
    },
    toggleAuth() {
      set((previous) => ({ authenticated: !previous.authenticated }));
    }
  }));

  store.getState().setTheme("mint");
  assert.equal(store.getState().theme, "mint");

  store.getState().toggleAuth();
  assert.equal(store.getState().authenticated, true);
});

test("defineGlobalStore initializer can define actions with set helper", () => {
  const store = defineGlobalStore("test:initializer-actions", (set) => ({
    theme: "sunset",
    setTheme(value: string) {
      set({ theme: value });
    }
  }));

  const warnings = captureWarnings(() => {
    store.getState().setTheme("mint");
  });

  assert.equal(store.getState().theme, "mint");
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /global store "test:initializer-actions" was written with patch\(\) during SSR/);
});

test("defineGlobalStore warns once when written during SSR", () => {
  const store = defineGlobalStore("test:ssr-write-warning", {
    count: 0
  });

  const warnings = captureWarnings(() => {
    store.set("count", 1);
    store.patch({ count: 2 });
    store.setState({ count: 3 });
  });

  assert.equal(store.getState().count, 3);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /global store "test:ssr-write-warning" was written with set\(\) during SSR/);
});

test("defineGlobalStore does not warn when written in a browser environment", () => {
  const globalTarget = globalThis as typeof globalThis & { window?: unknown };
  const previousWindow = globalTarget.window;
  globalTarget.window = {};
  try {
    const store = defineGlobalStore("test:client-write-warning", {
      count: 0
    });

    const warnings = captureWarnings(() => {
      store.set("count", 1);
    });

    assert.equal(store.getState().count, 1);
    assert.equal(warnings.length, 0);
  } finally {
    if (previousWindow === undefined) {
      delete globalTarget.window;
    } else {
      globalTarget.window = previousWindow;
    }
  }
});

test("store.set updates top-level and nested values immutably", () => {
  const store = createStore({
    count: 0,
    user: {
      profile: {
        name: "Ada"
      }
    }
  });
  const initialUser = store.getState().user;
  const changes: string[] = [];

  store.watch("user.profile.name", (name, previousName) => {
    changes.push(`${previousName}->${name}`);
  });

  store.set("count", (count) => count + 1);
  store.set("user.profile.name", "Grace");

  assert.equal(store.getState().count, 1);
  assert.equal(store.getState().user.profile.name, "Grace");
  assert.notEqual(store.getState().user, initialUser);
  assert.deepEqual(changes, ["Ada->Grace"]);
});

test("store.set rejects prototype-bearing path segments", () => {
  const store = createStore<Record<string, unknown>>({ safe: true });

  for (const path of ["__proto__.isAdmin", "constructor.prototype.isAdmin", ["prototype", "isAdmin"]] as const) {
    assert.throws(() => store.set(path as any, true), /unsafe path segment/);
  }

  assert.equal(store.getState().isAdmin, undefined);
  assert.equal(({} as { isAdmin?: boolean }).isAdmin, undefined);
});

test("store.set skips notifications when the selected value is unchanged", () => {
  const store = createStore({
    profile: {
      name: "Ada"
    }
  });
  let events = 0;

  store.subscribe(() => {
    events += 1;
  });

  store.set("profile.name", "Ada");

  assert.equal(events, 0);
});

test("store.watch observes nested path changes only when selected value changes", () => {
  const store = createStore({
    user: {
      profile: {
        name: "Ada"
      }
    },
    count: 0
  });
  const changes: string[] = [];

  const unsubscribe = store.watch<string>("user.profile.name", (name, previousName) => {
    changes.push(`${previousName}->${name}`);
  });

  store.patch({ count: 1 });
  store.patch({
    user: {
      profile: {
        name: "Grace"
      }
    }
  });
  store.patch({
    user: {
      profile: {
        name: "Grace"
      }
    }
  });
  unsubscribe();
  store.patch({
    user: {
      profile: {
        name: "Katherine"
      }
    }
  });

  assert.deepEqual(changes, ["Ada->Grace"]);
});

test("store.watch observes top-level keys with immediate option", () => {
  const store = createStore({ theme: "sunset", count: 0 });
  const changes: string[] = [];

  store.watch("theme", (theme, previousTheme) => {
    changes.push(`${previousTheme}->${theme}`);
  }, { immediate: true });

  store.patch({ count: 1 });
  store.patch({ theme: "mint" });

  assert.deepEqual(changes, ["sunset->sunset", "sunset->mint"]);
});

test("store.watch observes selector changes with custom equality", () => {
  const store = createStore({ first: "Ada", last: "Lovelace", count: 0 });
  const changes: string[] = [];

  store.watch(
    (state) => ({ fullName: `${state.first} ${state.last}` }),
    (next, previous) => {
      changes.push(`${previous.fullName}->${next.fullName}`);
    },
    {
      isEqual: (left, right) => left.fullName === right.fullName
    }
  );

  store.patch({ count: 1 });
  store.patch({ first: "Ada" });
  store.patch({ last: "Byron" });

  assert.deepEqual(changes, ["Ada Lovelace->Ada Byron"]);
});

test("computedStore derives state from a source store", () => {
  const source = createStore({ first: "Ada", last: "Lovelace" });
  const fullName = computedStore(source, (state) => ({
    value: `${state.first} ${state.last}`
  }));

  assert.equal(fullName.getState().value, "Ada Lovelace");
  source.patch({ last: "Byron" });
  assert.equal(fullName.getState().value, "Ada Byron");
});

test("persistStore hydrates and saves selected store state", () => {
  const memory = new Map<string, string>();
  const storage = {
    getItem: (key: string) => memory.get(key) ?? null,
    setItem: (key: string, value: string) => {
      memory.set(key, value);
    }
  };
  memory.set("demo", JSON.stringify({ theme: "mint" }));

  const store = createStore({ theme: "sunset", count: 0 });
  const unsubscribe = persistStore(store, {
    key: "demo",
    storage,
    pick: (state) => ({ theme: state.theme })
  });

  assert.equal(store.getState().theme, "mint");
  store.patch({ theme: "sunset", count: 2 });
  assert.equal(memory.get("demo"), JSON.stringify({ theme: "sunset" }));
  unsubscribe();
});

test("server-created stores are weakly held by the global hydration registry", () => {
  const globalRuntime = globalThis as typeof globalThis & {
    __tavo_stores_by_id__?: Map<string, unknown>;
  };
  const previousKeys = new Set(globalRuntime.__tavo_stores_by_id__?.keys() ?? []);
  const stores = [];

  for (let index = 0; index < 500; index += 1) {
    stores.push(createStore({ index }));
  }

  const registry = globalRuntime.__tavo_stores_by_id__;
  assert.ok(registry);
  const created = Array.from(registry.entries()).filter(([key]) => !previousKeys.has(key));
  assert.equal(created.length, stores.length);
  assert.ok(created.every(([, value]) => value instanceof WeakRef));
  for (const [key] of created) {
    registry.delete(key);
  }
});

test("browser hydration registry keeps weak store references", () => {
  const globalRuntime = globalThis as typeof globalThis & {
    window?: unknown;
    __tavo_stores_by_id__?: Map<string, unknown>;
  };
  const previousWindow = globalRuntime.window;
  const previousKeys = new Set(globalRuntime.__tavo_stores_by_id__?.keys() ?? []);
  globalRuntime.window = {};

  try {
    const store = createStore({ ready: true });
    const registry = globalRuntime.__tavo_stores_by_id__;
    assert.ok(registry);
    const created = Array.from(registry.entries()).find(([key]) => !previousKeys.has(key));
    assert.ok(created);
    assert.ok(created[1] instanceof WeakRef);
    assert.equal((created[1] as WeakRef<typeof store>).deref(), store);
    registry.delete(created[0]);
  } finally {
    if (previousWindow === undefined) {
      delete globalRuntime.window;
    } else {
      globalRuntime.window = previousWindow;
    }
  }
});
