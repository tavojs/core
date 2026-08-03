import test from "node:test";
import assert from "node:assert/strict";
import {
  createPagesRuntime,
  notFound,
  renderPagesDocumentAsync,
  renderPagesResponseAsync,
  renderPagesStreamResponseAsync
} from "../../src/framework/index.ts";
import {
  TAVO_PLUGIN_API_VERSION,
  definePlugin,
  definePluginPhase
} from "../../src/plugins/index.ts";
import { createMemoryStaticCache } from "../../src/ssr/index.ts";
import { createFetchRequestHandler } from "../../src/ssr/handlers.ts";
import { Deferred, createDeferredValue, createTavo, h, renderToString } from "../../src/index.tsx";

async function captureWarnings<T>(fn: () => Promise<T>): Promise<{ value: T; warnings: string[] }> {
  const originalWarn = console.warn;
  const warnings: string[] = [];
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map(String).join(" "));
  };
  try {
    return { value: await fn(), warnings };
  } finally {
    console.warn = originalWarn;
  }
}

function createModules() {
  return {
    "/src/pages/_layout.tsx": {
      default: (props: any) => h("section", { id: "layout" }, props.children)
    },
    "/src/pages/index.tsx": {
      head: h("title", null, "typed jsx head"),
      default: () => h("main", null, "home")
    },
    "/src/pages/blog/[id].tsx": {
      default: (props: any) => h("main", null, `blog:${props.params.id}`)
    },
    "/src/pages/docs/[[section]].tsx": {
      default: (props: any) => h("main", null, `docs:${props.params.section || "(none)"}`)
    },
    "/src/pages/files/[...all].tsx": {
      default: (props: any) => h("main", null, `files:${props.params.all || ""}`)
    },
    "/src/pages/login.tsx": {
      default: () => h("main", null, "login")
    },
    "/src/pages/protected.tsx": {
      middleware: () => ({ redirect: "/login" }),
      default: () => h("main", null, "protected")
    },
    "/src/pages/load-error.tsx": {
      load: async () => {
        throw new Error("boom");
      },
      default: () => h("main", null, "should-not-render")
    },
    "/src/pages/_error.tsx": {
      default: (props: any) => h("main", null, `error:${String(props.error)}`)
    },
    "/src/pages/404.tsx": {
      head: h("title", null, "test 404"),
      default: (props: any) => h("main", null, `404:${props.pathname}`)
    }
  };
}

function createSeededRandom(seed: number): () => number {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

function randomEncodedSegment(random: () => number): string {
  const alphabet = [
    "alpha",
    "beta",
    "42",
    "%2F",
    "%5C",
    "%2e",
    "%2E%2E",
    "%3Cscript%3E",
    "%25",
    "%E0%A4%A"
  ];
  const count = 1 + Math.floor(random() * 4);
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    parts.push(alphabet[Math.floor(random() * alphabet.length)]);
  }
  return parts.join("-");
}

test("routing: dynamic, optional, and catch-all params resolve correctly", () => {
  const runtime = createPagesRuntime(createModules());

  const blog = runtime.resolvePath("/blog/42");
  assert.equal(blog.params.id, "42");

  const docs = runtime.resolvePath("/docs");
  assert.equal(docs.route?.path, "/docs/:?section");
  assert.equal(docs.params.section, undefined);

  const files = runtime.resolvePath("/files/a/b");
  assert.equal(files.route?.path, "/files/*all");
  assert.equal(files.params.all, "a/b");
  assert.equal(files.params["*"], "a/b");
});

test("routing: root dynamic routes can signal the reserved 404 page", async () => {
  const modules = {
    "/src/pages/about.tsx": {
      default: () => h("main", null, "static about")
    },
    "/src/pages/[slug].tsx": {
      load: ({ params }: any) => {
        if (params.slug === "missing") notFound();
        return { title: `Page ${params.slug}` };
      },
      default: ({ data }: any) => h("main", null, data.title)
    },
    "/src/pages/404.tsx": {
      head: ({ pathname }: any) => ({
        title: `Not found: ${pathname}`,
        unsafeHeadHtml: '<meta name="robots" content="noindex">',
      }),
      default: ({ pathname }: any) => h("main", null, `custom 404:${pathname}`)
    },
    "/src/pages/_error.tsx": {
      default: () => h("main", null, "loader error")
    }
  };

  const runtime = createPagesRuntime(modules);
  assert.equal(runtime.resolvePath("/about").route?.path, "/about");
  assert.equal(runtime.resolvePath("/anything").route?.path, "/:slug");

  const known = await renderPagesResponseAsync(modules, "/anything");
  assert.equal(known.status, 200);
  assert.match(known.html, /Page anything/);

  const resolvedMissing = await runtime.resolvePathAsync("/missing");
  assert.equal(resolvedMissing.route, null);
  assert.equal(resolvedMissing.status, 404);
  assert.equal(resolvedMissing.head.status, 404);
  assert.equal(resolvedMissing.head.title, "Not found: /missing");

  const missing = await renderPagesResponseAsync(modules, "/missing");
  assert.equal(missing.status, 404);
  assert.match(missing.html, /custom 404:\/missing/);
  assert.match(missing.html, /<title>Not found: \/missing<\/title>/);
  assert.match(missing.html, /<meta name="robots" content="noindex">/);
  assert.doesNotMatch(missing.html, /loader error/);
});

test("routing: catch-all suffixes, positional specificity, and trailing slashes are respected", () => {
  const runtime = createPagesRuntime({
    "/src/pages/download/[...path]/edit.tsx": {
      default: () => h("main", null, "download edit")
    },
    "/src/pages/[id]/settings.tsx": {
      default: () => h("main", null, "generic settings")
    },
    "/src/pages/users/[id].tsx": {
      default: () => h("main", null, "user")
    },
    "/src/pages/about.tsx": {
      default: () => h("main", null, "about")
    }
  });

  const suffix = runtime.resolvePath("/download/a/b/edit");
  assert.equal(suffix.route?.path, "/download/*path/edit");
  assert.equal(suffix.params.path, "a/b");
  assert.equal(runtime.resolvePath("/download/a/b").route, null);

  const specific = runtime.resolvePath("/users/settings");
  assert.equal(specific.route?.path, "/users/:id");
  assert.equal(specific.params.id, "settings");

  assert.equal(runtime.resolvePath("/about/").route?.path, "/about");
});

test("routing: layout heads receive data from their own loader layer", async () => {
  const response = await renderPagesResponseAsync({
    "/src/pages/_root.tsx": {
      load: () => ({ name: "root" }),
      default: ({ children }: any) => h("div", null, children)
    },
    "/src/pages/dashboard/_layout.tsx": {
      load: () => ({ name: "dashboard" }),
      head: ({ data }: any) => ({ title: data.name }),
      default: ({ children }: any) => h("section", null, children)
    },
    "/src/pages/dashboard/index.tsx": {
      default: () => h("main", null, "dashboard")
    }
  }, "/dashboard");

  assert.match(response.html, /<title>dashboard<\/title>/);
  assert.doesNotMatch(response.html, /<title>root<\/title>/);
});

test("routing: root wraps pages outside optional layouts", async () => {
  const modules = {
    "/src/pages/_root.tsx": {
      default: (props: any) => h("div", { id: "root" }, props.children)
    },
    "/src/pages/_layout.tsx": {
      default: (props: any) => h("section", { id: "layout" }, props.children)
    },
    "/src/pages/index.tsx": {
      default: () => h("main", null, "home")
    }
  };

  const response = await renderPagesResponseAsync(modules, "/");
  assert.match(response.html, /id="root"/);
  assert.match(response.html, /id="layout"/);
  assert.match(response.html, /<main>home<\/main>/);
  assert.ok(response.html.indexOf('id="root"') < response.html.indexOf('id="layout"'));
});

test("routing: page layout false skips layouts but keeps root", async () => {
  const modules = {
    "/src/pages/_root.tsx": {
      default: (props: any) => h("div", { id: "root" }, props.children)
    },
    "/src/pages/_layout.tsx": {
      default: (props: any) => h("section", { id: "layout" }, props.children)
    },
    "/src/pages/plain.tsx": {
      layout: false,
      default: () => h("main", null, "plain")
    }
  };

  const runtime = createPagesRuntime(modules);
  const resolved = runtime.resolvePath("/plain");
  assert.deepEqual(resolved.route?.layoutLayers.map((layer) => layer.kind), ["root"]);

  const response = await renderPagesResponseAsync(modules, "/plain");
  assert.match(response.html, /id="root"/);
  assert.doesNotMatch(response.html, /id="layout"/);
  assert.match(response.html, /<main>plain<\/main>/);
});

test("ssr: production route assets follow layout order, deduplicate, and precede the client script", async () => {
  const modules = {
    "/src/pages/_layout.tsx": {
      default: (props: any) => h("section", null, props.children)
    },
    "/src/pages/docs/_layout.tsx": {
      default: (props: any) => h("article", null, props.children)
    },
    "/src/pages/docs/index.tsx": {
      head: { unsafeHeadHtml: '<meta name="route-head" content="docs">' },
      default: () => h("main", null, "docs")
    }
  };
  const options = {
    document: { unsafeHeadHtml: '<link rel="stylesheet" href="/assets/shared.css">' },
    __tavoProductionAssets: {
      clientEntryScript: "assets/entry.js",
      moduleCss: {
        "/src/pages/_layout.tsx": ["assets/common.css", "assets/root.css"],
        "/src/pages/docs/_layout.tsx": ["assets/common.css", "assets/docs-layout.css"],
        "/src/pages/docs/index.tsx": ["assets/common.css", "assets/docs-page.css"]
      }
    }
  } as any;

  const response = await renderPagesResponseAsync(modules, "/docs", options);
  const head = response.html.slice(response.html.indexOf("<head>"), response.html.indexOf("</head>"));
  const expected = [
    "/assets/shared.css",
    "/assets/common.css",
    "/assets/root.css",
    "/assets/docs-layout.css",
    "/assets/docs-page.css",
    "/assets/entry.js",
    "route-head"
  ];
  for (let index = 1; index < expected.length; index += 1) {
    assert.ok(head.indexOf(expected[index - 1]) < head.indexOf(expected[index]), head);
  }
  assert.equal(head.match(/\/assets\/common\.css/g)?.length, 1);

  const unrelated = await renderPagesResponseAsync({
    ...modules,
    "/src/pages/other.tsx": { default: () => h("main", null, "other") }
  }, "/other", options);
  assert.doesNotMatch(unrelated.html, /docs-layout\.css|docs-page\.css/);
});

test("routing: malformed encoded params do not escape route resolution", async () => {
  const runtime = createPagesRuntime(createModules());

  const resolved = runtime.resolvePath("/blog/%E0%A4%A");
  assert.equal(resolved.route, null);

  const response = await renderPagesResponseAsync(createModules(), "/blog/%E0%A4%A");
  assert.equal(response.status, 404);
  assert.match(response.html, /404:\/blog\/%E0%A4%A/);
});

test("routing: encoded separators stay inside the matched dynamic segment", async () => {
  const runtime = createPagesRuntime(createModules());

  const encodedSlash = runtime.resolvePath("/blog/a%2Fb");
  assert.equal(encodedSlash.route?.path, "/blog/:id");
  assert.equal(encodedSlash.params.id, "a/b");

  const encodedTraversal = await renderPagesResponseAsync(createModules(), "/blog/%2e%2e");
  assert.equal(encodedTraversal.status, 200);
  assert.match(encodedTraversal.html, /blog:\.\./);
  assert.doesNotMatch(encodedTraversal.html, /404:/);
});

test("routing: encoded catch-all traversal-like values are treated as params only", async () => {
  const response = await renderPagesResponseAsync(createModules(), "/files/%2e%2e/secret");

  assert.equal(response.status, 200);
  assert.match(response.html, /files:%2e%2e\/secret/);
  assert.doesNotMatch(response.html, /404:/);
});

test("routing: deterministic fuzzing keeps encoded dynamic params data-only", async () => {
  const runtime = createPagesRuntime(createModules());
  const random = createSeededRandom(0x5eed);

  for (let index = 0; index < 80; index += 1) {
    const segment = randomEncodedSegment(random);
    const pathname = `/blog/${segment}`;
    const resolved = runtime.resolvePath(pathname);
    const response = await renderPagesResponseAsync(createModules(), pathname);

    if (segment.includes("%E0%A4%A")) {
      assert.equal(resolved.route, null, pathname);
      assert.equal(response.status, 404, pathname);
      continue;
    }

    assert.equal(resolved.route?.path, "/blog/:id", pathname);
    assert.equal(response.status, 200, pathname);
    assert.doesNotMatch(response.html, /<\/script><script/i, pathname);
    assert.doesNotMatch(response.html, /<main>blog:[^<]*<script/i, pathname);
  }
});

test("routing: middleware redirect resolves on async path", async () => {
  const runtime = createPagesRuntime(createModules());
  const result = await runtime.resolvePathAsync("/protected");
  assert.equal(result.redirect, "/login");
  assert.equal(result.status, 302);
});

test("routing: load errors render _error page", async () => {
  const runtime = createPagesRuntime(createModules());
  const result = await runtime.resolvePathAsync("/load-error");
  const html = renderToString(result.node);
  assert.equal(result.status, 500);
  assert.match(html, /error:Error: boom/);
});

test("routing: pending and error page exports render as Tavo.js components", async () => {
  let releasePageLoad!: () => void;
  let publishPending!: (value: any) => void;
  const pendingPublished = new Promise<any>((resolve) => {
    publishPending = resolve;
  });
  const Pending = createTavo({
    view: ({ props }) =>
      h("main", { "data-pending": "true" }, `pending:${String(props.pathname)}`)
  });
  const RouteError = createTavo({
    view: ({ props }) =>
      h("main", { "data-route-error": "true" }, `local:${String(props.error)}`)
  });
  const lazyBroken = Object.assign(async () => ({
    error: RouteError,
    load: async () => {
      throw new Error("route failed");
    },
    default: () => h("main", null, "should-not-render")
  }), { __tavo_loader__: true as const });
  const runtime = createPagesRuntime({
    "/src/pages/_layout.tsx": {
      load: () => ({ shell: "ready" }),
      default: ({ data, children }: any) =>
        h("section", { "data-shell": data?.shell }, children)
    },
    "/src/pages/slow.tsx": {
      pending: Pending,
      load: () => new Promise<{ message: string }>((resolve) => {
        releasePageLoad = () => resolve({ message: "complete" });
      }),
      default: ({ data }: any) => h("main", null, data.message)
    },
    "/src/pages/broken.tsx": lazyBroken,
    "/src/pages/_error.tsx": {
      default: ({ error }: any) => h("main", null, `global:${String(error)}`)
    }
  });

  const resolving = runtime.resolvePathAsync("/slow", undefined, undefined, {
    onPending: publishPending
  });
  const pending = await pendingPublished;
  const pendingHtml = renderToString(pending.node);
  assert.equal(pending.pathname, "/slow");
  assert.match(pendingHtml, /data-shell="ready"/);
  assert.match(pendingHtml, /data-pending="true"/);
  assert.match(pendingHtml, /pending:\/slow/);

  releasePageLoad();
  const resolved = await resolving;
  assert.match(renderToString(resolved.node), /complete/);

  const failed = await runtime.resolvePathAsync("/broken");
  const failedHtml = renderToString(failed.node);
  assert.equal(failed.status, 500);
  assert.match(failedHtml, /data-route-error="true"/);
  assert.match(failedHtml, /local:Error: route failed/);
  assert.doesNotMatch(failedHtml, /global:/);
});

test("ssr: redirects are serialized as meta refresh", async () => {
  const html = await renderPagesDocumentAsync(createModules(), "/protected");
  assert.match(html, /http-equiv="refresh"/);
  assert.match(html, /url=\/login/);
});

test("ssr: response metadata exposes status and redirect headers", async () => {
  const redirect = await renderPagesResponseAsync(createModules(), "/protected");
  assert.equal(redirect.status, 302);
  assert.equal(redirect.headers.Location, "/login");

  const notFound = await renderPagesResponseAsync(createModules(), "/missing");
  assert.equal(notFound.status, 404);
  assert.match(notFound.html, /404:\/missing/);
  assert.match(notFound.html, /<title>test 404<\/title>/);
});

test("ssr: page head can be exported as JSX", async () => {
  const html = await renderPagesDocumentAsync(createModules(), "/", {
    document: {
      title: "fallback title"
    }
  });

  assert.match(html, /<title>typed jsx head<\/title>/);
  assert.doesNotMatch(html, /<title>fallback title<\/title>/);
  assert.equal((html.match(/<title>/g) ?? []).length, 1);
});

test("ssr: non-static concurrent requests do not share loader data", async () => {
  let releaseFirstLoad: (() => void) | null = null;
  let firstLoadStarted: (() => void) | null = null;
  const firstLoadStartedPromise = new Promise<void>((resolve) => {
    firstLoadStarted = resolve;
  });
  const firstLoadReleasePromise = new Promise<void>((resolve) => {
    releaseFirstLoad = resolve;
  });
  let loadCalls = 0;

  const handler = createFetchRequestHandler({
    modules: {
      "/src/pages/account.tsx": {
        load: async ({ request }) => {
          loadCalls += 1;
          const cookie = request instanceof Request ? request.headers.get("cookie") ?? "" : "";
          const session = cookie.includes("session=bob") ? "bob" : "alice";
          if (session === "alice") {
            firstLoadStarted?.();
            await firstLoadReleasePromise;
          }
          return { session };
        },
        default: (props: any) => h("main", null, `session:${props.data.session}`)
      }
    }
  });

  const alice = handler(new Request("http://example.com/account", {
    headers: { cookie: "session=alice" }
  }));
  await firstLoadStartedPromise;
  const bob = handler(new Request("http://example.com/account", {
    headers: { cookie: "session=bob" }
  }));

  releaseFirstLoad?.();
  const [aliceResponse, bobResponse] = await Promise.all([alice, bob]);

  assert.match(await aliceResponse.text(), /session:alice/);
  assert.match(await bobResponse.text(), /session:bob/);
  assert.equal(loadCalls, 2);
});

test("ssr: static pages are cached and revalidated after the configured interval", async () => {
  let renders = 0;
  const handler = createFetchRequestHandler({
    modules: {
      "/src/pages/static.tsx": {
        revalidate: 2,
        load: async () => {
          renders += 1;
          return {
            renderId: renders
          };
        },
        default: (props: any) => h("main", null, `render:${props.data.renderId}`)
      }
    }
  });

  const originalNow = Date.now;
  let now = 1_000;
  Date.now = () => now;

  try {
    const first = await handler(new Request("http://example.com/static"));
    const firstHtml = await first.text();
    assert.match(firstHtml, /render:1/);
    assert.equal(first.headers.get("cache-control"), "public, max-age=0, s-maxage=2");

    const second = await handler(new Request("http://example.com/static"));
    const secondHtml = await second.text();
    assert.match(secondHtml, /render:1/);

    now += 1_500;
    const third = await handler(new Request("http://example.com/static"));
    const thirdHtml = await third.text();
    assert.match(thirdHtml, /render:1/);

    now += 600;
    const fourth = await handler(new Request("http://example.com/static"));
    const fourthHtml = await fourth.text();
    assert.match(fourthHtml, /render:2/);
  } finally {
    Date.now = originalNow;
  }
});

test("ssr: static pages can use an external cache adapter", async () => {
  let renders = 0;
  const staticCache = createMemoryStaticCache();
  const handler = createFetchRequestHandler({
    staticCache,
    modules: {
      "/src/pages/index.tsx": {
        revalidate: 30,
        load: async () => ({ renderId: ++renders }),
        default: (props: any) => h("main", null, `cached:${props.data.renderId}`)
      }
    }
  });

  const first = await handler(new Request("http://example.com/"));
  const second = await handler(new Request("http://example.com/"));

  assert.match(await first.text(), /cached:1/);
  assert.match(await second.text(), /cached:1/);
  assert.equal(renders, 1);
  assert.equal(staticCache.size(), 1);
});

test("ssr: authenticated static renders never populate the shared public cache", async () => {
  let loadCalls = 0;
  const handler = createFetchRequestHandler({
    modules: {
      "/src/pages/account.tsx": {
        static: true,
        load: async ({ request }: any) => {
          loadCalls += 1;
          return {
            viewer:
              request.headers.get("cookie") ??
              request.headers.get("authorization") ??
              "public"
          };
        },
        default: (props: any) => h("main", null, `viewer:${props.data.viewer}`)
      }
    }
  });

  const alice = await handler(new Request("https://example.com/account", {
    headers: { cookie: "session=alice" }
  }));
  const firstPublic = await handler(new Request("https://example.com/account"));
  const secondPublic = await handler(new Request("https://example.com/account"));
  const bob = await handler(new Request("https://example.com/account", {
    headers: { authorization: "Bearer bob" }
  }));
  const finalPublic = await handler(new Request("https://example.com/account"));

  assert.match(await alice.text(), /viewer:session=alice/);
  assert.match(await firstPublic.text(), /viewer:public/);
  assert.match(await secondPublic.text(), /viewer:public/);
  assert.match(await bob.text(), /viewer:Bearer bob/);
  assert.match(await finalPublic.text(), /viewer:public/);
  assert.equal(loadCalls, 3);
});

test("ssr: private renders do not evict an existing public cache entry", async () => {
  let loadCalls = 0;
  let deleteCalls = 0;
  const memory = createMemoryStaticCache();
  const handler = createFetchRequestHandler({
    staticCache: {
      get: (key) => memory.get(key),
      set: (key, entry) => memory.set(key, entry),
      delete(key) {
        deleteCalls += 1;
        memory.delete(key);
      }
    },
    modules: {
      "/src/pages/account.tsx": {
        static: true,
        load: async ({ request }: any) => ({
          renderId: ++loadCalls,
          viewer: request.headers.get("cookie") ?? "public"
        }),
        default: (props: any) => h("main", null, `${props.data.viewer}:${props.data.renderId}`)
      }
    }
  });

  const firstPublic = await handler(new Request("https://example.com/account"));
  const privateResponse = await handler(new Request("https://example.com/account", {
    headers: { cookie: "session=alice" }
  }));
  const secondPublic = await handler(new Request("https://example.com/account"));

  assert.match(await firstPublic.text(), /public:1/);
  assert.match(await privateResponse.text(), /session=alice:2/);
  assert.match(await secondPublic.text(), /public:1/);
  assert.equal(loadCalls, 2);
  assert.equal(deleteCalls, 0);
});

test("ssr: static cache entries are isolated by request origin", async () => {
  let loadCalls = 0;
  const handler = createFetchRequestHandler({
    modules: {
      "/src/pages/index.tsx": {
        static: true,
        load: async ({ url }: any) => ({ host: url.host, renderId: ++loadCalls }),
        default: (props: any) => h("main", null, `${props.data.host}:${props.data.renderId}`)
      }
    }
  });

  const tenantA = await handler(new Request("https://tenant-a.example/"));
  const tenantB = await handler(new Request("https://tenant-b.example/"));
  const tenantAAgain = await handler(new Request("https://tenant-a.example/"));

  assert.match(await tenantA.text(), /tenant-a\.example:1/);
  assert.match(await tenantB.text(), /tenant-b\.example:2/);
  assert.match(await tenantAAgain.text(), /tenant-a\.example:1/);
  assert.equal(loadCalls, 2);
});

test("ssr: structured vary keys cannot collide through header delimiters", async () => {
  let loadCalls = 0;
  const handler = createFetchRequestHandler({
    modules: {
      "/src/pages/index.tsx": {
        static: true,
        vary: ["x-tenant", "x-role"],
        load: async ({ headers }: any) => ({
          renderId: ++loadCalls,
          tenant: headers.get("x-tenant"),
          role: headers.get("x-role")
        }),
        default: (props: any) => h(
          "main",
          null,
          `${props.data.tenant}|${props.data.role}|${props.data.renderId}`
        )
      }
    }
  });

  const first = await handler(new Request("https://example.com/", {
    headers: {
      "x-tenant": "alpha::x-role=admin",
      "x-role": "guest"
    }
  }));
  const second = await handler(new Request("https://example.com/", {
    headers: {
      "x-tenant": "alpha",
      "x-role": "admin::x-role=guest"
    }
  }));

  assert.match(await first.text(), /alpha::x-role=admin\|guest\|1/);
  assert.match(await second.text(), /alpha\|admin::x-role=guest\|2/);
  assert.equal(first.headers.get("vary"), "X-Tenant, X-Role");
  assert.equal(loadCalls, 2);
});

test("ssr: default memory cache remains bounded", async () => {
  const cache = createMemoryStaticCache({ maxEntries: 2 });
  const entry = {
    response: { html: "", status: 200, headers: {} },
    expiresAt: null,
    tags: []
  } as any;

  await cache.set("one", entry);
  await cache.set("two", entry);
  await cache.set("three", entry);

  assert.equal(await cache.get("one"), null);
  assert.equal(await cache.get("two"), entry);
  assert.equal(await cache.get("three"), entry);
  assert.equal(cache.size(), 2);
});

test("ssr: route cache tags invalidate page data and rendered responses together", async () => {
  let loadCalls = 0;
  const handler = createFetchRequestHandler({
    modules: {
      "/src/pages/posts/[id].tsx": {
        static: true,
        cacheTags: ({ params }) => ["posts", `post:${params.id}`],
        load: async ({ params }) => ({ id: params.id, version: ++loadCalls }),
        default: (props: any) => h("main", null, `${props.data.id}:${props.data.version}`)
      }
    }
  });

  const first = await handler(new Request("https://example.com/posts/one"));
  const cached = await handler(new Request("https://example.com/posts/one"));
  assert.match(await first.text(), /one:1/);
  assert.match(await cached.text(), /one:1/);

  const invalidated = await handler.invalidateCache("post:one");
  const refreshed = await handler(new Request("https://example.com/posts/one"));

  assert.ok(invalidated >= 2);
  assert.match(await refreshed.text(), /one:2/);
  assert.equal(loadCalls, 2);
});

test("ssr: stream response renders html with response metadata", async () => {
  const response = await renderPagesStreamResponseAsync(createModules(), "/");
  const html = await new Response(response.stream).text();

  assert.equal(response.status, 200);
  assert.equal(response.headers["Content-Type"], "text/html; charset=utf-8");
  assert.match(html, /typed jsx head/);
  assert.match(html, /<main>home<\/main>/);
});

test("ssr: async response helpers initialize lazy plugin phases", async () => {
  const asyncPlugin = definePlugin({
    id: "@acme/async-ssr",
    version: "1.0.0",
    apiVersion: TAVO_PLUGIN_API_VERSION,
    manifest: {
      head: [
        {
          id: "marker",
          key: "async-ssr:marker",
          cardinality: "singleton"
        }
      ]
    },
    server: async () =>
      definePluginPhase({
        head: {
          marker: h("meta", {
            name: "async-plugin",
            content: "ready"
          })
        }
      })
  });
  const options = { plugins: [asyncPlugin] };

  const response = await renderPagesResponseAsync(createModules(), "/", options);
  const streamed = await renderPagesStreamResponseAsync(createModules(), "/", options);
  const streamedHtml = await new Response(streamed.stream).text();

  assert.match(response.html, /name="async-plugin" content="ready"/);
  assert.match(streamedHtml, /name="async-plugin" content="ready"/);
});

test("ssr: stream response progressively resolves deferred boundaries", async () => {
  let resolveValue: ((value: string) => void) | null = null;
  const delayed = new Promise<string>((resolve) => {
    resolveValue = resolve;
  });

  const response = await renderPagesStreamResponseAsync(
    {
      "/src/pages/index.tsx": {
        default: () =>
          h(
            "main",
            null,
            h(
              Deferred,
              {
                id: "stream-demo",
                value: delayed,
                fallback: h("p", null, "loading deferred section")
              },
              (value: string) => h("section", null, value)
            )
          )
      }
    },
    "/"
  );

  const reader = response.stream.getReader();
  const decoder = new TextDecoder();

  let earlyHtml = "";
  while (!earlyHtml.includes("loading deferred section")) {
    const first = await reader.read();
    if (first.done) {
      break;
    }
    earlyHtml += decoder.decode(first.value);
  }
  assert.match(earlyHtml, /loading deferred section/);
  assert.doesNotMatch(earlyHtml, /streamed payload ready/);

  resolveValue?.("streamed payload ready");

  let laterHtml = "";
  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    laterHtml += decoder.decode(next.value);
  }

  assert.match(laterHtml, /__TAVO_DEFERRED__/);
  assert.match(laterHtml, /streamed payload ready/);
});

test("ssr: shared deferred values coordinate one async unit across multiple boundaries", async () => {
  let resolveValue: ((value: string) => void) | null = null;
  const shared = createDeferredValue(new Promise<string>((resolve) => {
    resolveValue = resolve;
  }), { id: "shared-demo" });

  const response = await renderPagesStreamResponseAsync(
    {
      "/src/pages/index.tsx": {
        default: () =>
          h("main", null, [
            h(Deferred, {
              value: shared,
              fallback: h("p", null, "shared fallback a")
            }, (value: string) => h("section", null, `A:${value}`)),
            h(Deferred, {
              value: shared,
              fallback: h("p", null, "shared fallback b")
            }, (value: string) => h("section", null, `B:${value}`))
          ])
      }
    },
    "/"
  );

  const reader = response.stream.getReader();
  const decoder = new TextDecoder();
  let html = "";
  while (!html.includes("shared fallback b")) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    html += decoder.decode(next.value);
  }

  resolveValue?.("coordinated");

  while (true) {
    const next = await reader.read();
    if (next.done) {
      break;
    }
    html += decoder.decode(next.value);
  }

  assert.match(html, /shared fallback a/);
  assert.match(html, /shared fallback b/);
  assert.equal((html.match(/var updates=/g) ?? []).length, 1);
  assert.match(html, /A:coordinated/);
  assert.match(html, /B:coordinated/);
});

test("ssr: deferred boundaries can time out into timeout fallback content", async () => {
  const delayed = new Promise<string>((resolve) => {
    setTimeout(() => resolve("late value"), 50);
  });

  const response = await renderPagesStreamResponseAsync(
    {
      "/src/pages/index.tsx": {
        default: () =>
          h(
            "main",
            null,
            h(
              Deferred,
              {
                id: "timeout-demo",
                value: createDeferredValue(delayed, {
                  timeoutMs: 10,
                  timeoutFallback: h("section", null, "timed out fallback")
                }),
                fallback: h("p", null, "loading slow deferred")
              },
              (value: string) => h("section", null, value)
            )
          )
      }
    },
    "/"
  );

  const html = await new Response(response.stream).text();
  assert.match(html, /loading slow deferred/);
  assert.match(html, /timed out fallback/);
  assert.match(html, /timed out after 10ms/);
});

test("ssr: load allows awaited timer work without detached timer warnings", async () => {
  const { value: response, warnings } = await captureWarnings(() =>
    renderPagesResponseAsync(
      {
        "/src/pages/index.tsx": {
          load: async () => {
            await new Promise((resolve) => setTimeout(resolve, 0));
            return { message: "loaded" };
          },
          default: (props: any) => h("main", null, props.data.message)
        }
      },
      "/"
    )
  );

  assert.match(response.html, /<main>loaded<\/main>/);
  assert.deepEqual(warnings, []);
});

test("ssr: load warns and cleans up detached timers", async () => {
  const events: string[] = [];
  const { value: response, warnings } = await captureWarnings(() =>
    renderPagesResponseAsync(
      {
        "/src/pages/index.tsx": {
          load: () => {
            setTimeout(() => events.push("timeout"), 20);
            setInterval(() => events.push("interval"), 5);
            return { message: "loaded" };
          },
          default: (props: any) => h("main", null, props.data.message)
        }
      },
      "/"
    )
  );

  assert.match(response.html, /<main>loaded<\/main>/);
  assert.equal(warnings.length, 2);
  assert.match(warnings.join("\n"), /setTimeout was left active after load\(\) for route "\/" on "\/"/);
  assert.match(warnings.join("\n"), /setInterval was left active after load\(\) for route "\/" on "\/"/);

  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.deepEqual(events, []);
});
