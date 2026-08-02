import assert from "node:assert/strict";
import { builtinModules } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { build } from "vite";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const coreSourceDir = path.join(rootDir, "packages/core/src");
const builtins = new Set(
  builtinModules.flatMap((name) => [
    name,
    name.startsWith("node:") ? name.slice(5) : `node:${name}`,
  ]),
);

test("compat: browser entry graphs do not resolve Node-only modules", async () => {
  const forbiddenImports = [];
  const forbiddenModules = [];
  const forbiddenModulePattern =
    /(?:^|\/)(?:node_modules\/(?:dotenv|sharp)(?:\/|$)|packages\/core\/src\/ssr\/(?:env|handlers|image|index|runtime|vite-dev)(?:\.|\/|$)|packages\/core\/src\/framework\/pages\.tsx$|packages\/core\/src\/server\.ts$)/;

  await build({
    configFile: false,
    root: rootDir,
    logLevel: "silent",
    plugins: [
      {
        name: "verify-browser-module-boundary",
        enforce: "pre",
        resolveId(source, importer) {
          if (builtins.has(source) || source === "dotenv" || source === "sharp") {
            forbiddenImports.push({ source, importer });
          }
          return null;
        },
        transform(_code, id) {
          const normalizedId = id.split(path.sep).join("/");
          if (forbiddenModulePattern.test(normalizedId)) {
            forbiddenModules.push(normalizedId);
          }
          return null;
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      rollupOptions: {
        input: {
          root: path.join(coreSourceDir, "index.browser.ts"),
          router: path.join(coreSourceDir, "router/index.ts"),
          config: path.join(coreSourceDir, "config/browser.ts"),
          plugin: path.join(coreSourceDir, "plugins/index.ts"),
          dev: path.join(coreSourceDir, "dev.browser.ts"),
          "jsx-runtime": path.join(coreSourceDir, "jsx-runtime.ts"),
          "jsx-dev-runtime": path.join(coreSourceDir, "jsx-dev-runtime.ts"),
        },
      },
    },
  });

  assert.deepEqual(
    forbiddenImports,
    [],
    `browser entries resolved Node-only imports:\n${JSON.stringify(forbiddenImports, null, 2)}`,
  );
  assert.deepEqual(
    forbiddenModules,
    [],
    `browser entries transformed server-only modules:\n${forbiddenModules.join("\n")}`,
  );
});
