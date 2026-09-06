import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build, type UserConfig } from "vite";
import { defineTavoViteConfig } from "../../src/config/index.ts";
import { applyPluginBuildConfig } from "../../src/config/plugin-build.ts";
import { definePlugin, TAVO_PLUGIN_API_VERSION } from "../../src/plugins/index.ts";
import { createRouteServerExportsPlugin } from "../../src/config/route-server-exports.ts";
import { createServerOnlyGuardPlugin } from "../../src/config/server-only.ts";

test("configured custom pages directories remove private server implementations from the client transform", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-config-review-"));
  try {
    const configPath = fileURLToPath(new URL("../../src/config/index.ts", import.meta.url));
    await fs.writeFile(path.join(root, "tavo.config.ts"), [
      `import { defineConfig } from ${JSON.stringify(configPath)};`,
      'export default defineConfig({ pagesDir: "src/routes" });',
    ].join("\n"));
    const resolved = await defineTavoViteConfig({ root });
    const plugins = (resolved as { plugins: ReturnType<typeof createRouteServerExportsPlugin>[] }).plugins;
    const plugin = plugins.find((item) => item.name === "tavo:route-server-exports")!;
    plugin.configResolved({ root });
    const source = [
      'import { defineAction, defineServerLoader } from "@tavojs/core/router";',
      'export const action = defineAction(async () => "PRIVATE_ACTION_CANARY");',
      'export const load = defineServerLoader(async () => "PRIVATE_LOADER_CANARY");',
      'export default function Page() { return "public page"; }',
    ].join("\n");
    const transformed = plugin.transform(source, path.join(root, "src/routes/login.tsx?direct"), { ssr: false });
    assert.ok(transformed);
    assert.doesNotMatch(transformed.code, /PRIVATE_(ACTION|LOADER)_CANARY/);
    assert.match(transformed.code, /public page/);
    assert.equal(plugin.transform(source, path.join(root, "src/routes/login.tsx"), { ssr: true }), null);
    assert.equal(plugin.transform(source, path.join(root, "src/routes-extra/page.tsx")), null);
    assert.equal(plugin.transform(source, path.join(root, "src/pages/login.tsx")), null);

    await fs.mkdir(path.join(root, "src/routes"), { recursive: true });
    await Promise.all([
      fs.writeFile(path.join(root, "src/routes/login.tsx"), source),
      fs.writeFile(path.join(root, "src/main.ts"), 'import * as route from "./routes/login.tsx"; globalThis.route = route;'),
    ]);
    const result = await build({
      ...resolved as UserConfig,
      configFile: false,
      logLevel: "silent",
      build: { write: false, rollupOptions: { input: path.join(root, "src/main.ts") } },
    });
    const output = (Array.isArray(result) ? result : [result])
      .flatMap((item) => "output" in item ? item.output : [])
      .map((item) => item.type === "chunk" ? item.code : "")
      .join("\n");
    assert.match(output, /public page/);
    assert.doesNotMatch(output, /PRIVATE_(ACTION|LOADER)_CANARY/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("client guards recognize both symlinked project paths and Vite's canonical module paths", async () => {
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-symlink-review-"));
  try {
    const project = path.join(temporary, "project");
    const linked = path.join(temporary, "linked");
    await fs.mkdir(path.join(project, "src/routes"), { recursive: true });
    await fs.mkdir(path.join(project, "src/server"));
    await fs.symlink(project, linked, "dir");
    const real = await fs.realpath(project);
    const routePlugin = createRouteServerExportsPlugin("src/routes");
    const serverPlugin = createServerOnlyGuardPlugin();
    routePlugin.configResolved({ root: linked });
    serverPlugin.configResolved({ root: linked });
    for (const root of [linked, real]) {
      assert.throws(() => serverPlugin.transform(
        'export const value = "SERVER_SECRET_CANARY";',
        path.join(root, "src/server/private.ts"),
      ), /server-only module reached the client bundle/);
      const transformed = routePlugin.transform(
        'export const action = async () => "ACTION_SECRET_CANARY";\nexport default () => null;',
        path.join(root, "src/routes/login.tsx"),
      );
      assert.ok(transformed);
      assert.doesNotMatch(transformed.code, /ACTION_SECRET_CANARY/);
    }
  } finally {
    await fs.rm(temporary, { recursive: true, force: true });
  }
});

test("explicit application alias overrides win consistently for object and array aliases", async () => {
  const plugin = definePlugin({
    id: "@acme/alias",
    version: "1.0.0",
    apiVersion: TAVO_PLUGIN_API_VERSION,
    manifest: { build: { aliases: { "@shared": "/plugin/shared", "@plugin": "/plugin/only" } } },
  });
  const plugins = {
    use: [plugin],
    overrides: [{ kind: "alias" as const, key: "@shared", replace: { plugin: "@acme/alias" }, with: { owner: "app" as const } }],
  };
  const array = await applyPluginBuildConfig({ resolve: { alias: [{ find: "@shared", replacement: "/app/shared" }] } }, plugins);
  assert.deepEqual(array.resolve.alias.filter((entry) => entry.find === "@shared"), [
    { find: "@shared", replacement: "/app/shared" },
  ]);
  assert.equal(array.resolve.alias.find((entry) => entry.find === "@plugin")?.replacement, "/plugin/only");
  const object = await applyPluginBuildConfig({ resolve: { alias: { "@shared": "/app/shared" } } }, plugins);
  assert.equal(object.resolve.alias["@shared"], "/app/shared");
  await assert.rejects(
    applyPluginBuildConfig({ resolve: { alias: [{ find: "@shared", replacement: "/app/shared" }] } }, [plugin]),
    /collides with application Vite config/,
  );
});
