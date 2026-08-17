import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  defineTavoViteConfig,
} from "../../src/config/index.ts";
import { loadTavoConfig } from "../../src/config/load.ts";
import { applyPluginBuildConfig } from "../../src/config/plugin-build.ts";
import {
  TAVO_PLUGIN_API_VERSION,
  definePlugin,
  definePluginPhase,
} from "../../src/plugins/index.ts";

type VitePluginLike = {
  name: string;
  configResolved?: (config: { root?: string }) => void;
  transform?: (
    code: string,
    id: string,
    options?: { ssr?: boolean },
  ) => unknown;
};

function getPlugin(
  plugins: VitePluginLike[] | undefined,
  name: string,
): VitePluginLike {
  const plugin = (plugins ?? []).find((candidate) => candidate.name === name);
  assert.ok(plugin);
  return plugin;
}

function transformedCode(result: unknown, fallback: string): string {
  if (result && typeof result === "object" && "code" in result) {
    return String((result as { code: unknown }).code);
  }
  return fallback;
}

const configModulePath = fileURLToPath(
  new URL("../../src/config/index.ts", import.meta.url),
);

test("build plugin setup receives the resolved URL policy", async () => {
  const seen: string[] = [];
  const plugin = definePlugin({
    id: "@acme/sitemap",
    version: "1.0.0",
    apiVersion: TAVO_PLUGIN_API_VERSION,
    manifest: { build: { plugins: [{ id: "sitemap" }] } },
    build: () => definePluginPhase({
      build: { plugins: { sitemap: { name: "sitemap" } } },
      setup(context) {
        seen.push(`${context.urlPolicy.trailingSlash}:${context.urlPolicy.canonicalize("/docs?q=1#top")}`);
      },
    }),
  });

  for (const trailingSlash of ["always", "never", "preserve"] as const) {
    await applyPluginBuildConfig({}, [plugin], { routing: { trailingSlash } });
  }

  assert.deepEqual(seen, [
    "always:/docs/?q=1#top",
    "never:/docs?q=1#top",
    "preserve:/docs?q=1#top",
  ]);
});

function definedConfigSource(
  objectSource = "{}",
  imports: readonly string[] = [],
): string {
  return [
    `import { defineConfig } from ${JSON.stringify(configModulePath)};`,
    ...imports,
    "",
    `export default defineConfig(${objectSource});`,
    "",
  ].join("\n");
}

async function writeDefinedConfig(
  root: string,
  objectSource = "{}",
  imports: readonly string[] = [],
): Promise<void> {
  await fs.writeFile(
    path.join(root, "tavo.config.ts"),
    definedConfigSource(objectSource, imports),
    "utf8",
  );
}

test("loadTavoConfig discovers exactly the root tavo.config.ts and ignores legacy option files", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-config-"));
  try {
    await Promise.all([
      fs.writeFile(
        path.join(root, "tavo.config.js"),
        'throw new Error("tavo.config.js must not be loaded");\n',
      ),
      fs.writeFile(
        path.join(root, "tavo.config.mjs"),
        'throw new Error("tavo.config.mjs must not be loaded");\n',
      ),
      fs.writeFile(
        path.join(root, "tavo.config.mts"),
        'throw new Error("tavo.config.mts must not be loaded");\n',
      ),
      fs.writeFile(
        path.join(root, "auto-pages-options.ts"),
        'throw new Error("auto-pages-options must not be loaded");\n',
      ),
      fs.writeFile(
        path.join(root, "auto-pages-options.mjs"),
        'throw new Error("auto-pages-options must not be loaded");\n',
      ),
      writeDefinedConfig(
        root,
        `{
  pagesDir: "app/pages",
  diagnostics: { devOverlay: true, traces: false }
}`,
      ),
    ]);

    const config = await loadTavoConfig(root);

    assert.equal(config.pagesDir, "app/pages");
    assert.deepEqual(config.diagnostics, { devOverlay: true, traces: false });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("loadTavoConfig evaluates imported and computed values once and shares its cache with Vite config", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-config-cache-"));
  const countKey = `tavo-config-evaluations-${path.basename(root)}`;
  try {
    await fs.writeFile(
      path.join(root, "settings.ts"),
      [
        'export const segments = ["computed", "pages"];',
        "export const pagesDir = segments.join('/');",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeDefinedConfig(
      root,
      `{
  pagesDir,
  plugins: [{
    id: "cache-plugin",
    version: "1.0.0",
    apiVersion: 1,
    manifest: { build: { defines: { __CONFIG_EVALUATIONS__: String((globalThis as any)[${JSON.stringify(countKey)}]) } } }
  }]
}`,
      [
        'import { pagesDir } from "./settings.ts";',
        `(globalThis as any)[${JSON.stringify(countKey)}] = ((globalThis as any)[${JSON.stringify(countKey)}] ?? 0) + 1;`,
      ],
    );

    const first = await loadTavoConfig(root);
    const second = await loadTavoConfig(root);
    const viteConfig = await defineTavoViteConfig({ root });

    assert.strictEqual(second, first);
    assert.equal(first.pagesDir, "computed/pages");
    assert.equal(
      (globalThis as Record<string, unknown>)[countKey],
      1,
    );
    assert.equal(
      (viteConfig as { define?: Record<string, string> }).define
        ?.__CONFIG_EVALUATIONS__,
      "1",
    );
  } finally {
    delete (globalThis as Record<string, unknown>)[countKey];
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("loadTavoConfig applies one explicit mode consistently and rejects mixed-mode reevaluation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-config-mode-"));
  const envName = `TAVO_CONFIG_MODE_${path.basename(root).replace(/\W/g, "_")}`;
  try {
    await fs.writeFile(
      path.join(root, ".env.development"),
      `${envName}=development-value\n`,
      "utf8",
    );
    await fs.writeFile(
      path.join(root, ".env.production"),
      `${envName}=production-value\n`,
      "utf8",
    );
    await writeDefinedConfig(
      root,
      `{ pagesDir: process.env[${JSON.stringify(envName)}] }`,
    );

    const first = await loadTavoConfig(root, { mode: "development" });
    const second = await loadTavoConfig(root, { mode: "development" });

    assert.strictEqual(second, first);
    assert.equal(first.pagesDir, "development-value");
    await assert.rejects(
      loadTavoConfig(root, { mode: "production" }),
      /already evaluated in development mode/,
    );
  } finally {
    delete process.env[envName];
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("loadTavoConfig propagates evaluation errors and rejects missing or invalid default exports", async (t) => {
  await t.test("missing root file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-config-missing-"));
    try {
      await fs.writeFile(
        path.join(root, "auto-pages-options.mjs"),
        "export default {};\n",
      );
      await assert.rejects(
        loadTavoConfig(root),
        /Every Tavo\.js project must define one root tavo\.config\.ts file/,
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  await t.test("plain default object", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-config-plain-"));
    try {
      await fs.writeFile(
        path.join(root, "tavo.config.ts"),
        'export default { pagesDir: "src/pages" };\n',
      );
      await assert.rejects(loadTavoConfig(root), /default-export defineConfig/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  await t.test("named export without a default", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-config-named-"));
    try {
      await fs.writeFile(
        path.join(root, "tavo.config.ts"),
        definedConfigSource("{}").replace("export default", "export const config ="),
      );
      await assert.rejects(loadTavoConfig(root), /default-export defineConfig/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  await t.test("evaluation failure", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-config-error-"));
    try {
      await fs.writeFile(
        path.join(root, "tavo.config.ts"),
        'throw new Error("CONFIG_SENTINEL");\n',
      );
      await assert.rejects(loadTavoConfig(root), /CONFIG_SENTINEL/);
      await assert.rejects(loadTavoConfig(root), /CONFIG_SENTINEL/);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

test("loadTavoConfig ignores package-specific top-level config owned outside core", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-config-"));
  try {
    await writeDefinedConfig(
      root,
      `{
  pagesDir: "src/pages",
  support: { package: "@tavo/ui" }
} as any`,
    );

    const config = await loadTavoConfig(root);

    assert.equal(config.pagesDir, "src/pages");
    assert.equal("support" in config, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("defineTavoViteConfig loads server env before evaluating Tavo.js plugin config", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-config-env-"));
  const previousCwd = process.cwd();
  const previousSecret = process.env.SESSION_SECRET;
  try {
    delete process.env.SESSION_SECRET;
    await fs.writeFile(
      path.join(root, ".env"),
      "SESSION_SECRET=dev-secret\n",
      "utf8",
    );
    await fs.writeFile(
      path.join(root, "tavo.config.ts"),
      [
        `import { defineConfig } from ${JSON.stringify(configModulePath)};`,
        "",
        "if (!process.env.SESSION_SECRET) {",
        '  throw new Error("missing SESSION_SECRET");',
        "}",
        "export default defineConfig({",
        "  plugins: [{",
        '    id: "env-plugin", version: "1.0.0", apiVersion: 1,',
        "    manifest: { build: { defines: {",
        "      __HAS_SESSION_SECRET__: JSON.stringify(Boolean(process.env.SESSION_SECRET))",
        "    } } }",
        "  }]",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );

    process.chdir(root);
    const config = await defineTavoViteConfig({ root });

    assert.equal(
      (config as { define?: Record<string, string> }).define
        ?.__HAS_SESSION_SECRET__,
      "true",
    );
  } finally {
    process.chdir(previousCwd);
    if (previousSecret === undefined) {
      delete process.env.SESSION_SECRET;
    } else {
      process.env.SESSION_SECRET = previousSecret;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("defineTavoViteConfig accepts the ergonomic plugin array for build contributions", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "tavo-config-plugin-use-"),
  );
  const previousCwd = process.cwd();
  try {
    await fs.writeFile(
      path.join(root, "tavo.config.ts"),
      [
        `import { defineConfig } from ${JSON.stringify(configModulePath)};`,
        "",
        "export default defineConfig({",
        "  plugins: [{",
        '    id: "build-shortcut", version: "1.0.0", apiVersion: 1,',
        "    manifest: { build: { defines: {",
        '      __PLUGIN_SHORTCUT__: JSON.stringify("enabled")',
        "    } } }",
        "  }]",
        "});",
        "",
      ].join("\n"),
      "utf8",
    );
    process.chdir(root);

    const config = await defineTavoViteConfig({ root });

    assert.equal(
      (config as { define?: Record<string, string> }).define
        ?.__PLUGIN_SHORTCUT__,
      '"enabled"',
    );
  } finally {
    process.chdir(previousCwd);
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("defineTavoViteConfig blocks static server-only imports from client-bound modules", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-server-only-"));
  try {
    await writeDefinedConfig(root);
    const resolved = await defineTavoViteConfig({ root });
    assert.equal(typeof resolved, "object");
    const plugin = getPlugin(
      (resolved as { plugins?: VitePluginLike[] }).plugins,
      "tavo:server-only-guard",
    );
    plugin.configResolved?.({ root });

    assert.throws(
      () =>
        plugin.transform?.(
          'import { getAuthSessions } from "../server/authSessions";\nexport const value = getAuthSessions;',
          path.join(root, "src/pages/_root.tsx"),
          { ssr: false },
        ),
      /static server-only import/,
    );
    assert.throws(
      () =>
        plugin.transform?.(
          'const load = () => import("../server/authSessions");\nexport { load };',
          path.join(root, "src/pages/_root.tsx"),
          { ssr: false },
        ),
      /dynamic server-only import/,
    );
    assert.doesNotThrow(() =>
      plugin.transform?.(
        [
          '// const load = () => import("../server/authSessions");',
          "/*",
          'const middleware = () => import("../server/authSessions");',
          "*/",
          'const debug = "import(\\"../server/authSessions\\")";',
          "export default function Page() { return null; }",
          "",
        ].join("\n"),
        path.join(root, "src/pages/_root.tsx"),
        { ssr: false },
      ),
    );
    assert.doesNotThrow(() =>
      plugin.transform?.(
        'import { getAuthSessions } from "../server/authSessions";\nexport const value = getAuthSessions;',
        path.join(root, "src/pages/_root.tsx"),
        { ssr: true },
      ),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("defineTavoViteConfig strips server-only route exports before client guard checks", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-server-route-"));
  try {
    await writeDefinedConfig(root);
    const resolved = await defineTavoViteConfig({ root });
    const plugins = (resolved as { plugins?: VitePluginLike[] }).plugins;
    const routeExports = getPlugin(plugins, "tavo:route-server-exports");
    const guard = getPlugin(plugins, "tavo:server-only-guard");
    routeExports.configResolved?.({ root });
    guard.configResolved?.({ root });

    const input = [
      'import { defineAction, defineRoutePage, defineServerLoader, defineServerMiddleware } from "@tavojs/core/router";',
      "export const action = defineAction(async () => {",
      '  const clientBundleCanary = "TAVO_ACTION_SECRET_CANARY_DO_NOT_SHIP";',
      '  const mod = await import("../server/authSessions");',
      "  return { session: mod.getAuthSessions(), clientBundleCanary };",
      "});",
      "export const load = defineServerLoader(async () => {",
      '  const mod = await import("../server/authSessions");',
      "  return mod.getAuthSessions();",
      "});",
      "export const middleware = defineServerMiddleware(async () => {",
      '  const mod = await import("../server/authSessions");',
      "  return mod.getAuthSessions();",
      "});",
      "function Page() { return null; }",
      'export default defineRoutePage("/login", { action, default: Page });',
      "",
    ].join("\n");
    const file = path.join(root, "src/pages/login.tsx");
    const stripped = transformedCode(
      routeExports.transform?.(input, file, { ssr: false }),
      input,
    );

    assert.doesNotThrow(() =>
      guard.transform?.(stripped, file, { ssr: false }),
    );
    assert.match(stripped, /export const action = undefined;/);
    assert.match(stripped, /export const load = undefined;/);
    assert.match(stripped, /export const middleware = undefined;/);
    assert.doesNotMatch(stripped, /\.\.\/server\/authSessions/);
    assert.doesNotMatch(stripped, /TAVO_ACTION_SECRET_CANARY_DO_NOT_SHIP/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("defineTavoViteConfig strips typed semicolonless and aliased server route exports", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "tavo-server-route-typed-"),
  );
  try {
    await writeDefinedConfig(root);
    const resolved = await defineTavoViteConfig({ root });
    const routeExports = getPlugin(
      (resolved as { plugins?: VitePluginLike[] }).plugins,
      "tavo:route-server-exports",
    );
    routeExports.configResolved?.({ root });
    const input = [
      'import { defineAction, defineServerLoader as dsl, defineServerMiddleware } from "@tavojs/core/router"',
      "const dsm = defineServerMiddleware",
      'export const action: PageAction = defineAction(async () => "ACTION_SECRET")',
      'export const load: PageLoader = dsl(async () => "LOADER_SECRET")',
      'export const middleware: PageMiddleware = dsm(async () => "MIDDLEWARE_SECRET")',
      "export default function Page() { return null }",
    ].join("\n");
    const file = path.join(root, "src/pages/typed.tsx");
    const stripped = transformedCode(
      routeExports.transform?.(input, file, { ssr: false }),
      input,
    );

    assert.match(stripped, /export const action = undefined;/);
    assert.match(stripped, /export const load = undefined;/);
    assert.match(stripped, /export const middleware = undefined;/);
    assert.match(stripped, /export default function Page/);
    assert.doesNotMatch(
      stripped,
      /ACTION_SECRET|LOADER_SECRET|MIDDLEWARE_SECRET/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("defineTavoViteConfig rejects route action forms that cannot be removed safely", async () => {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "tavo-server-route-unsafe-"),
  );
  try {
    await writeDefinedConfig(root);
    const resolved = await defineTavoViteConfig({ root });
    const routeExports = getPlugin(
      (resolved as { plugins?: VitePluginLike[] }).plugins,
      "tavo:route-server-exports",
    );
    routeExports.configResolved?.({ root });
    const file = path.join(root, "src/pages/payment.tsx");
    const unsafeModules = [
      [
        'import { defineAction, defineRoutePage } from "@tavojs/core/router";',
        'const action = defineAction(async () => "TAVO_LEGACY_ACTION_CANARY");',
        'export default defineRoutePage("/payment", { action, default: Page });',
      ].join("\n"),
      [
        'import { defineRoutePage } from "@tavojs/core/router";',
        'export default defineRoutePage("/payment", {',
        '  action: async () => "TAVO_INLINE_ACTION_CANARY",',
        "  default: Page",
        "});",
      ].join("\n"),
      [
        'export async function action() { return "TAVO_FUNCTION_ACTION_CANARY"; }',
        "export default function Page() { return null; }",
      ].join("\n"),
      [
        'const handler = async () => "TAVO_QUOTED_ACTION_CANARY";',
        'export { handler as "action" };',
        "export default function Page() { return null; }",
      ].join("\n"),
      [
        'const handler = async () => "TAVO_UNICODE_ACTION_CANARY";',
        "export const act\\u0069on = handler;",
        "export default function Page() { return null; }",
      ].join("\n"),
      [
        'const route = { action: async () => "TAVO_SPREAD_ACTION_CANARY" };',
        "export default { ...route, default() { return null; } };",
      ].join("\n"),
      [
        'const route = { action: async () => "TAVO_DYNAMIC_ACTION_CANARY" };',
        'export default defineRoutePage("/payment", route);',
      ].join("\n"),
      [
        'const route = { action: async () => "TAVO_DEFAULT_OBJECT_ACTION_CANARY", default() { return null; } };',
        "export default route;",
      ].join("\n"),
    ];

    for (const input of unsafeModules) {
      assert.throws(
        () => routeExports.transform?.(input, file, { ssr: false }),
        /could not safely remove a route action/,
      );
    }

    assert.throws(
      () =>
        routeExports.transform?.(
          [
            'import { defineServerLoader } from "@tavojs/core/router";',
            "const wrapped = (helper: unknown) => helper;",
            "const dsl = wrapped(defineServerLoader) as typeof defineServerLoader;",
            'export const load = dsl(async () => "TAVO_WRAPPED_LOADER_CANARY");',
            "export default function Page() { return null; }",
          ].join("\n"),
          file,
          { ssr: false },
        ),
      /could not safely remove a server-only route export/,
    );

    const harmlessExample = [
      'import { defineRoutePage } from "@tavojs/core/router";',
      '// defineAction(async () => "documentation only");',
      'const example = "action: defineAction(() => secret)";',
      'export default defineRoutePage("/payment", { default: Page });',
    ].join("\n");
    assert.doesNotThrow(() =>
      routeExports.transform?.(harmlessExample, file, { ssr: false }),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("defineTavoViteConfig prunes server runtime loader branches from client route modules", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-runtime-branch-"));
  try {
    await writeDefinedConfig(root);
    const resolved = await defineTavoViteConfig({ root });
    const plugins = (resolved as { plugins?: VitePluginLike[] }).plugins;
    const routeExports = getPlugin(plugins, "tavo:route-server-exports");
    const guard = getPlugin(plugins, "tavo:server-only-guard");
    routeExports.configResolved?.({ root });
    guard.configResolved?.({ root });

    const input = [
      'import { defineLoader, isServerRuntime } from "@tavojs/core/router";',
      'import { fetchAuthSession } from "@tavojs/auth/client";',
      "export const load = defineLoader(async ({ request }) => {",
      "  let user = null;",
      "  if (isServerRuntime()) {",
      '    const { getAuthSessions } = await import("../server/authSessions");',
      "    const session = await getAuthSessions().getSession(request);",
      '    user = session.get("user");',
      "  } else {",
      "    const session = await fetchAuthSession();",
      "    user = session.user;",
      "  }",
      "  return { user };",
      "});",
      "export default function Page() { return null; }",
      "",
    ].join("\n");
    const file = path.join(root, "src/pages/_root.tsx");
    const stripped = transformedCode(
      routeExports.transform?.(input, file, { ssr: false }),
      input,
    );

    assert.doesNotThrow(() =>
      guard.transform?.(stripped, file, { ssr: false }),
    );
    assert.doesNotMatch(stripped, /\.\.\/server\/authSessions/);
    assert.match(stripped, /fetchAuthSession/);
    assert.match(stripped, /export const load = defineLoader/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("defineTavoViteConfig blocks server-only marked modules from the client bundle", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-server-only-"));
  try {
    await writeDefinedConfig(root);
    const resolved = await defineTavoViteConfig({ root });
    const plugin = getPlugin(
      (resolved as { plugins?: VitePluginLike[] }).plugins,
      "tavo:server-only-guard",
    );
    plugin.configResolved?.({ root });

    assert.throws(
      () =>
        plugin.transform?.(
          'import "@tavojs/core/server-only";\nexport const secret = process.env.SESSION_SECRET;',
          path.join(root, "src/lib/private.ts"),
          { ssr: false },
        ),
      /server-only module reached the client bundle/,
    );
    assert.throws(
      () =>
        plugin.transform?.(
          "export const secret = process.env.SESSION_SECRET;",
          path.join(root, "src/server/authSessions.ts"),
          { ssr: false },
        ),
      /server-only module reached the client bundle/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("defineTavoViteConfig blocks likely secret environment values from client code", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-client-secret-"));
  try {
    await writeDefinedConfig(root);
    const resolved = await defineTavoViteConfig({ root });
    const plugin = getPlugin(
      (resolved as { plugins?: VitePluginLike[] }).plugins,
      "tavo:server-only-guard",
    );
    plugin.configResolved?.({ root });
    const file = path.join(root, "src/pages/account.tsx");

    assert.throws(
      () =>
        plugin.transform?.(
          "export const credential = process.env.DATABASE_PASSWORD;",
          file,
          { ssr: false },
        ),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "TAVO_CONFIG_002");
        assert.match(String(error), /DATABASE_PASSWORD/);
        assert.match(String(error), /Import chain:/);
        return true;
      },
    );
    assert.throws(
      () =>
        plugin.transform?.(
          "export const token = import.meta.env.PRIVATE_API_TOKEN;",
          file,
          { ssr: false },
        ),
      /PRIVATE_API_TOKEN/,
    );
    assert.doesNotThrow(() =>
      plugin.transform?.(
        [
          "// process.env.DATABASE_PASSWORD",
          "const example = 'import.meta.env.PRIVATE_API_TOKEN';",
          "export const mode = import.meta.env.MODE;",
        ].join("\n"),
        file,
        { ssr: false },
      ),
    );
    assert.doesNotThrow(() =>
      plugin.transform?.(
        "export const credential = process.env.DATABASE_PASSWORD;",
        file,
        { ssr: true },
      ),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("defineTavoViteConfig detects secrets inside template expressions but ignores template text", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-client-template-"));
  try {
    await writeDefinedConfig(root);
    const resolved = await defineTavoViteConfig({ root });
    const guard = getPlugin(
      (resolved as { plugins?: VitePluginLike[] }).plugins,
      "tavo:server-only-guard",
    );
    guard.configResolved?.({ root });

    assert.throws(
      () =>
        guard.transform?.(
          "export const value = `token:${process.env.API_SECRET}`",
          path.join(root, "src/client.ts"),
          { ssr: false },
        ),
      /TAVO_CONFIG_002/,
    );
    assert.doesNotThrow(() =>
      guard.transform?.(
        "export const value = `process.env.API_SECRET`",
        path.join(root, "src/client.ts"),
        { ssr: false },
      ),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
