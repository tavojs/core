import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JSDOM } from "jsdom";
import { Deferred, createRoot, h, renderToString } from "../../src/index.tsx";
import { renderDocument, renderDocumentStream } from "../../src/server.ts";
import { renderPagesResponseAsync } from "../../src/framework/index.ts";
import { createFetchRequestHandler } from "../../src/ssr/handlers.ts";
import { optimizeImageFromUrl } from "../../src/ssr/image.ts";
import { definePlugin } from "../../src/plugins/index.ts";
import { normalizeRedirectTarget } from "../../src/security.ts";
import {
  attackPayload,
  createMaliciousSecurityModules,
  createMaliciousSecurityPlugin,
} from "./security-fixtures.ts";

type GlobalWithDom = typeof globalThis & {
  window?: Window & typeof globalThis;
  document?: Document;
  Node?: typeof Node;
  HTMLElement?: typeof HTMLElement;
  Text?: typeof Text;
};

function setupDom(markup: string) {
  const dom = new JSDOM(markup);
  const globalRef = globalThis as GlobalWithDom;
  globalRef.window = dom.window as unknown as Window & typeof globalThis;
  globalRef.document = dom.window.document;
  globalRef.Node = dom.window.Node;
  globalRef.HTMLElement = dom.window.HTMLElement;
  globalRef.Text = dom.window.Text;
  return dom;
}

function clearDom() {
  const globalRef = globalThis as GlobalWithDom;
  delete globalRef.window;
  delete globalRef.document;
  delete globalRef.Node;
  delete globalRef.HTMLElement;
  delete globalRef.Text;
}

async function streamToText(
  stream: ReadableStream<Uint8Array>,
): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return `${text}${decoder.decode()}`;
}

test("security: SSR skips unsafe attribute names and unsafe URL protocols", () => {
  const html = renderToString(
    h(
      "a",
      {
        "bad name": "x",
        ONERROR: "alert(1)",
        href: "javascript:alert(1)",
        title: "safe",
      },
      "link",
    ),
  );

  assert.doesNotMatch(html, /bad name/);
  assert.doesNotMatch(html, /onerror/i);
  assert.doesNotMatch(html, /javascript:alert/);
  assert.match(html, /title="safe"/);
});

test("security: SSR skips protocol-relative URL attributes", () => {
  const html = renderToString(
    h(
      "a",
      {
        href: "//evil.example/phish",
        title: "safe",
      },
      "link",
    ),
  );

  assert.doesNotMatch(html, /evil\.example/);
  assert.match(html, /title="safe"/);
});

test("security: SSR validates every URL in srcset and ping attributes", () => {
  const html = renderToString([
    h("img", { srcset: "/safe.png 1x, javascript:alert(1) 2x" }),
    h("a", { ping: "https://safe.example javascript:alert(2)" }, "link"),
  ]);

  assert.doesNotMatch(html, /srcset=/i);
  assert.doesNotMatch(html, /ping=/i);
});

test("security: SSR blocks iframe srcdoc and unsafe object data URLs", () => {
  const html = renderToString([
    h("iframe", { srcdoc: "<script>alert(1)</script>" }),
    h("object", { data: "javascript:alert(2)" }),
  ]);

  assert.doesNotMatch(html, /srcdoc/i);
  assert.doesNotMatch(html, /javascript:alert/);
});

test("security: document attributes are validated and serialized state is script-safe", () => {
  const html = renderDocument(h("main", null, "safe"), {
    htmlAttributes: {
      "bad name": "x",
      dir: "ltr",
    },
    bodyAttributes: {
      onload: "alert(1)",
      ONFOCUS: "alert(2)",
    },
    initialState: {
      value: "</script><script>alert(1)</script>",
    },
  });

  assert.doesNotMatch(html, /bad name/);
  assert.doesNotMatch(html, /onload|onfocus/i);
  assert.match(html, /dir="ltr"/);
  assert.doesNotMatch(html, /<\/script><script>/);
  assert.match(html, /\\u003c\/script/);
});

test("security: streamed deferred patch payloads are script-safe", async () => {
  const html = await streamToText(
    renderDocumentStream(
      h(
        "main",
        null,
        h(
          Deferred,
          {
            id: "unsafe-deferred",
            value: Promise.resolve("</script><script>alert(1)</script>"),
            fallback: h("p", null, "loading"),
          },
          (value: unknown) => h("p", null, String(value)),
        ),
      ),
    ),
  );

  assert.doesNotMatch(html, /<\/script><script>alert\(1\)<\/script>/);
  assert.match(html, /\\u003c\/script/);
  assert.match(
    html,
    /\\u0026lt;\/script\\u0026gt;\\u0026lt;script\\u0026gt;alert\(1\)\\u0026lt;\/script\\u0026gt;/,
  );
});

test("security: SSR falls back for unsafe element tag names", () => {
  const html = renderToString(h("img src=x onerror=alert(1)", null, "safe"));

  assert.equal(html, "<div>safe</div>");
  assert.doesNotMatch(html, /onerror/);
});

test("security: SSR Deferred falls back for unsafe wrapper tag names", () => {
  const html = renderToString(
    h(
      Deferred,
      {
        id: "unsafe-deferred-wrapper",
        value: Promise.resolve("ready"),
        as: "img src=x onerror=alert(1)",
        fallback: "loading",
      },
      (value: unknown) => h("p", null, String(value)),
    ),
  );

  assert.match(
    html,
    /^<div id="unsafe-deferred-wrapper" data-tavo-deferred="pending">loading<\/div>$/,
  );
  assert.doesNotMatch(html, /onerror/);
});

test("security: streamed SSR falls back for unsafe element tag names", async () => {
  const html = await streamToText(
    renderDocumentStream(h("img src=x onerror=alert(1)", null, "safe")),
  );

  assert.match(html, /<div id="app"><div>safe<\/div><\/div>/);
  assert.doesNotMatch(html, /onerror/);
});

test("security: DOM renderer does not set string event-handler attributes", () => {
  const dom = setupDom(
    `<!doctype html><html><body><div id="app"></div></body></html>`,
  );
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  createRoot(app).render(
    h("img", {
      src: "javascript:alert(1)",
      onerror: "alert(1)",
      ONLOAD: "alert(2)",
      alt: "x",
    }),
  );

  const image = app.querySelector("img");
  assert.ok(image);
  assert.equal(image.getAttribute("src"), null);
  assert.equal(image.getAttribute("onerror"), null);
  assert.equal(image.getAttribute("onload"), null);
  assert.equal(image.getAttribute("alt"), "x");

  clearDom();
});

test("security: DOM renderer blocks iframe srcdoc and unsafe object data URLs", () => {
  const dom = setupDom(
    `<!doctype html><html><body><div id="app"></div></body></html>`,
  );
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  createRoot(app).render([
    h("iframe", { srcDoc: "<script>alert(1)</script>" }),
    h("object", { data: "javascript:alert(2)" }),
  ]);

  assert.equal(app.querySelector("iframe")?.getAttribute("srcdoc"), null);
  assert.equal(app.querySelector("object")?.getAttribute("data"), null);
  clearDom();
});

test("security: DOM renderer falls back for unsafe element tag names", () => {
  const dom = setupDom(
    `<!doctype html><html><body><div id="app"></div></body></html>`,
  );
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  createRoot(app).render(h("img src=x onerror=alert(1)", null, "safe"));

  assert.equal(app.querySelector("img"), null);
  const fallback = app.querySelector("div");
  assert.ok(fallback);
  assert.equal(fallback.textContent, "safe");
  assert.equal(fallback.getAttribute("onerror"), null);

  clearDom();
});

test("security: DOM renderer rejects protocol-relative URL attributes", () => {
  const dom = setupDom(
    `<!doctype html><html><body><div id="app"></div></body></html>`,
  );
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  createRoot(app).render(
    h(
      "a",
      {
        href: "//evil.example/phish",
        title: "safe",
      },
      "link",
    ),
  );

  const anchor = app.querySelector("a");
  assert.ok(anchor);
  assert.equal(anchor.getAttribute("href"), null);
  assert.equal(anchor.getAttribute("title"), "safe");

  clearDom();
});

test("security: deferred ids cannot read inherited registry keys", () => {
  const dom = setupDom(
    `<!doctype html><html><body><div id="app"></div></body></html>`,
  );
  (
    dom.window as typeof dom.window & {
      __TAVO_DEFERRED__?: Record<string, unknown>;
    }
  ).__TAVO_DEFERRED__ = {};
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  createRoot(app).render(
    h(
      Deferred,
      {
        id: "__proto__",
        value: "safe",
        fallback: "loading",
      },
      (value: string) => h("p", null, value),
    ),
  );

  assert.equal(app.textContent, "safe");
  clearDom();
});

test("security: SSR responses include default hardening headers", async () => {
  const response = await renderPagesResponseAsync(
    {
      "/src/pages/index.tsx": {
        default: () => h("main", null, "home"),
      },
    },
    "/",
  );

  assert.equal(response.headers["X-Content-Type-Options"], "nosniff");
  assert.equal(
    response.headers["Referrer-Policy"],
    "strict-origin-when-cross-origin",
  );
  assert.match(response.headers["Permissions-Policy"], /camera=\(\)/);
});

test("security: malicious fixture escapes reflected route params and loader query data", async () => {
  const handle = createFetchRequestHandler({
    modules: createMaliciousSecurityModules(),
  });
  const response = await handle(
    new Request(
      `http://localhost/reflected/${encodeURIComponent(attackPayload)}?q=${encodeURIComponent(attackPayload)}`,
    ),
  );
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.doesNotMatch(html, /<\/script><script>alert\(1\)<\/script>/);
  assert.match(
    html,
    /&lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;/,
  );
  assert.match(
    html,
    /title="&lt;\/script&gt;&lt;script&gt;alert\(1\)&lt;\/script&gt;"/,
  );
});

test("security: malicious fixture plugin raw head is explicit and server responses are hardened", async () => {
  const handle = createFetchRequestHandler({
    modules: createMaliciousSecurityModules(),
    plugins: [createMaliciousSecurityPlugin()],
  });

  const page = await handle(new Request("http://localhost/reflected/safe"));
  const api = await handle(new Request("http://localhost/api/fixture"));

  assert.match(await page.text(), /__tavo_raw_head_fixture/);
  assert.equal(api.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(await api.json(), { ok: true });
});

test("security: page SSR rejects mutation methods before running loaders", async () => {
  let loadCalls = 0;
  const handle = createFetchRequestHandler({
    modules: {
      "/src/pages/account.tsx": {
        load: () => {
          loadCalls += 1;
          return { ok: true };
        },
        default: () => h("main", null, "account"),
      },
    },
  });

  const response = await handle(
    new Request("http://localhost/account", {
      method: "POST",
      body: "mutate=1",
    }),
  );

  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
  assert.equal(loadCalls, 0);
});

test("security: static SSR cache varies by query string", async () => {
  let loadCalls = 0;
  const handle = createFetchRequestHandler({
    modules: {
      "/src/pages/report.tsx": {
        static: true,
        load: ({ request }) => {
          loadCalls += 1;
          const url =
            request instanceof Request
              ? new URL(request.url)
              : new URL("http://localhost/report");
          return { user: url.searchParams.get("user") };
        },
        default: (props: any) => h("main", null, `user:${props.data.user}`),
      },
    },
  });

  const alice = await handle(new Request("http://localhost/report?user=alice"));
  const bob = await handle(new Request("http://localhost/report?user=bob"));
  const aliceAgain = await handle(
    new Request("http://localhost/report?user=alice"),
  );

  assert.match(await alice.text(), /user:alice/);
  assert.match(await bob.text(), /user:bob/);
  assert.match(await aliceAgain.text(), /user:alice/);
  assert.equal(loadCalls, 2);
});

test("security: static SSR cache varies by declared request headers", async () => {
  let loadCalls = 0;
  const handle = createFetchRequestHandler({
    modules: {
      "/src/pages/report.tsx": {
        static: true,
        vary: "x-tenant",
        load: ({ request }) => {
          loadCalls += 1;
          const tenant =
            request instanceof Request ? request.headers.get("x-tenant") : null;
          return { tenant };
        },
        default: (props: any) => h("main", null, `tenant:${props.data.tenant}`),
      },
    },
  });

  const alpha = await handle(
    new Request("http://localhost/report", {
      headers: { "x-tenant": "alpha" },
    }),
  );
  const beta = await handle(
    new Request("http://localhost/report", {
      headers: { "x-tenant": "beta" },
    }),
  );
  const alphaAgain = await handle(
    new Request("http://localhost/report", {
      headers: { "x-tenant": "alpha" },
    }),
  );
  const unspecified = await handle(new Request("http://localhost/report"));

  assert.match(await alpha.text(), /tenant:alpha/);
  assert.match(await beta.text(), /tenant:beta/);
  assert.match(await alphaAgain.text(), /tenant:alpha/);
  assert.equal(alpha.headers.get("vary"), "X-Tenant");
  assert.equal(unspecified.headers.get("vary"), "X-Tenant");
  assert.equal(loadCalls, 3);
});

test("security: static SSR cache is bypassed for cookie or authorization requests", async () => {
  let loadCalls = 0;
  const handle = createFetchRequestHandler({
    modules: {
      "/src/pages/profile.tsx": {
        static: true,
        load: ({ request }) => {
          loadCalls += 1;
          const cookie =
            request instanceof Request
              ? (request.headers.get("cookie") ?? "")
              : "";
          return { session: cookie.includes("session=bob") ? "bob" : "alice" };
        },
        default: (props: any) =>
          h("main", null, `session:${props.data.session}`),
      },
    },
  });

  const alice = await handle(
    new Request("http://localhost/profile", {
      headers: { cookie: "session=alice" },
    }),
  );
  const bob = await handle(
    new Request("http://localhost/profile", {
      headers: { cookie: "session=bob" },
    }),
  );

  assert.match(await alice.text(), /session:alice/);
  assert.match(await bob.text(), /session:bob/);
  assert.equal(alice.headers.get("cache-control"), null);
  assert.equal(bob.headers.get("cache-control"), null);
  assert.equal(loadCalls, 2);
});

test("security: static SSR cache does not store loader errors", async () => {
  let loadCalls = 0;
  const handle = createFetchRequestHandler({
    modules: {
      "/src/pages/flaky.tsx": {
        static: true,
        load: () => {
          loadCalls += 1;
          if (loadCalls === 1) {
            throw new Error("transient failure");
          }
          return { ok: true };
        },
        default: (props: any) => h("main", null, props.error ? "error" : "ok"),
      },
    },
  });

  const first = await handle(new Request("http://localhost/flaky"));
  const second = await handle(new Request("http://localhost/flaky"));

  assert.equal(first.headers.get("cache-control"), null);
  assert.match(await first.text(), /error/);
  assert.match(await second.text(), /ok/);
  assert.equal(loadCalls, 2);
});

test("security: automatic SSR state does not disclose loader error details", async () => {
  const secret = "postgres://admin:password@internal/database";
  const response = await renderPagesResponseAsync(
    {
      "/src/pages/index.tsx": {
        static: true,
        load: () => {
          throw secret;
        },
        default: () => h("main", null, "request failed"),
      },
    },
    "/",
  );

  assert.equal(response.status, 500);
  assert.equal(response.headers["Cache-Control"], undefined);
  assert.doesNotMatch(
    response.html,
    new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.match(response.html, /Internal Server Error/);
});

test("security: static SSR cache coalesces concurrent renders by cache key", async () => {
  let loadCalls = 0;
  let resolveLoad: ((value: { tenant: string }) => void) | undefined;
  const pendingLoad = new Promise<{ tenant: string }>((resolve) => {
    resolveLoad = resolve;
  });
  const handle = createFetchRequestHandler({
    modules: {
      "/src/pages/report.tsx": {
        static: true,
        load: () => {
          loadCalls += 1;
          return pendingLoad;
        },
        default: (props: any) => h("main", null, `tenant:${props.data.tenant}`),
      },
    },
  });

  const first = handle(new Request("http://localhost/report"));
  const second = handle(new Request("http://localhost/report"));
  resolveLoad?.({ tenant: "alpha" });

  assert.match(await (await first).text(), /tenant:alpha/);
  assert.match(await (await second).text(), /tenant:alpha/);
  assert.equal(loadCalls, 1);
});

test("security: external redirects are blocked by default", async () => {
  await assert.rejects(
    renderPagesResponseAsync(
      {
        "/src/pages/index.tsx": {
          middleware: () => ({ redirect: "https://evil.example/phish" }),
          default: () => h("main", null, "home"),
        },
      },
      "/",
    ),
    /external redirects are disabled/,
  );
});

test("security: same-origin redirects reject backslash and encoded authority bypasses", () => {
  for (const target of [
    "/\\evil.example",
    "/\\/evil.example",
    "/%5cevil.example",
    "/%2fevil.example",
  ]) {
    assert.throws(
      () => normalizeRedirectTarget(target),
      /protocol-relative redirects/,
    );
  }
  assert.equal(
    normalizeRedirectTarget("/safe/path?next=1"),
    "/safe/path?next=1",
  );
});

test("security: redirect meta refresh escapes same-origin targets", async () => {
  const response = await renderPagesResponseAsync(
    {
      "/src/pages/index.tsx": {
        middleware: () => ({ redirect: "/next?value=<x>" }),
        default: () => h("main", null, "home"),
      },
    },
    "/",
  );

  assert.equal(response.headers.Location, "/next?value=<x>");
  assert.match(response.html, /url=\/next\?value=&lt;x&gt;/);
});

test("security: plugin server responses receive default hardening headers", async () => {
  const handle = createFetchRequestHandler({
    modules: {
      "/src/pages/index.tsx": {
        default: () => h("main", null, "home"),
      },
    },
    plugins: [
      definePlugin({
        id: "api",
        version: "1.0.0",
        apiVersion: 1,
        manifest: {
          exposure: [
            {
              target: "server",
              to: "/",
              reason: "Exposes the hardened test endpoint.",
            },
          ],
          endpoints: [
            {
              id: "raw",
              methods: ["GET"],
              match: { kind: "exact", path: "/api/raw" },
            },
          ],
        },
        server: () => ({
          endpoints: { raw: () => Response.json({ ok: true }) },
        }),
      }),
    ],
  });

  const response = await handle(new Request("http://localhost/api/raw"));

  assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(response.headers.get("X-Frame-Options"), "SAMEORIGIN");
  assert.deepEqual(await response.json(), { ok: true });
});

test("security: plugin raw head HTML remains an explicit escape hatch", async () => {
  const response = await renderPagesResponseAsync(
    {
      "/src/pages/index.tsx": {
        default: () => h("main", null, "home"),
      },
    },
    "/",
    {
      plugins: [
        definePlugin({
          id: "raw-head",
          version: "1.0.0",
          apiVersion: 1,
          manifest: {
            permissions: [
              {
                name: "unsafeHeadHtml",
                reason: "Exercises the trusted raw-head escape hatch.",
              },
            ],
            head: [
              {
                id: "raw",
                key: "raw:test",
                cardinality: "multi",
                unsafeHeadHtml: true,
              },
            ],
          },
          server: () => ({
            head: {
              raw: "<script>window.__raw_head_escape_hatch = true</script>",
            },
          }),
        }),
      ],
    },
  );

  assert.match(response.html, /window\.__raw_head_escape_hatch = true/);
});

test("security: remote image redirects are revalidated", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(null, {
      status: 302,
      headers: {
        Location: "http://127.0.0.1/internal.png",
      },
    })) as typeof fetch;

  try {
    await assert.rejects(
      optimizeImageFromUrl(
        new URL(
          "http://example.com/_tavo/image?src=https%3A%2F%2F93.184.216.34%2Fimage.png&w=320",
        ),
        {
          allowRemote: true,
          remotePatterns: ["93.184.216.34"],
        },
      ),
      /private network image hosts are not allowed/,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("security: remote image timeout covers slow response bodies", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async (_input, init) => {
    const signal = init?.signal;
    return new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("Aborted", "AbortError")),
            {
              once: true,
            },
          );
        },
      }),
      { status: 200, headers: { "content-type": "image/png" } },
    );
  }) as typeof fetch;

  try {
    await assert.rejects(
      optimizeImageFromUrl(
        new URL(
          "http://localhost/_tavo/image?src=https%3A%2F%2Fcdn.example.com%2Fslow.png&w=320",
        ),
        {
          allowRemote: true,
          remotePatterns: ["*.example.com"],
          resolveHostname: async () => [{ address: "93.184.216.34" }],
          timeoutMs: 10,
        },
      ),
      /aborted/i,
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("security: local image optimizer rejects symlink escapes from publicDir", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-image-security-"));
  const publicDir = path.join(root, "public");
  await fs.mkdir(publicDir);
  const secretFile = path.join(root, "secret.png");
  await fs.writeFile(secretFile, "not really an image", "utf8");
  await fs.symlink(secretFile, path.join(publicDir, "leak.png"));

  const previousCwd = process.cwd();
  try {
    process.chdir(root);
    await assert.rejects(
      optimizeImageFromUrl(
        new URL("http://localhost/_tavo/image?src=%2Fleak.png&w=320"),
        {
          publicDir,
          maxBytes: 1024,
        },
      ),
      /attempted to read outside the public directory/,
    );
  } finally {
    process.chdir(previousCwd);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("security: image optimizer rejects private IPv6 remote hosts", async () => {
  await assert.rejects(
    optimizeImageFromUrl(
      new URL(
        "http://localhost/_tavo/image?src=https%3A%2F%2F%5B%3A%3A1%5D%2Fimage.png&w=320",
      ),
      {
        allowRemote: true,
        remotePatterns: [{ protocol: "https:", hostname: "[::1]" }],
      },
    ),
    /private network image hosts are not allowed/,
  );
});

test("security: image optimizer rejects IPv4-mapped private hosts and unlisted ports", async () => {
  await assert.rejects(
    optimizeImageFromUrl(
      new URL(
        "http://localhost/_tavo/image?src=https%3A%2F%2F%5B%3A%3Affff%3A127.0.0.1%5D%2Fimage.png&w=320",
      ),
      {
        allowRemote: true,
        remotePatterns: [{ hostname: "[::ffff:127.0.0.1]" }],
      },
    ),
    /private network image hosts are not allowed/,
  );
  await assert.rejects(
    optimizeImageFromUrl(
      new URL(
        "http://localhost/_tavo/image?src=https%3A%2F%2Fcdn.example.com%3A8443%2Fimage.png&w=320",
      ),
      {
        allowRemote: true,
        remotePatterns: ["*.example.com"],
        resolveHostname: async () => [{ address: "93.184.216.34" }],
      },
    ),
    /remote image host is not allowed/,
  );
});

test("security: remote image wildcard patterns do not match apex hosts", async () => {
  await assert.rejects(
    optimizeImageFromUrl(
      new URL(
        "http://localhost/_tavo/image?src=https%3A%2F%2Fexample.com%2Fimage.png&w=320",
      ),
      {
        allowRemote: true,
        remotePatterns: ["*.example.com"],
      },
    ),
    /remote image host is not allowed/,
  );
});

test("security: remote image DNS checks reject private resolved addresses", async () => {
  await assert.rejects(
    optimizeImageFromUrl(
      new URL(
        "http://localhost/_tavo/image?src=https%3A%2F%2Fcdn.example.com%2Fimage.png&w=320",
      ),
      {
        allowRemote: true,
        remotePatterns: ["*.example.com"],
        resolveHostname: async () => [{ address: "10.0.0.4" }],
      },
    ),
    /private network image hosts are not allowed/,
  );
});
