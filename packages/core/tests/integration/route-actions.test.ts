import test from "node:test";
import assert from "node:assert/strict";
import { h } from "../../src/index.tsx";
import { defineAction } from "../../src/framework/index.ts";
import { createNodeRequestHandler } from "../../src/ssr/index.ts";
import { createFetchRequestHandler } from "../../src/ssr/handlers.ts";
import { createFetchRequestFromNodeRequest } from "../../src/ssr/request.ts";
import {
  createViteDevRequestUrl,
  isViteDevMonitorAuthorized,
  withViteDevHtmlHeaders
} from "../../src/ssr/vite-dev.ts";
import { validateActionOrigin } from "../../src/framework/runtime/actions.ts";
import { defineValidatedAction } from "../../src/validation.ts";

function createModules() {
  return {
    "/src/pages/login.tsx": {
      action: defineAction(async ({ request }) => {
        const form = await request.formData();
        return {
          json: { ok: true, email: String(form.get("email")) },
          headers: {
            "Set-Cookie": ["a=1; Path=/; HttpOnly", "b=2; Path=/; HttpOnly"]
          }
        };
      }),
      default: () => h("main", null, "login page")
    },
    "/src/pages/redirect.tsx": {
      action: defineAction(() => ({ redirect: "/dashboard" })),
      default: () => h("main", null, "redirect page")
    }
  };
}

function readHeader(headers: Record<string, string | string[]>, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  const value = entry?.[1];
  return Array.isArray(value) ? value.join(", ") : value;
}

async function runNodeHandler(
  handle: ReturnType<typeof createNodeRequestHandler>,
  req: {
    url?: string;
    method?: string;
    headers?: Record<string, string | undefined>;
    chunks?: Array<string | Uint8Array>;
  }
): Promise<{ status: number; headers: Record<string, string | string[]>; body: string }> {
  let status = 0;
  let headers: Record<string, string | string[]> = {};
  let body = "";

  await handle(
    {
      url: req.url,
      method: req.method,
      headers: req.headers,
      async *[Symbol.asyncIterator]() {
        for (const chunk of req.chunks ?? []) {
          yield typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk;
        }
      }
    } as never,
    {
      writeHead(nextStatus, nextHeaders) {
        status = nextStatus;
        headers = nextHeaders;
      },
      write() {},
      end(chunk) {
        body = chunk ? String(Buffer.from(chunk as Uint8Array)) : "";
      }
    }
  );

  return { status, headers, body };
}

test("route actions handle POST while GET renders the page", async () => {
  const handler = createFetchRequestHandler({ modules: createModules() });

  const get = await handler(new Request("https://example.com/login"));
  assert.equal(get.status, 200);
  assert.match(await get.text(), /login page/);

  const post = await handler(new Request("https://example.com/login", {
    method: "POST",
    headers: {
      origin: "https://example.com"
    },
    body: new URLSearchParams({ email: "ada@example.com" })
  }));

  assert.equal(post.status, 200);
  assert.equal(post.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(post.headers.get("X-Frame-Options"), "SAMEORIGIN");
  assert.deepEqual(await post.json(), { ok: true, email: "ada@example.com" });
});

test("route actions can declare accepted form content type", async () => {
  const handler = createFetchRequestHandler({
    modules: {
      "/src/pages/login.tsx": {
        action: defineAction(async ({ request }) => {
          const form = await request.formData();
          return { json: { email: String(form.get("email")) } };
        }, { contentType: "form-data" }),
        default: () => h("main", null, "login page")
      }
    }
  });

  const accepted = await handler(new Request("https://example.com/login", {
    method: "POST",
    body: new URLSearchParams({ email: "ada@example.com" })
  }));
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { email: "ada@example.com" });

  const rejected = await handler(new Request("https://example.com/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com" })
  }));
  assert.equal(rejected.status, 415);
  assert.equal(rejected.headers.get("X-Content-Type-Options"), "nosniff");
});

test("route actions can declare accepted JSON content type", async () => {
  const handler = createFetchRequestHandler({
    modules: {
      "/src/pages/login.tsx": {
        action: defineAction(async ({ request }) => {
          return { json: await request.json() };
        }, { contentType: "json" }),
        default: () => h("main", null, "login page")
      }
    }
  });

  const accepted = await handler(new Request("https://example.com/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "ada@example.com" })
  }));
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { email: "ada@example.com" });

  const rejected = await handler(new Request("https://example.com/login", {
    method: "POST",
    body: new URLSearchParams({ email: "ada@example.com" })
  }));
  assert.equal(rejected.status, 415);
});

test("route actions allow unsafe methods without an Origin header", async () => {
  const handler = createFetchRequestHandler({ modules: createModules() });

  const response = await handler(new Request("https://example.com/login", {
    method: "POST",
    body: new URLSearchParams({ email: "ada@example.com" })
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, email: "ada@example.com" });
});

test("route actions use 303 redirects by default", async () => {
  const handler = createFetchRequestHandler({ modules: createModules() });
  const response = await handler(new Request("https://example.com/redirect", {
    method: "POST",
    headers: {
      origin: "https://example.com"
    },
    redirect: "manual"
  }));

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/dashboard");
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("route actions reject mismatched browser origins", async () => {
  const handler = createFetchRequestHandler({ modules: createModules() });
  const response = await handler(new Request("https://example.com/login", {
    method: "POST",
    headers: {
      origin: "https://evil.example"
    },
    body: new URLSearchParams({ email: "ada@example.com" })
  }));

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
});

test("node route actions reject host-header spoofing unless the host is trusted", async () => {
  const untrusted = createNodeRequestHandler({ modules: createModules() });
  const trusted = createNodeRequestHandler({
    modules: createModules(),
    trustedHosts: ["example.com"]
  });
  const body = new URLSearchParams({ email: "ada@example.com" }).toString();

  const rejected = await runNodeHandler(untrusted, {
    url: "/login",
    method: "POST",
    headers: {
      host: "evil.example",
      origin: "http://evil.example",
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    chunks: [body]
  });
  const rejectedWithoutOrigin = await runNodeHandler(untrusted, {
    url: "/login",
    method: "POST",
    headers: {
      host: "evil.example",
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    chunks: [body]
  });
  const accepted = await runNodeHandler(trusted, {
    url: "/login",
    method: "POST",
    headers: {
      host: "example.com",
      origin: "http://example.com",
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    chunks: [body]
  });

  assert.equal(rejected.status, 403);
  assert.equal(rejectedWithoutOrigin.status, 403);
  assert.equal(accepted.status, 200);
  assert.match(accepted.body, /ada@example.com/);
});

test("vite dev action requests preserve the browser host and port for origin validation", async () => {
  const rawRequest = {
    url: "/login",
    method: "POST",
    headers: {
      host: "localhost:4174",
      origin: "http://localhost:4174",
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    async *[Symbol.asyncIterator]() {
      yield new URLSearchParams({ email: "ada@example.com" }).toString();
    }
  };
  const url = createViteDevRequestUrl(rawRequest);
  const request = await createFetchRequestFromNodeRequest(rawRequest, url);

  assert.equal(url.href, "http://localhost:4174/login");
  assert.equal(request.url, "http://localhost:4174/login");
  assert.equal(validateActionOrigin(request, { rawRequest }), true);
});

test("vite dev rendered HTML cannot retain production cache headers", () => {
  const headers = withViteDevHtmlHeaders({
    "Content-Type": "text/html; charset=utf-8",
    "cache-control": "public, max-age=31536000, immutable",
    Vary: "Accept-Language"
  });

  assert.deepEqual(headers, {
    "Content-Type": "text/html; charset=utf-8",
    Vary: "Accept-Language",
    "Cache-Control": "no-store"
  });
});

test("Node request conversion preserves disconnect cancellation", async () => {
  const controller = new AbortController();
  const request = await createFetchRequestFromNodeRequest(
    { url: "/slow", method: "GET", headers: { host: "localhost" } },
    new URL("http://localhost/slow"),
    { signal: controller.signal }
  );

  assert.equal(request.signal.aborted, false);
  controller.abort(new DOMException("Client disconnected", "AbortError"));
  assert.equal(request.signal.aborted, true);
  assert.equal(request.signal.reason.name, "AbortError");
});

test("vite dev monitor always requires an exact bearer token", () => {
  assert.equal(isViteDevMonitorAuthorized({
    headers: {}
  }, { host: "127.0.0.1" }), false);
  assert.equal(isViteDevMonitorAuthorized({
    headers: {}
  }, { host: "0.0.0.0" }), false);
  assert.equal(isViteDevMonitorAuthorized({
    headers: { authorization: "Bearer secret" }
  }, { host: "0.0.0.0", token: "secret" }), true);
  assert.equal(isViteDevMonitorAuthorized({
    headers: {}
  }, { host: "0.0.0.0", token: "secret" }), false);
});

test("route actions can explicitly disable origin validation", async () => {
  const handler = createFetchRequestHandler({
    modules: {
      "/src/pages/webhook.tsx": {
        action: defineAction(() => ({ json: { ok: true } }), { validateOrigin: false }),
        default: () => h("main", null, "webhook")
      }
    }
  });

  const response = await handler(new Request("https://example.com/webhook", {
    method: "POST",
    headers: {
      origin: "https://webhook.example"
    },
    body: "{}"
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("node handler preserves repeated Set-Cookie headers from actions", async () => {
  const handle = createNodeRequestHandler({
    modules: createModules(),
    trustedHosts: ["example.com"]
  });
  const result = await runNodeHandler(handle, {
    url: "/login",
    method: "POST",
    headers: {
      host: "example.com",
      origin: "http://example.com",
      "content-type": "application/x-www-form-urlencoded;charset=UTF-8"
    },
    chunks: [new URLSearchParams({ email: "ada@example.com" }).toString()]
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.headers["Set-Cookie"], [
    "a=1; Path=/; HttpOnly",
    "b=2; Path=/; HttpOnly"
  ]);
  assert.match(result.body, /ada@example.com/);
});

test("node handler canonicalOrigin preserves HTTPS behind trusted TLS termination", async () => {
  const handle = createNodeRequestHandler({
    canonicalOrigin: "https://app.example.com",
    modules: {
      "/src/pages/submit.tsx": {
        action: defineAction(async ({ request }) => ({
          json: { origin: new URL(request.url).origin }
        })),
        default: () => h("main", null, "submit")
      }
    }
  });

  const result = await runNodeHandler(handle, {
    url: "/submit",
    method: "POST",
    headers: {
      host: "internal-proxy:8080",
      origin: "https://app.example.com"
    }
  });

  assert.equal(result.status, 200);
  assert.deepEqual(JSON.parse(result.body), { origin: "https://app.example.com" });
  assert.throws(
    () => createNodeRequestHandler({ canonicalOrigin: "https://app.example.com/path", modules: {} }),
    /canonicalOrigin must be an HTTP\(S\) origin/
  );
});

test("node handler canonicalOrigin keeps static cache query variants isolated", async () => {
  const handle = createNodeRequestHandler({
    canonicalOrigin: "https://app.example.com",
    modules: {
      "/src/pages/report.tsx": {
        static: true,
        load: ({ url }) => ({ tenant: url.searchParams.get("tenant") }),
        default: (props: any) => h("main", null, String(props.data.tenant))
      }
    }
  });

  const alpha = await runNodeHandler(handle, {
    url: "/report?tenant=alpha",
    method: "GET",
    headers: { host: "internal-proxy" }
  });
  const beta = await runNodeHandler(handle, {
    url: "/report?tenant=beta",
    method: "GET",
    headers: { host: "internal-proxy" }
  });

  assert.match(alpha.body, />alpha</);
  assert.match(beta.body, />beta</);
});

test("node handler rejects oversized action bodies by content-length", async () => {
  let actionCalls = 0;
  const handle = createNodeRequestHandler({
    maxRequestBodyBytes: 4,
    modules: {
      "/src/pages/login.tsx": {
        action: defineAction(() => {
          actionCalls += 1;
          return { json: { ok: true } };
        }),
        default: () => h("main", null, "login")
      }
    }
  });

  const result = await runNodeHandler(handle, {
    url: "/login",
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost",
      "content-length": "5"
    },
    chunks: ["hello"]
  });

  assert.equal(result.status, 413);
  assert.match(result.body, /Payload Too Large/);
  assert.equal(readHeader(result.headers, "X-Content-Type-Options"), "nosniff");
  assert.equal(actionCalls, 0);
});

test("node handler rejects oversized chunked action bodies while reading", async () => {
  let actionCalls = 0;
  const handle = createNodeRequestHandler({
    maxRequestBodyBytes: 4,
    modules: {
      "/src/pages/login.tsx": {
        action: defineAction(() => {
          actionCalls += 1;
          return { json: { ok: true } };
        }),
        default: () => h("main", null, "login")
      }
    }
  });

  const result = await runNodeHandler(handle, {
    url: "/login",
    method: "POST",
    headers: {
      host: "localhost",
      origin: "http://localhost"
    },
    chunks: ["he", "llo"]
  });

  assert.equal(result.status, 413);
  assert.equal(actionCalls, 0);
});

test("validated route actions return structured issues and typed input", async () => {
  const schema = {
    "~standard": {
      validate(value: unknown) {
        const input = value as { email?: unknown };
        return typeof input.email === "string" && input.email.includes("@")
          ? { value: { email: input.email.toLowerCase() } }
          : { issues: [{ message: "Invalid email", path: [{ key: "email" }] }] };
      }
    }
  };
  const handle = createFetchRequestHandler({
    modules: {
      "/src/pages/register.tsx": {
        action: defineValidatedAction(schema, ({ input }) => ({
          json: { email: input.email }
        })),
        default: () => h("main", null, "register")
      }
    }
  });

  const invalid = await handle(new Request("https://example.com/register", {
    method: "POST",
    headers: {
      origin: "https://example.com",
      "content-type": "application/json"
    },
    body: JSON.stringify({ email: "invalid" })
  }));
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), {
    error: "validation_failed",
    issues: [{ message: "Invalid email", path: ["email"] }]
  });

  const valid = await handle(new Request("https://example.com/register", {
    method: "POST",
    headers: {
      origin: "https://example.com",
      "content-type": "application/json"
    },
    body: JSON.stringify({ email: "USER@EXAMPLE.COM" })
  }));
  assert.equal(valid.status, 200);
  assert.deepEqual(await valid.json(), { email: "user@example.com" });
});
