import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createClientAssetPlan } from "../dist/cli/commands/build.mjs";
import { createPreviewServerSource, createSsrEntrySource } from "../dist/cli/build/templates.mjs";
import { assertNoSymlinkEscape, assertSafeFile } from "../dist/cli/commands/change/safety.mjs";

function previewHarness({ token = "", canonical = null } = {}) {
  let handler;
  let appHits = 0;
  const files = new Map([["/app/.tavo/build/client/static/index.html", Buffer.from("static page")]]);
  const context = {
    Buffer, URL, path, fileURLToPath,
    console: { log() {}, error() {} },
    process: { env: { TAVO_MONITOR_TOKEN: token }, pid: 1 },
    loadServerEnv() {},
    fs: {
      async stat(file) { return files.has(file) ? { isFile: () => true } : null; },
      async readFile(file) { return files.get(file); },
    },
    entry: {
      async getCanonicalPagePath() { return canonical; },
      async nodeHandler(req, res) {
        appHits += 1;
        res.writeHead(req.method === "POST" ? 201 : 405, {});
        res.end("handled by application");
      },
    },
    http: {
      createServer(callback) {
        handler = callback;
        return { on() {}, listen() {} };
      },
    },
  };
  const source = createPreviewServerSource()
    .replace(/^import .+;\n/gm, "")
    .replace('await import("./entry.mjs")', "entry")
    .replaceAll("import.meta.url", '"file:///app/.tavo/build/server/start.mjs"');
  vm.runInNewContext(`${source}\nglobalThis.state = monitorState;`, context);
  return {
    get appHits() { return appHits; },
    state: context.state,
    async request(url, method = "GET") {
      const response = {
        status: null, headers: {}, body: undefined, headersSent: false, writableEnded: false,
        writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
        end(body) { this.body = body; this.writableEnded = true; },
      };
      await handler({ url, method, headers: {} }, response);
      return response;
    },
  };
}

test("production preview returns 400 for malformed URLs and continues serving requests", async () => {
  const preview = previewHarness();
  const response = await preview.request("//[/");
  assert.equal(response.status, 400);
  assert.equal(response.body, "Bad Request");
  assert.equal((await preview.request("/static")).status, 200);
  assert.equal(preview.state.inflight, 0);
});

test("prerendered files do not intercept application actions or OPTIONS requests", async () => {
  const preview = previewHarness();
  assert.equal((await preview.request("/static", "POST")).status, 201);
  assert.equal((await preview.request("/static", "OPTIONS")).status, 405);
  assert.equal(preview.appHits, 2);
  assert.equal((await preview.request("/static", "GET")).status, 200);
  assert.equal((await preview.request("/static", "HEAD")).status, 200);
  assert.equal(preview.appHits, 2);
  assert.equal(preview.state.inflight, 0);
});

test("prerendered HTML redirects to its configured canonical page URL", async () => {
  const preview = previewHarness({ canonical: "/static/?q=1" });
  const response = await preview.request("/static?q=1");
  assert.equal(response.status, 308);
  assert.equal(response.headers.Location, "/static/?q=1");
  assert.equal(response.body, undefined);
  assert.equal(preview.state.inflight, 0);
});

test("production monitoring allocates no route entries when disabled and caps enabled routes", async () => {
  const disabled = previewHarness();
  await disabled.request("/first");
  assert.equal(disabled.state.routeHits.size, 0);
  const enabled = previewHarness({ token: "test-token" });
  for (let index = 0; index < 1100; index += 1) await enabled.request(`/path/${index}`);
  assert.equal(enabled.state.routeHits.size, 1024);
  assert.equal(enabled.state.routeHits.has("/path/0"), false);
  await enabled.request("/path/1099");
  assert.equal(enabled.state.routeHits.get("/path/1099"), 2);
});

test("production entry forwards the routing policy and canonicalizes known routes", async () => {
  const config = { routing: { trailingSlash: "always" } };
  const context = {
    config,
    createNodeRequestHandler: () => () => {},
    createPagesRuntimeAsync: async () => ({
      resolvePath: (pathname) => ({ route: pathname === "/static" ? {} : null }),
      router: { canonicalize: (pathname) => pathname.replace("/static?", "/static/?") },
    }),
  };
  const source = createSsrEntrySource({
    pagesDir: "src/routes",
    assetPlan: { sharedCss: [], clientEntryScript: "", moduleCss: {} },
  })
    .replace(/^import .+;\n/gm, "")
    .replace(/import\.meta\.glob\([^;]+\);/g, "{};")
    .replace("export default nodeHandler;", "")
    .replaceAll("export ", "");
  const result = await vm.runInNewContext(`(async () => {
    globalThis[Symbol.for("@tavojs/core/config/build-value")] = config;
    ${source}
    return { options, getCanonicalPagePath };
  })()`, context);
  assert.equal(result.options.routing, config.routing);
  assert.equal(await result.getCanonicalPagePath(new URL("https://example.com/static?q=1#top")), "/static/?q=1#top");
  assert.equal(await result.getCanonicalPagePath(new URL("https://example.com/assets/main.js")), null);
});

test("client entry CSS includes transitive imports once and excludes dynamic-only styles", () => {
  const plan = createClientAssetPlan({
    "index.html": { file: "assets/index.js", isEntry: true, imports: ["shared"], css: ["assets/main.css"] },
    shared: { file: "assets/shared.js", imports: ["base"], css: ["assets/shared.css"] },
    base: { file: "assets/base.js", imports: ["shared"], css: ["assets/base.css"] },
    "src/pages/index.tsx": {
      src: "src/pages/index.tsx", file: "assets/page.js", isDynamicEntry: true,
      imports: ["shared"], css: ["assets/page.css"],
    },
  });
  assert.deepEqual(plan.sharedCss, ["assets/base.css", "assets/shared.css", "assets/main.css"]);
  assert.deepEqual(plan.moduleCss["/src/pages/index.tsx"], ["assets/page.css"]);
});

test("change targets normalize dot segments and separators before checking protected directories", () => {
  for (const target of [
    "./.git/config", ".//.git/config", "./node_modules/file", ".\\node_modules\\file",
    "./.tavo//build/file", "./.tavo/./generated/file", ".git", "node_modules", ".tavo/build",
    "../secret", "src/../.git/config", "/tmp/outside", ".",
  ]) assert.throws(() => assertSafeFile("/project", target), /Unsafe change target/, target);
  assert.equal(assertSafeFile("/project", "./src/./page.tsx"), "/project/src/page.tsx");
  assert.equal(assertSafeFile("/project/", "src/page.tsx"), "/project/src/page.tsx");
});

test("change targets cannot reach protected directories through an internal symbolic link", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-change-review-"));
  try {
    await fs.mkdir(path.join(root, ".git"));
    await fs.mkdir(path.join(root, "src"));
    await fs.symlink(path.join(root, ".git"), path.join(root, "alias"), "dir");
    await fs.symlink(path.join(root, "src"), path.join(root, "source"), "dir");
    await assert.rejects(assertNoSymlinkEscape(root, path.join(root, "alias/config")), /Unsafe change target/);
    await assert.doesNotReject(assertNoSymlinkEscape(root, path.join(root, "source/new.ts")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
