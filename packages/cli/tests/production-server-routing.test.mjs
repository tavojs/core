import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createPreviewServerSource } from "../dist/cli/build/templates.mjs";

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve) => server.close(resolve));
  return address.port;
}

async function waitForServer(origin, child) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`production server exited with ${child.exitCode}`);
    try {
      const response = await fetch(`${origin}/robots.txt`);
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("timed out waiting for generated production server");
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => {
    child.once("exit", resolve);
    setTimeout(resolve, 1_000);
  });
}

async function createServerFixture(policy) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `tavo-production-routing-${policy}-`));
  const serverDir = path.join(root, ".tavo/build/server");
  const clientDir = path.join(root, ".tavo/build/client");
  const coreDir = path.join(root, "node_modules/@tavojs/core");
  await fs.mkdir(path.join(clientDir, "docs"), { recursive: true });
  await fs.mkdir(path.join(clientDir, "legal.txt"), { recursive: true });
  await fs.mkdir(path.join(clientDir, "assets"), { recursive: true });
  await fs.mkdir(coreDir, { recursive: true });
  await fs.mkdir(serverDir, { recursive: true });
  await fs.writeFile(path.join(clientDir, "docs/index.html"), "prerendered-docs");
  await fs.writeFile(path.join(clientDir, "legal.txt/index.html"), "prerendered-legal");
  await fs.writeFile(path.join(clientDir, "assets/app.js"), "asset-body");
  await fs.writeFile(path.join(coreDir, "package.json"), JSON.stringify({
    name: "@tavojs/core",
    type: "module",
    exports: { "./server": "./server.mjs" },
  }));
  await fs.writeFile(path.join(coreDir, "server.mjs"), "export function loadServerEnv() {}\n");
  await fs.writeFile(path.join(serverDir, "entry.mjs"), [
    'export async function nodeHandler(req, res) {',
    '  const url = new URL(req.url || "/", "http://localhost");',
    '  res.writeHead(200, { "Content-Type": "text/plain" });',
    '  res.end(`handler:${url.pathname}${url.search}`);',
    '}',
    '',
  ].join("\n"));
  await fs.writeFile(path.join(serverDir, "start.mjs"), createPreviewServerSource({
    routes: ["/:slug", "/docs", "/legal.txt", "/blog/:id", "/.well-known/:file"],
    endpoints: [
      { methods: ["GET"], kind: "exact", path: "/feed" },
      { methods: ["GET"], kind: "subtree", path: "/api" },
    ],
    trailingSlash: policy,
  }));
  return { root, serverDir };
}

async function request(origin, pathname) {
  return fetch(`${origin}${pathname}`, { redirect: "manual" });
}

for (const policy of ["always", "never", "preserve"]) {
  test(`generated production server applies trailingSlash=${policy} only to page routes`, async () => {
    const fixture = await createServerFixture(policy);
    const port = await availablePort();
    const origin = `http://127.0.0.1:${port}`;
    const child = spawn(process.execPath, [path.join(fixture.serverDir, "start.mjs")], {
      cwd: fixture.root,
      env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    try {
      await waitForServer(origin, child);

      const docsCanonical = policy === "always" ? "/docs/" : "/docs";
      const docsNoncanonical = policy === "always" ? "/docs" : "/docs/";
      const docs = await request(origin, docsCanonical);
      assert.equal(docs.status, 200);
      assert.equal(await docs.text(), "prerendered-docs");

      const noncanonicalDocs = await request(origin, `${docsNoncanonical}?tab=api`);
      if (policy === "preserve") {
        assert.equal(noncanonicalDocs.status, 200);
        assert.equal(await noncanonicalDocs.text(), "prerendered-docs");
      } else {
        assert.equal(noncanonicalDocs.status, 308);
        assert.equal(noncanonicalDocs.headers.get("location"), `${docsCanonical}?tab=api`);
      }

      const dynamicCanonical = policy === "always" ? "/blog/hello/" : "/blog/hello";
      const dynamicNoncanonical = policy === "always" ? "/blog/hello" : "/blog/hello/";
      const dynamic = await request(origin, `${dynamicCanonical}?page=2`);
      assert.equal(dynamic.status, 200);
      assert.equal(await dynamic.text(), `handler:${dynamicCanonical}?page=2`);
      const noncanonicalDynamic = await request(origin, `${dynamicNoncanonical}?page=2`);
      if (policy === "preserve") {
        assert.equal(noncanonicalDynamic.status, 200);
      } else {
        assert.equal(noncanonicalDynamic.status, 308);
        assert.equal(noncanonicalDynamic.headers.get("location"), `${dynamicCanonical}?page=2`);
      }

      const asset = await request(origin, "/assets/app.js");
      assert.equal(asset.status, 200);
      assert.equal(await asset.text(), "asset-body");

      const legalCanonical = policy === "always" ? "/legal.txt/" : "/legal.txt";
      const legalNoncanonical = policy === "always" ? "/legal.txt" : "/legal.txt/";
      const legal = await request(origin, legalCanonical);
      assert.equal(legal.status, 200);
      assert.equal(await legal.text(), "prerendered-legal");
      const noncanonicalLegal = await request(origin, legalNoncanonical);
      assert.equal(noncanonicalLegal.status, policy === "preserve" ? 200 : 308);
      if (policy !== "preserve") {
        assert.equal(noncanonicalLegal.headers.get("location"), legalCanonical);
      }

      for (const endpoint of [
        "/sitemap.xml",
        "/robots.txt",
        "/llms.txt",
        "/.well-known/security.txt",
        "/feed",
        "/api/ping",
      ]) {
        const response = await request(origin, endpoint);
        assert.equal(response.status, 200);
        assert.equal(await response.text(), `handler:${endpoint}`);
        assert.equal(response.headers.get("location"), null);
      }
    } finally {
      await stopServer(child);
      await fs.rm(fixture.root, { recursive: true, force: true });
    }
  });
}
