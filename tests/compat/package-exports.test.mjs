import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import semver from "semver";
import ts from "typescript";

const rootDir = path.resolve(new URL("../..", import.meta.url).pathname);
const coreDir = path.join(rootDir, "packages/core");
const cliDir = path.join(rootDir, "packages/cli");
const rootPackageJsonPath = path.join(rootDir, "package.json");
const packageJsonPath = path.join(coreDir, "package.json");
const releaseWorkflowPath = path.join(rootDir, ".github/workflows/release.yml");
const canonicalRepositoryUrl = "git+https://github.com/tavojs/core.git";
const canonicalHomepages = {
  "@tavojs/core": "https://tavojs.dev/docs/core",
  "@tavojs/cli": "https://tavojs.dev/docs/cli"
};
const canonicalBugsUrl = "https://github.com/tavojs/core/issues";
const supportedNodeRange = "^20.19.0 || >=22.12.0";

function assertPublicPackageMetadata(packageJson, packageName, directory, expectedKeywords) {
  assert.equal(packageJson.name, packageName);
  assert.equal(typeof packageJson.description, "string");
  assert.ok(packageJson.description.length > 0, `${packageName} should define a description`);
  assert.equal(packageJson.license, "MIT");
  assert.equal(packageJson.author, "Tavo contributors");
  assert.equal(packageJson.repository?.type, "git");
  assert.equal(packageJson.repository?.url, canonicalRepositoryUrl);
  assert.equal(packageJson.repository?.directory, directory);
  assert.equal(packageJson.homepage, canonicalHomepages[packageName]);
  assert.equal(packageJson.bugs?.url, canonicalBugsUrl);
  assert.equal(typeof packageJson.engines?.node, "string");
  assert.equal(packageJson.engines.node, supportedNodeRange);
  assert.ok(Array.isArray(packageJson.keywords), `${packageName} should define keywords`);
  for (const keyword of expectedKeywords) {
    assert.ok(packageJson.keywords.includes(keyword), `${packageName} should include keyword ${keyword}`);
  }
}

function npmPackDryRun(packageDir) {
  const npmCache = fs.mkdtemp(path.join(os.tmpdir(), "tavo-npm-cache-"));
  return npmCache.then((cacheDir) => {
    const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: packageDir,
      encoding: "utf8",
      env: {
        ...process.env,
        npm_config_cache: cacheDir
      }
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    return JSON.parse(result.stdout)[0];
  });
}

function assertPackedReadmeLinks(readmeSource, packedFiles, packageName) {
  const linkPattern = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const externalPattern = /^[a-z][a-z0-9+.-]*:/i;
  const files = new Set(packedFiles.map((entry) => entry.path));
  let match;

  while ((match = linkPattern.exec(readmeSource)) !== null) {
    const target = match[1];
    if (
      target.startsWith("#") ||
      target.startsWith("//") ||
      externalPattern.test(target)
    ) {
      continue;
    }

    const pathname = target.split("#")[0];
    if (!pathname) {
      continue;
    }

    const normalized = path.posix.normalize(pathname);
    assert.ok(!normalized.startsWith("../"), `${packageName} README link leaves the package: ${target}`);
    assert.ok(files.has(normalized), `${packageName} README link points to a file missing from the package: ${target}`);
  }
}

test("compat: every @tavojs/core export imports and has a declaration file", async () => {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const exportsMap = packageJson.exports;

  for (const [subpath, entry] of Object.entries(exportsMap)) {
    const importTarget = typeof entry === "string" ? entry : entry.import;
    const typesTarget = typeof entry === "string" ? null : entry.types;
    assert.ok(importTarget, `${subpath} should define an import target`);
    assert.ok(typesTarget, `${subpath} should define a types target`);

    const specifier = subpath === "." ? "@tavojs/core" : `@tavojs/core/${subpath.slice(2)}`;
    await import(specifier);
    await fs.access(path.join(coreDir, typesTarget));
  }
});

const rootExcludedSubpaths = new Set([
  "./config",
  "./dev",
  "./jsx-dev-runtime",
  "./jsx-runtime",
  "./plugin",
  "./router",
  "./server",
  "./server-only",
]);

test("compat: package root mirrors stable environment-neutral subpath exports", async () => {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const rootApi = await import("@tavojs/core");
  const rootDeclaration = path.join(coreDir, packageJson.exports["."].types);
  const declarationFiles = [rootDeclaration];

  for (const [subpath, entry] of Object.entries(packageJson.exports)) {
    if (subpath === "." || rootExcludedSubpaths.has(subpath)) {
      continue;
    }
    const specifier = subpath === "." ? "@tavojs/core" : `@tavojs/core/${subpath.slice(2)}`;
    const publicApi = await import(specifier);
    for (const name of Object.keys(publicApi)) {
      assert.ok(name in rootApi, `${specifier} runtime export ${name} is missing from @tavojs/core`);
    }
    declarationFiles.push(path.join(coreDir, entry.types));
  }

  const program = ts.createProgram(declarationFiles, {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022
  });
  const checker = program.getTypeChecker();
  const rootSource = program.getSourceFile(rootDeclaration);
  assert.ok(rootSource, "root declaration should be part of the compatibility program");
  const rootSymbol = checker.getSymbolAtLocation(rootSource);
  assert.ok(rootSymbol, "root declaration should expose a module symbol");
  const rootNames = new Set(checker.getExportsOfModule(rootSymbol).map((symbol) => symbol.name));

  for (const [subpath, entry] of Object.entries(packageJson.exports)) {
    if (subpath === "." || rootExcludedSubpaths.has(subpath)) {
      continue;
    }
    const declaration = path.join(coreDir, entry.types);
    const source = program.getSourceFile(declaration);
    assert.ok(source, `${subpath} declaration should be part of the compatibility program`);
    const symbol = checker.getSymbolAtLocation(source);
    assert.ok(symbol, `${subpath} declaration should expose a module symbol`);
    const missing = checker
      .getExportsOfModule(symbol)
      .map((exported) => exported.name)
      .filter((name) => !rootNames.has(name));
    assert.deepEqual(missing, [], `${subpath} has named type exports missing from @tavojs/core`);
  }

  assert.equal("createNodeRequestHandler" in rootApi, false);
  assert.equal("defineTavoViteConfig" in rootApi, false);
  assert.equal("createInstrumentation" in rootApi, false);
  assert.equal("createSessionStorage" in rootApi, false);
});

test("compat: browser root mirrors stable environment-neutral subpath exports", async () => {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const browserTarget = packageJson.exports["."].browser;
  assert.equal(browserTarget, "./dist/index.browser.js");
  const browserApi = await import(new URL(browserTarget, `file://${coreDir}/`).href);

  for (const subpath of Object.keys(packageJson.exports)) {
    if (subpath === "." || rootExcludedSubpaths.has(subpath)) {
      continue;
    }
    const specifier = `@tavojs/core/${subpath.slice(2)}`;
    const publicApi = await import(specifier);
    for (const name of Object.keys(publicApi)) {
      assert.ok(name in browserApi, `${specifier} browser export ${name} is missing from @tavojs/core`);
    }
  }
});

test("compat: stability metadata covers every package export at 1.0", async () => {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const { TAVO_API_STABILITY } = await import("@tavojs/core");
  const expected = Object.keys(packageJson.exports)
    .map((subpath) => subpath === "." ? "@tavojs/core" : `@tavojs/core/${subpath.slice(2)}`)
    .sort();

  assert.deepEqual(Object.keys(TAVO_API_STABILITY).sort(), expected);
  assert.ok(Object.values(TAVO_API_STABILITY).every((entry) => entry.since === "1.0"));
  assert.equal(TAVO_API_STABILITY["@tavojs/core/plugin"].level, "stable");
  assert.equal(TAVO_API_STABILITY["@tavojs/core/router"].level, "stable");
  assert.equal(TAVO_API_STABILITY["@tavojs/core/server"].level, "stable");
  assert.equal(TAVO_API_STABILITY["@tavojs/core/dev"].level, "experimental");
});

test("compat: public entrypoint map stays intentionally small", async () => {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  assert.deepEqual(Object.keys(packageJson.exports), [
    ".",
    "./router",
    "./server",
    "./config",
    "./plugin",
    "./dev",
    "./server-only",
    "./jsx-runtime",
    "./jsx-dev-runtime",
  ]);
});

test("compat: common app APIs import together from the package root", async () => {
  const { Seo, createTavo, createStore } = await import("@tavojs/core");

  assert.equal(typeof Seo, "function");
  assert.equal(typeof createTavo, "function");
  assert.equal(typeof createStore, "function");
});

test("compat: pathname state is a stable router API", async () => {
  const router = await import("@tavojs/core/router");

  assert.equal(typeof router.getCurrentPathname, "function");
  assert.equal(typeof router.subscribePathname, "function");
  assert.equal(typeof router.defineRoutePage, "function");
});

test("compat: removed aliases are absent from their canonical entry points", async () => {
  const core = await import("@tavojs/core");
  const config = await import("@tavojs/core/config");
  const dev = await import("@tavojs/core/dev");
  const plugin = await import("@tavojs/core/plugin");
  const router = await import("@tavojs/core/router");
  const server = await import("@tavojs/core/server");
  const autoPagesTypes = await fs.readFile(
    path.join(coreDir, "dist/auto-pages/index.d.ts"),
    "utf8"
  );

  assert.doesNotMatch(autoPagesTypes, /\bAutoPagesBootstrap(?:Options|Result)\b/);
  assert.equal("definePage" in core, false);
  assert.equal("defineLayout" in core, false);
  assert.equal("renderAppToString" in server, false);
  assert.equal("useStyle" in core, false);
  assert.equal("loadTavoConfig" in config, false);
  assert.equal(typeof dev.loadTavoConfig, "function");
  assert.equal(typeof dev.inspectPluginGraph, "function");
  assert.equal("compilePluginGraph" in plugin, false);
  assert.equal("createPluginRuntimeAsync" in plugin, false);
  assert.equal("handlePluginRequest" in plugin, false);
  assert.equal("renderPluginHead" in plugin, false);
  assert.equal("PagesRuntimeResolved" in router, false);
  assert.equal("renderDocumentParts" in server, false);
});

test("compat: root hides renderer internals and JSX transform exports", async () => {
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const core = await import("@tavojs/core");
  const jsxRuntime = await import("@tavojs/core/jsx-runtime");
  const jsxDevRuntime = await import("@tavojs/core/jsx-dev-runtime");
  const rootDeclaration = path.join(coreDir, packageJson.exports["."].types);
  const program = ts.createProgram([rootDeclaration], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(rootDeclaration);
  assert.ok(source, "root declaration should be part of the compatibility program");
  const rootSymbol = checker.getSymbolAtLocation(source);
  assert.ok(rootSymbol, "root declaration should expose a module symbol");
  const rootNames = new Set(checker.getExportsOfModule(rootSymbol).map((entry) => entry.name));

  for (const internalName of [
    "AppRuntimeContext",
    "ComponentProps",
    "CsrActionContext",
    "PageRuntimeOptions",
    "PagesRuntime",
    "Props",
    "StoreSnapshotState",
    "applyElementDirectives",
    "applyI18nMessageChunk",
    "assignDomRef",
    "beginStoreSnapshotScope",
    "clearDomRef",
    "clearServices",
    "compilePluginGraph",
    "createPagesRuntime",
    "definePlugin",
    "defineRoutePage",
    "getOptimizedImageUrl",
    "hydrateStoresFromDocumentState",
    "jsx",
    "JSX",
    "jsxDEV",
    "jsxs",
    "renderPagesDocument",
    "renderSeoNodes",
    "resolveTavoActionUrl",
    "runWithStoreSnapshotScope",
    "subscribePathname",
    "unregisterService"
  ]) {
    assert.equal(internalName in core, false, `${internalName} must not be exported from @tavojs/core`);
    assert.equal(rootNames.has(internalName), false, `${internalName} must not be declared by @tavojs/core`);
  }

  assert.equal(typeof jsxRuntime.jsx, "function");
  assert.equal(typeof jsxRuntime.jsxs, "function");
  assert.equal(typeof jsxDevRuntime.jsxDEV, "function");
});

test("compat: plugin authoring hides normalized and host-only types", async () => {
  const declaration = path.join(coreDir, "dist/plugins/index.d.ts");
  const program = ts.createProgram([declaration], {
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022
  });
  const checker = program.getTypeChecker();
  const source = program.getSourceFile(declaration);
  assert.ok(source, "plugin declaration should be part of the compatibility program");
  const symbol = checker.getSymbolAtLocation(source);
  assert.ok(symbol, "plugin declaration should expose a module symbol");
  const names = new Set(checker.getExportsOfModule(symbol).map((entry) => entry.name));

  for (const internalName of [
    "CompiledPlugin",
    "CompiledPluginBuildValue",
    "CompiledPluginEndpoint",
    "CompiledPluginGraph",
    "CompiledPluginPage",
    "PluginConfiguration",
    "PluginCompileOptions",
    "PluginGraphInspection",
    "PluginInstallation",
    "PluginMount",
    "PluginPermission",
    "PluginRequestScope",
    "PluginRuntimeServerRoute",
    "TavoPluginRuntime"
  ]) {
    assert.equal(names.has(internalName), false, `${internalName} must remain internal`);
  }

  for (const authorName of [
    "PluginCapabilityToken",
    "PluginServerHandlerContext",
    "TavoPlugin",
    "TavoPluginInput",
    "TavoPluginManifest"
  ]) {
    assert.equal(names.has(authorName), true, `${authorName} should remain public for plugin authors`);
  }
});

test("compat: stable server entrypoint owns Node rendering and sessions", async () => {
  const server = await import("@tavojs/core/server");
  const declaration = await fs.readFile(
    path.join(coreDir, "dist/server.d.ts"),
    "utf8"
  );

  assert.equal(typeof server.createNodeRequestHandler, "function");
  assert.equal(typeof server.createSessionStorage, "function");
  assert.equal(typeof server.renderDocument, "function");
  assert.equal("createFetchRequestHandler" in server, false);
  assert.equal("createImageRequestHandler" in server, false);
  assert.doesNotMatch(declaration, /\b(?:FetchHandlerOptions|createFetchRequestHandler|createImageRequestHandler)\b/);
});

test("compat: public packages expose npm-ready metadata", async () => {
  const rootPackageJson = JSON.parse(await fs.readFile(rootPackageJsonPath, "utf8"));
  const corePackageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const cliPackageJson = JSON.parse(await fs.readFile(path.join(cliDir, "package.json"), "utf8"));

  assert.equal(rootPackageJson.private, true);
  assertPublicPackageMetadata(corePackageJson, "@tavojs/core", "packages/core", ["tavo", "file-based-routing", "mvc"]);
  assertPublicPackageMetadata(cliPackageJson, "@tavojs/cli", "packages/cli", ["tavo", "cli", "file-based-routing", "vite"]);
  assert.equal(corePackageJson.publishConfig?.access, "public");
  assert.equal(cliPackageJson.publishConfig?.access, "public");
  assert.equal(corePackageJson.publishConfig?.registry, "https://registry.npmjs.org/");
  assert.equal(cliPackageJson.publishConfig?.registry, "https://registry.npmjs.org/");
  assert.deepEqual(cliPackageJson.bin, { tavo: "dist/tavo.mjs" });
  assert.equal(
    semver.satisfies(
      corePackageJson.version,
      cliPackageJson.dependencies?.["@tavojs/core"] ?? ""
    ),
    true
  );
});

test("compat: publish reuses artifacts verified before concurrent workspace publication", async () => {
  const workflow = await fs.readFile(releaseWorkflowPath, "utf8");

  assert.match(workflow, /- name: Verify release\n\s+run: npm run release:check/);
  assert.match(workflow, /NPM_CONFIG_IGNORE_SCRIPTS: ["']true["']/);
});

test("compat: release metadata tracks package versions and scaffolds 1.x dependencies", async () => {
  const corePackageJson = JSON.parse(await fs.readFile(packageJsonPath, "utf8"));
  const cliPackageJson = JSON.parse(await fs.readFile(path.join(cliDir, "package.json"), "utf8"));
  const coreChangelog = await fs.readFile(path.join(coreDir, "CHANGELOG.md"), "utf8");
  const cliChangelog = await fs.readFile(path.join(cliDir, "CHANGELOG.md"), "utf8");
  const scaffoldSource = await fs.readFile(
    path.join(cliDir, "src/cli/commands/generate/app.mts"),
    "utf8"
  );

  assert.equal(corePackageJson.version, "1.0.1");
  assert.equal(cliPackageJson.version, "1.0.0");
  assert.match(coreChangelog, /^## 1\.0\.1$/m);
  assert.match(coreChangelog, /^## 1\.0\.0$/m);
  assert.match(cliChangelog, /^## 1\.0\.0$/m);
  assert.match(coreChangelog, /Release the stable Tavo 1\.0 framework and CLI contracts/);
  assert.match(cliChangelog, /Release the stable Tavo 1\.0 framework and CLI contracts/);
  assert.match(scaffoldSource, /"@tavojs\/core": "\^1\.0\.0"/);
  assert.match(scaffoldSource, /"@tavojs\/cli": "\^1\.0\.0"/);
});

test("compat: core npm pack dry-run contains metadata, license, and built dist files", async () => {
  const pack = await npmPackDryRun(coreDir);
  const files = new Set(pack.files.map((entry) => entry.path));
  assert.equal(pack.name, "@tavojs/core");
  assert.ok(files.has("package.json"));
  assert.ok(files.has("LICENSE"));
  assert.ok(files.has("dist/index.js"));
  assert.ok(files.has("dist/index.d.ts"));
  assert.ok(files.has("dist/global.d.ts"));
  assert.ok(files.has("README.md"));
  assert.ok(files.has("CHANGELOG.md"));
  assertPackedReadmeLinks(await fs.readFile(path.join(coreDir, "README.md"), "utf8"), pack.files, pack.name);
});

test("compat: cli npm pack dry-run contains metadata, license, executable, and schema", async () => {
  const pack = await npmPackDryRun(cliDir);
  const files = new Set(pack.files.map((entry) => entry.path));
  assert.equal(pack.name, "@tavojs/cli");
  assert.ok(files.has("package.json"));
  assert.ok(files.has("LICENSE"));
  assert.ok(files.has("README.md"));
  assert.ok(files.has("CHANGELOG.md"));
  assert.ok(files.has("dist/tavo.mjs"));
  assert.ok(files.has("generator-spec.schema.json"));
  assert.ok(files.has("schemas/protocol-v1.schema.json"));
  assert.ok(files.has("schemas/change-plan-v1.schema.json"));
  assert.ok(files.has("schemas/evaluation-result-v1.schema.json"));
  assert.ok(files.has("evals/corpus.mjs"));
  assert.ok(files.has("evals/live-runner.mjs"));

  const binary = pack.files.find((entry) => entry.path === "dist/tavo.mjs");
  assert.equal(binary?.mode, 0o755);
  assertPackedReadmeLinks(await fs.readFile(path.join(cliDir, "README.md"), "utf8"), pack.files, pack.name);
});
