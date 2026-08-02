import assert from "node:assert/strict";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../dist/cli/index.mjs";
import {
  captureConsole,
  readJson,
  writeFixtureFile,
} from "./helpers.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));
const alphaSentinel = `ALPHA_ROUTE_IMPLEMENTATION_${"a".repeat(48 * 1024)}`;
const betaSentinel = `BETA_ROUTE_IMPLEMENTATION_${"b".repeat(48 * 1024)}`;

async function linkWorkspaceDependency(projectRoot, packageName, source) {
  const target = path.join(
    projectRoot,
    "node_modules",
    ...packageName.split("/"),
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.symlink(source, target, "dir");
}

async function reservePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
  return address.port;
}

async function waitForPreview(url, child) {
  let lastError;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`production preview exited early with code ${child.exitCode}`);
    }
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw lastError ?? new Error("production preview did not start");
}

async function stopPreview(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) {
    child.kill("SIGKILL");
  }
}

test("production SSR emits lazy route chunks and preserves route behavior", async () => {
  const root = await fs.mkdtemp(
    path.join(process.env.TMPDIR ?? "/tmp", "tavo-lazy-ssr-"),
  );
  let preview;

  try {
    await Promise.all([
      linkWorkspaceDependency(
        root,
        "@tavojs/core",
        path.join(workspaceRoot, "packages/core"),
      ),
      linkWorkspaceDependency(
        root,
        "vite",
        path.join(workspaceRoot, "node_modules/vite"),
      ),
      writeFixtureFile(
        root,
        "package.json",
        JSON.stringify({ name: "lazy-ssr-fixture", private: true, type: "module" }),
      ),
      writeFixtureFile(
        root,
        "vite.config.ts",
        [
          'import { defineTavoViteConfig } from "@tavojs/core/config";',
          "",
          'export default defineTavoViteConfig({ logLevel: "silent" });',
          "",
        ].join("\n"),
      ),
      writeFixtureFile(
        root,
        "tavo.config.ts",
        [
          'import { defineConfig } from "@tavojs/core/config";',
          "",
          "export default defineConfig({",
          '  pagesDir: "src/pages",',
          "  ssr: {},",
          "});",
          "",
        ].join("\n"),
      ),
      writeFixtureFile(
        root,
        "index.html",
        [
          "<!doctype html>",
          '<html><body><div id="app"></div><script type="module" src="/src/main.ts"></script></body></html>',
          "",
        ].join("\n"),
      ),
      writeFixtureFile(
        root,
        "src/main.ts",
        [
          'import { bootTavo } from "@tavojs/core";',
          "",
          "void bootTavo();",
          "",
        ].join("\n"),
      ),
      writeFixtureFile(
        root,
        "src/pages/_layout.tsx",
        [
          "export const load = () => ({ shell: 'layout-loaded' });",
          "export const middleware = ({ to }) =>",
          "  to === '/blocked' ? { redirect: '/alpha', status: 307 } : undefined;",
          "",
          "export default function Layout({ data, children }) {",
          "  return <section data-layout={data?.shell}>{children}</section>;",
          "}",
          "",
        ].join("\n"),
      ),
      writeFixtureFile(
        root,
        "src/pages/alpha.tsx",
        [
          `const sentinel = ${JSON.stringify(alphaSentinel)};`,
          "export const load = () => ({ loaded: 'alpha-loader' });",
          "",
          "export default function Alpha({ data }) {",
          "  return <main data-route=\"alpha\">{data.loaded}:{sentinel}</main>;",
          "}",
          "",
        ].join("\n"),
      ),
      writeFixtureFile(
        root,
        "src/pages/beta.tsx",
        [
          `const sentinel = ${JSON.stringify(betaSentinel)};`,
          "",
          "export default function Beta() {",
          "  return <main data-route=\"beta\">{sentinel}</main>;",
          "}",
          "",
        ].join("\n"),
      ),
      writeFixtureFile(
        root,
        "src/pages/blocked.tsx",
        "export default function Blocked() { return <main>blocked</main>; }\n",
      ),
      writeFixtureFile(
        root,
        "src/pages/action.tsx",
        [
          'import { defineAction } from "@tavojs/core/router";',
          "",
          "export const action = defineAction(async ({ request }) => {",
          "  const body = await request.formData();",
          "  return { json: { action: String(body.get('value')) } };",
          "});",
          "",
          "export default function ActionPage() {",
          "  return <main>action-page</main>;",
          "}",
          "",
        ].join("\n"),
      ),
      writeFixtureFile(
        root,
        "src/pages/broken.tsx",
        [
          "export const load = () => { throw new Error('fixture-broken'); };",
          "export function error({ error }) {",
          "  return <main data-error=\"local\">{String(error)}</main>;",
          "}",
          "export default function Broken() { return <main>unreachable</main>; }",
          "",
        ].join("\n"),
      ),
      writeFixtureFile(
        root,
        "src/pages/404.tsx",
        "export default function NotFound({ pathname }) { return <main>missing:{pathname}</main>; }\n",
      ),
      writeFixtureFile(
        root,
        "src/pages/static.tsx",
        [
          "export const prerender = true;",
          "export default function StaticPage() { return <main>static-prerender</main>; }",
          "",
        ].join("\n"),
      ),
      writeFixtureFile(
        root,
        "src/pages/generated/[slug].tsx",
        [
          "export const prerender = true;",
          "export const generateStaticParams = () => [{ slug: 'one' }, { slug: 'two' }];",
          "export default function Generated({ params }) {",
          "  return <main>generated:{params.slug}</main>;",
          "}",
          "",
        ].join("\n"),
      ),
    ]);

    const output = await captureConsole(() =>
      runCli(["build"], { cwd: root, version: "1.0.0" })
    );
    assert.match(output.stdout, /\bSSG\b/);
    assert.match(output.stdout, /Prerendered static pages: 3/);

    const serverDir = path.join(root, ".tavo/build/server");
    const entry = await fs.readFile(path.join(serverDir, "entry.mjs"), "utf8");
    assert.doesNotMatch(entry, /ALPHA_ROUTE_IMPLEMENTATION_/);
    assert.doesNotMatch(entry, /BETA_ROUTE_IMPLEMENTATION_/);

    const chunkDir = path.join(serverDir, "chunks");
    const chunkFiles = (await fs.readdir(chunkDir))
      .filter((file) => file.endsWith(".mjs"));
    assert.ok(chunkFiles.length >= 2, "expected route-scoped server chunks");
    const chunks = await Promise.all(
      chunkFiles.map(async (file) => ({
        file,
        source: await fs.readFile(path.join(chunkDir, file), "utf8"),
      })),
    );
    const alphaChunk = chunks.find(({ source }) =>
      source.includes("ALPHA_ROUTE_IMPLEMENTATION_")
    );
    const betaChunk = chunks.find(({ source }) =>
      source.includes("BETA_ROUTE_IMPLEMENTATION_")
    );
    assert.ok(alphaChunk, "alpha implementation must be emitted outside entry.mjs");
    assert.ok(betaChunk, "beta implementation must be emitted outside entry.mjs");
    assert.notEqual(alphaChunk.file, betaChunk.file);

    const prerenderManifest = await readJson(
      path.join(root, ".tavo/build/prerender-manifest.json"),
    );
    assert.deepEqual(
      prerenderManifest.routes.map((route) => route.path).sort(),
      ["/generated/one", "/generated/two", "/static"],
    );

    const port = await reservePort();
    const origin = `http://127.0.0.1:${port}`;
    preview = spawn(process.execPath, [path.join(serverDir, "start.mjs")], {
      cwd: root,
      env: {
        ...process.env,
        HOST: "127.0.0.1",
        PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    await waitForPreview(`${origin}/alpha`, preview);

    const alpha = await fetch(`${origin}/alpha`);
    const alphaHtml = await alpha.text();
    assert.equal(alpha.status, 200);
    assert.match(alphaHtml, /data-layout="layout-loaded"/);
    assert.match(alphaHtml, /alpha-loader:ALPHA_ROUTE_IMPLEMENTATION_/);

    const beta = await fetch(`${origin}/beta`);
    assert.match(await beta.text(), /BETA_ROUTE_IMPLEMENTATION_/);

    const blocked = await fetch(`${origin}/blocked`, { redirect: "manual" });
    assert.equal(blocked.status, 307);
    assert.equal(blocked.headers.get("location"), "/alpha");

    const action = await fetch(`${origin}/action`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        origin,
      },
      body: new URLSearchParams({ value: "worked" }),
    });
    assert.equal(action.status, 200);
    assert.deepEqual(await action.json(), { action: "worked" });

    const broken = await fetch(`${origin}/broken`);
    assert.equal(broken.status, 500);
    assert.match(await broken.text(), /data-error="local">Error: fixture-broken/);

    const missing = await fetch(`${origin}/missing`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /missing:\/missing/);

    const staticPage = await fetch(`${origin}/static`);
    assert.equal(staticPage.status, 200);
    assert.match(await staticPage.text(), /static-prerender/);

    const generated = await fetch(`${origin}/generated/two`);
    assert.equal(generated.status, 200);
    assert.match(await generated.text(), /generated:two/);
  } finally {
    if (preview) await stopPreview(preview);
    await fs.rm(root, { recursive: true, force: true });
  }
});
