import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runCli } from "../dist/cli/index.mjs";
import {
  captureConsole,
  readJson,
  writeFixtureFile,
} from "./helpers.mjs";

const workspaceRoot = fileURLToPath(new URL("../../../", import.meta.url));

async function linkWorkspaceDependency(
  projectRoot,
  packageName,
  source,
) {
  const target = path.join(
    projectRoot,
    "node_modules",
    ...packageName.split("/"),
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.symlink(source, target, "dir");
}

test("tavo build evaluates the root config once across SSR inspection and prerender imports", async () => {
  const root = await fs.mkdtemp(
    path.join(process.env.TMPDIR ?? "/tmp", "tavo-build-config-once-"),
  );
  const counterKey = `@tavojs/tests/config-evaluations/${path.basename(root)}`;
  const counterSymbol = Symbol.for(counterKey);

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
        JSON.stringify({ name: "config-once-fixture", private: true, type: "module" }),
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
          `const counter = Symbol.for(${JSON.stringify(counterKey)});`,
          "(globalThis as Record<symbol, number>)[counter] =",
          "  ((globalThis as Record<symbol, number>)[counter] ?? 0) + 1;",
          "",
          "export default defineConfig({",
          '  pagesDir: "src/pages",',
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
        'document.querySelector("#app")?.append("client");\n',
      ),
      writeFixtureFile(
        root,
        "src/pages/index.tsx",
        [
          "export const prerender = true;",
          "",
          "export default function HomePage() {",
          '  return <main data-test="config-once">Home</main>;',
          "}",
          "",
        ].join("\n"),
      ),
    ]);

    const output = await captureConsole(() =>
      runCli(["build"], { cwd: root, version: "1.0.0" })
    );

    assert.equal(
      globalThis[counterSymbol],
      1,
      "client build, server build, route-mode inspection, and prerender must share one config evaluation",
    );
    assert.match(output.stdout, /\bSSG\b/);
    assert.match(output.stdout, /Prerendered static pages: 1/);

    const prerenderManifest = await readJson(
      path.join(root, ".tavo/build/prerender-manifest.json"),
    );
    assert.deepEqual(
      prerenderManifest.routes.map((route) => route.path),
      ["/"],
    );
    assert.match(
      await fs.readFile(path.join(root, ".tavo/build/client/index.html"), "utf8"),
      /data-test="config-once"/,
    );
  } finally {
    delete globalThis[counterSymbol];
    await fs.rm(root, { recursive: true, force: true });
  }
});
