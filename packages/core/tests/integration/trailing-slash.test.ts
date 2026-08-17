import test from "node:test";
import assert from "node:assert/strict";
import { h } from "../../src/index.tsx";
import { createPagesRuntimeAsync, renderPagesResponseAsync } from "../../src/framework/index.ts";
import {
  TAVO_PLUGIN_API_VERSION,
  definePlugin,
  definePluginPhase,
} from "../../src/plugins/index.ts";
import { createFetchRequestHandler } from "../../src/ssr/handlers.ts";
import { canonicalizeTrailingSlash, createRouter } from "../../src/router/index.ts";
import { Link } from "../../src/router/index.ts";
import { createI18n } from "../../src/i18n/index.ts";

const page = (label: string) => ({ default: () => h("main", null, label) });

test("URL policy preserves root, query strings, fragments, and absolute URL authorities", () => {
  assert.equal(canonicalizeTrailingSlash("/", "always"), "/");
  assert.equal(canonicalizeTrailingSlash("/docs?tab=api#install", "always"), "/docs/?tab=api#install");
  assert.equal(canonicalizeTrailingSlash("/docs/?tab=api#install", "never"), "/docs?tab=api#install");
  assert.equal(canonicalizeTrailingSlash("https://example.com/docs?q=1#top", "always"), "https://example.com/docs/?q=1#top");
  assert.equal(canonicalizeTrailingSlash("/docs/", "preserve"), "/docs/");
});

test("router canonicalizes only manifest-known static and dynamic routes", () => {
  const router = createRouter([
    { path: "/", component: () => null },
    { path: "/docs", component: () => null },
    { path: "/blog/:id", component: () => null },
    { path: "/legal.txt", component: () => null },
  ], { routing: { trailingSlash: "always" } });

  assert.equal(router.canonicalize("/docs?q=1#top"), "/docs/?q=1#top");
  assert.equal(router.canonicalize("/blog/hello?q=1"), "/blog/hello/?q=1");
  assert.equal(router.canonicalize("/legal.txt"), "/legal.txt/");
  assert.equal(router.canonicalize("/assets/app.js"), "/assets/app.js");
  assert.equal(router.canonicalize("/api/users"), "/api/users");
  assert.equal(router.canonicalize("/"), "/");
});

test("SSR router links emit canonical hrefs with query strings and fragments", async () => {
  const response = await renderPagesResponseAsync({
    "/src/pages/index.tsx": { default: () => h(Link, { to: "/about?q=1#team" }, "About") },
    "/src/pages/about.tsx": page("about"),
  }, "/", { routing: { trailingSlash: "always" } });
  assert.match(response.html, /href="\/about\/\?q=1#team"/);
});

test("SSR router links forward anchor attributes and respect explicit aria-current", async () => {
  const response = await renderPagesResponseAsync({
    "/src/pages/index.tsx": {
      default: () => h(Link, {
        to: "/about?q=1#team",
        target: "_blank",
        rel: "noopener",
        download: "about.html",
        title: "About us",
        "aria-label": "About the team",
        "aria-current": "step",
        "data-track": "nav-about",
      }, "About"),
    },
    "/src/pages/about.tsx": page("about"),
  }, "/", { routing: { trailingSlash: "always" } });

  assert.match(response.html, /href="\/about\/\?q=1#team"/);
  assert.match(response.html, /target="_blank"/);
  assert.match(response.html, /rel="noopener"/);
  assert.match(response.html, /download="about\.html"/);
  assert.match(response.html, /title="About us"/);
  assert.match(response.html, /aria-label="About the team"/);
  assert.match(response.html, /aria-current="step"/);
  assert.match(response.html, /data-track="nav-about"/);
});

test("SSR router links apply always, never, and preserve policies", async () => {
  for (const [policy, to, expected] of [
    ["always", "/about?q=1#team", "/about/?q=1#team"],
    ["never", "/about/?q=1#team", "/about?q=1#team"],
    ["preserve", "/about/?q=1#team", "/about/?q=1#team"],
  ] as const) {
    const response = await renderPagesResponseAsync({
      "/src/pages/index.tsx": { default: () => h(Link, { to }, "About") },
      "/src/pages/about.tsx": page("about"),
    }, "/", { routing: { trailingSlash: policy } });
    assert.match(response.html, new RegExp(`href="${expected.replace(/[/?#.]/g, "\\$&")}"`));
  }
});

test("SSR permanently redirects noncanonical page requests before loaders and actions", async () => {
  let loads = 0;
  let actions = 0;
  const modules = {
    "/src/pages/about.tsx": {
      load: () => { loads += 1; return null; },
      action: () => { actions += 1; return { body: "ok" }; },
      default: () => h("main", null, "about"),
    },
    "/src/pages/legal.txt.tsx": page("legal"),
    "/src/pages/404.tsx": page("missing"),
  };
  const handler = createFetchRequestHandler({ modules, routing: { trailingSlash: "never" } });

  const getResponse = await handler(new Request("https://example.com/about/?q=1"));
  assert.equal(getResponse.status, 308);
  assert.equal(getResponse.headers.get("Location"), "/about?q=1");
  assert.equal(loads, 0);

  const postResponse = await handler(new Request("https://example.com/about/", { method: "POST" }));
  assert.equal(postResponse.status, 308);
  assert.equal(postResponse.headers.get("Location"), "/about");
  assert.equal(actions, 0);

  const dottedPage = await handler(new Request("https://example.com/legal.txt/"));
  assert.equal(dottedPage.status, 308);
  assert.equal(dottedPage.headers.get("Location"), "/legal.txt");

  const asset = await handler(new Request("https://example.com/assets/app.js/"));
  assert.notEqual(asset.status, 308);
});

test("plugin endpoints bypass page canonicalization and plugin contexts receive the resolved policy", async () => {
  let contextPolicy = "";
  const api = definePlugin({
    id: "@acme/api",
    version: "1.0.0",
    apiVersion: TAVO_PLUGIN_API_VERSION,
    manifest: {
      exposure: [{ target: "server", from: "/", to: "/api", reason: "Public test endpoint." }],
      endpoints: [{ id: "data", methods: ["GET"], match: { kind: "exact", path: "/data" } }],
    },
    server: () => definePluginPhase({
      endpoints: { data: () => new Response("api") },
      setup(context) { contextPolicy = context.urlPolicy.trailingSlash; },
    }),
  });
  const handler = createFetchRequestHandler({
    modules: { "/src/pages/about.tsx": page("about") },
    plugins: [api],
    routing: { trailingSlash: "always" },
  });
  const response = await handler(new Request("https://example.com/api/data"));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "api");
  assert.equal(contextPolicy, "always");
});

test("localized known routes use the same canonical policy", async () => {
  const i18n = createI18n({
    defaultLocale: "en",
    messages: { en: {}, es: {} },
    routing: { enabled: true, defaultLocalePrefix: "always" },
  });
  const runtime = await createPagesRuntimeAsync(
    { "/src/pages/about.tsx": page("about") },
    { i18n, routing: { trailingSlash: "always" } },
  );
  assert.equal(runtime.router.canonicalize("/es/about?q=1#team"), "/es/about/?q=1#team");
  assert.equal(runtime.router.match("/es/about/").route?.path, "/about");
});

test("SSR router links preserve scheme and external targets before i18n localization", async () => {
  const i18n = createI18n({
    defaultLocale: "en",
    messages: { en: {}, es: {} },
    routing: { enabled: true, defaultLocalePrefix: "always" },
  });
  const response = await renderPagesResponseAsync({
    "/src/pages/index.tsx": {
      default: () => h("nav", null,
        h(Link, { to: "http://example.net/docs?q=1#top" }, "HTTP"),
        h(Link, { to: "https://github.com/tavojs?q=1#readme" }, "HTTPS"),
        h(Link, { to: "mailto:support@example.com?subject=Help#message" }, "Email"),
        h(Link, { to: "tel:+12025550123?ext=4#call" }, "Phone"),
        h(Link, { to: "webcal://calendar.example/events?q=1#next" }, "Other scheme"),
        h(Link, { to: "//example.com/path?q=1#top" }, "Protocol relative"),
        h(Link, { to: "/about?q=1#team" }, "About"),
      ),
    },
    "/src/pages/about.tsx": page("about"),
  }, "/es/", { i18n, routing: { trailingSlash: "always" } });

  assert.match(response.html, /href="http:\/\/example\.net\/docs\?q=1#top"/);
  assert.match(response.html, /href="https:\/\/github\.com\/tavojs\?q=1#readme"/);
  assert.match(response.html, /href="mailto:support@example\.com\?subject=Help#message"/);
  assert.match(response.html, /href="tel:\+12025550123\?ext=4#call"/);
  assert.match(response.html, /href="\/es\/about\/\?q=1#team"/);
  assert.doesNotMatch(response.html, /\/es\/(?:https?:|mailto:|tel:|webcal:|\/\/example\.com)/);
  // The URL security layer intentionally rejects schemes outside its allowlist and
  // protocol-relative hrefs; Link must pass them through without first localizing them.
  assert.doesNotMatch(response.html, /calendar\.example|href="\/\/example\.com/);
});
