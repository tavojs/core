import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createAction } from "../../src/actions/index.ts";
import { createFormAction, createServerFormAction } from "../../src/forms/index.ts";
import { validateInput } from "../../src/validation.ts";

function setupDom(html: string) {
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const dom = new JSDOM(html, { url: "http://localhost/login" });
  globalThis.window = dom.window as unknown as Window & typeof globalThis;
  globalThis.document = dom.window.document;
  return () => {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    dom.window.close();
  };
}

test("createAction tracks running, success, and result state", async () => {
  const action = createAction<{ count: number }, number>(({ input }) => input.count + 1);
  const states: string[] = [];
  const unsubscribe = action.store.subscribe((state) => {
    states.push(state.status);
  });

  const result = await action.run({ count: 1 });

  assert.equal(result.status, "success");
  assert.equal(result.data, 2);
  assert.deepEqual(states, ["running", "success"]);
  unsubscribe();
});

test("validation adapters support Standard Schema and safeParse contracts", async () => {
  const standard = {
    "~standard": {
      validate(value: unknown) {
        return typeof value === "string"
          ? { value: value.toUpperCase() }
          : { issues: [{ message: "Expected string", path: [{ key: "name" }] }] };
      }
    }
  };
  const safeParse = {
    safeParse(value: unknown) {
      return typeof value === "number"
        ? { success: true, data: value + 1 }
        : { success: false, error: { issues: [{ message: "Expected number" }] } };
    }
  };

  assert.deepEqual(await validateInput(standard, "tavo"), { ok: true, value: "TAVO" });
  assert.deepEqual(await validateInput(standard, 1), {
    ok: false,
    issues: [{ message: "Expected string", path: ["name"] }]
  });
  assert.deepEqual(await validateInput(safeParse, 1), { ok: true, value: 2 });
});

test("createAction stores thrown errors", async () => {
  const action = createAction(() => {
    throw new Error("boom");
  });

  const result = await action.run(undefined);

  assert.equal(result.status, "error");
  assert.match(String(result.error), /boom/);
});

test("createAction ignores stale completions from superseded runs", async () => {
  const resolvers = new Map<number, (value: number) => void>();
  const action = createAction<number, number>(({ input }) =>
    new Promise((resolve) => resolvers.set(input, resolve))
  );

  const first = action.run(1);
  const second = action.run(2);
  resolvers.get(2)?.(20);
  await second;
  resolvers.get(1)?.(10);
  await first;

  assert.equal(action.getState().status, "success");
  assert.equal(action.getState().data, 20);
});

test("createAction reset invalidates an in-flight completion", async () => {
  let resolveRun: ((value: string) => void) | undefined;
  const action = createAction<void, string>(() =>
    new Promise((resolve) => {
      resolveRun = resolve;
    })
  );

  const pending = action.run(undefined);
  action.reset();
  resolveRun?.("late");
  await pending;

  assert.equal(action.getState().status, "idle");
  assert.equal(action.getState().data, null);
});

test("createAction abort leaves a terminal idle state and ignores late completion", async () => {
  let resolveRun: ((value: string) => void) | undefined;
  const action = createAction<void, string>(() =>
    new Promise((resolve) => {
      resolveRun = resolve;
    })
  );

  const pending = action.run(undefined);
  action.abort();
  resolveRun?.("late");
  await pending;

  assert.equal(action.getState().status, "idle");
  assert.equal(action.getState().data, null);
});

test("createFormAction converts values and mirrors action state", async () => {
  const formAction = createFormAction((values) => ({
    name: String(values.name)
  }));

  const result = await formAction.submit({ name: "Ada" });

  assert.equal(result.status, "success");
  assert.deepEqual(result.data, { name: "Ada" });
  assert.deepEqual(formAction.store.getState().values, { name: "Ada" });
});

test("createServerFormAction defaults to same-origin credentials", async () => {
  const calls: RequestInit[] = [];
  const formAction = createServerFormAction("/login", {
    fetch: (async (_input, init) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch
  });

  const result = await formAction.submit({ email: "ada@example.com" });

  assert.equal(result.status, "success");
  assert.equal(calls[0]?.credentials, "same-origin");
  assert.equal(calls[0]?.method, "POST");
  assert.ok(calls[0]?.body instanceof FormData);
  assert.ok(calls[0]?.signal instanceof AbortSignal);
});

test("createServerFormAction allows cross-origin credentials", async () => {
  const calls: RequestInit[] = [];
  const formAction = createServerFormAction("https://api.example.com/auth/login", {
    credentials: "include",
    fetch: (async (_input, init) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch
  });

  const result = await formAction.submit({ email: "ada@example.com" });

  assert.equal(result.status, "success");
  assert.equal(calls[0]?.credentials, "include");
});

test("createServerFormAction can submit JSON bodies", async () => {
  const calls: RequestInit[] = [];
  const formAction = createServerFormAction("https://api.example.com/auth/login", {
    contentType: "json",
    fetch: (async (_input, init) => {
      calls.push(init ?? {});
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" }
      });
    }) as typeof fetch
  });

  const result = await formAction.submit({ email: "ada@example.com", password: "secret" });
  const headers = new Headers(calls[0]?.headers);

  assert.equal(result.status, "success");
  assert.equal(headers.get("content-type"), "application/json");
  assert.equal(calls[0]?.body, JSON.stringify({ email: "ada@example.com", password: "secret" }));
});

test("createServerFormAction preserves explicit JSON content type", async () => {
  const calls: RequestInit[] = [];
  const formAction = createServerFormAction("/login", {
    contentType: "json",
    headers: { "content-type": "application/vnd.api+json" },
    fetch: (async (_input, init) => {
      calls.push(init ?? {});
      return new Response("{}");
    }) as typeof fetch
  });

  await formAction.submit({ email: "ada@example.com" });

  assert.equal(new Headers(calls[0]?.headers).get("content-type"), "application/vnd.api+json");
});

test("createServerFormAction accepts a custom body serializer", async () => {
  const calls: RequestInit[] = [];
  const formAction = createServerFormAction("/login", {
    body: (values) => new URLSearchParams(values as Record<string, string>),
    headers: { "content-type": "application/x-www-form-urlencoded" },
    fetch: (async (_input, init) => {
      calls.push(init ?? {});
      return new Response("{}");
    }) as typeof fetch
  });

  await formAction.submit({ email: "ada@example.com" });

  assert.equal(String(calls[0]?.body), "email=ada%40example.com");
  assert.equal(new Headers(calls[0]?.headers).get("content-type"), "application/x-www-form-urlencoded");
});

test("createServerFormAction can select JSON for CSR and FormData for SSR hydration", async () => {
  const csrCalls: RequestInit[] = [];
  const clearCsrDom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  try {
    const csrAction = createServerFormAction("/login", {
      contentType: { csr: "json", ssr: "form-data" },
      fetch: (async (_input, init) => {
        csrCalls.push(init ?? {});
        return new Response("{}");
      }) as typeof fetch
    });

    await csrAction.submit({ email: "ada@example.com" });

    assert.equal(csrCalls[0]?.body, JSON.stringify({ email: "ada@example.com" }));
    assert.equal(new Headers(csrCalls[0]?.headers).get("content-type"), "application/json");
  } finally {
    clearCsrDom();
  }

  const ssrCalls: RequestInit[] = [];
  const clearSsrDom = setupDom(
    `<!doctype html><html><body><script id="__TAVO_STATE__" type="application/json">{}</script><div id="app"></div></body></html>`
  );
  try {
    const ssrAction = createServerFormAction("/login", {
      contentType: { csr: "json", ssr: "form-data" },
      fetch: (async (_input, init) => {
        ssrCalls.push(init ?? {});
        return new Response("{}");
      }) as typeof fetch
    });

    await ssrAction.submit({ email: "ada@example.com" });

    assert.ok(ssrCalls[0]?.body instanceof FormData);
    assert.equal(new Headers(ssrCalls[0]?.headers).get("content-type"), null);
  } finally {
    clearSsrDom();
  }
});
