import fs from "node:fs/promises";
import path from "node:path";
import { inspectPluginGraph } from "@tavojs/core/dev";
import { ARTIFACT_SCHEMA_VERSION, BUILD_DIR, GENERATED_DIR } from "../constants.mjs";
import {
  loadProjectConfig,
  loadViteFromProjectRoot,
  readBuildBudgetsFromConfig,
  readCssEntriesFromConfig,
  readPagesDirFromConfig,
  readPrerenderStyleModeFromConfig
} from "../project/config.mjs";
import { collectPageRoutes, collectTrailingSlashLinkDiagnostics, generateRouteArtifacts } from "../project/routes.mjs";
import type {
  BuildFlags,
  BuildReport,
  ClientAssetPlan,
  ViteBuildResult,
  ViteManifestEntry
} from "../types.mjs";
import { fileExists } from "../utils/fs.mjs";
import { toPosixPath } from "../utils/path.mjs";
import {
  BUILD_CONFIG_GLOBAL_KEY,
  createPreviewServerSource,
  createSsrEntrySource,
} from "../build/templates.mjs";
import {
  createRouteBuildReport,
  normalizeBuildOutputs,
  printRouteBuildReport,
  validateBuildBudgets
} from "../build/report.mjs";
import {
  readRouteBuildModes,
  safeOutputPathSegments,
  writePrerenderedStaticPages
} from "../build/prerender.mjs";
import { isSsrPreviewBuildStale } from "../build/stale.mjs";
import { parseByteSize } from "../utils/format.mjs";

export { isSsrPreviewBuildStale, safeOutputPathSegments };

async function resolveExistingCssEntries(rootDir: string, entries: string[]): Promise<string[]> {
  const result: string[] = [];
  for (const entry of entries) {
    const absolute = path.join(rootDir, entry);
    if (await fileExists(absolute)) {
      result.push(entry);
    }
  }
  return result;
}

function normalizeManifestModuleKey(key: string): string {
  return `/${key.replace(/^\/+/, "")}`;
}

function collectManifestCss(
  manifest: Record<string, ViteManifestEntry>,
  key: string,
  visited = new Set<string>()
): string[] {
  if (visited.has(key)) return [];
  visited.add(key);
  const entry = manifest[key];
  if (!entry) return [];
  return [
    ...(entry.imports ?? []).flatMap((dependency) => collectManifestCss(manifest, dependency, visited)),
    ...(entry.css ?? [])
  ];
}

export function createClientAssetPlan(
  manifest: Record<string, ViteManifestEntry>,
  ssrManifest: Record<string, string[]> = {}
): ClientAssetPlan {
  const entryKey = manifest["index.html"]
    ? "index.html"
    : manifest["src/main.tsx"]
      ? "src/main.tsx"
      : Object.entries(manifest).find(([, item]) => item?.isEntry)?.[0];
  const entry = entryKey ? manifest[entryKey] : undefined;
  const sharedCss = Array.from(new Set(entry?.css ?? []));
  const sharedCssSet = new Set(sharedCss);
  const moduleCss: Record<string, string[]> = {};

  for (const [key, item] of Object.entries(manifest)) {
    if (key === entryKey || item.isEntry || !item.isDynamicEntry) continue;
    const sourceKey = normalizeManifestModuleKey(item.src ?? key);
    const css = collectManifestCss(manifest, key).filter((file) => !sharedCssSet.has(file));
    const ssrCss = (ssrManifest[item.src ?? key] ?? ssrManifest[key] ?? [])
      .map((file) => file.replace(/^\/+/, ""))
      .filter((file) => file.endsWith(".css") && !sharedCssSet.has(file));
    const combined = Array.from(new Set([...css, ...ssrCss]));
    if (combined.length > 0) moduleCss[sourceKey] = combined;
  }

  return {
    sharedCss,
    clientEntryScript: entry?.file ?? "",
    moduleCss
  };
}

async function readClientAssetPlan(clientDir: string): Promise<ClientAssetPlan> {
  const manifestFile = path.join(clientDir, ".vite", "manifest.json");
  if (!(await fileExists(manifestFile))) {
    return { sharedCss: [], clientEntryScript: "", moduleCss: {} };
  }

  const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8")) as Record<string, ViteManifestEntry>;
  const ssrManifestFile = path.join(clientDir, ".vite", "ssr-manifest.json");
  const ssrManifest = (await fileExists(ssrManifestFile))
    ? JSON.parse(await fs.readFile(ssrManifestFile, "utf8")) as Record<string, string[]>
    : {};
  return createClientAssetPlan(manifest, ssrManifest);
}

async function writeProductionSsrFiles({
  rootDir,
  buildRoot,
  pagesDir,
  cssEntries,
  vite,
  routes,
  endpoints,
  trailingSlash,
}: {
  rootDir: string;
  buildRoot: string;
  pagesDir: string;
  cssEntries: string[];
  vite: typeof import("vite");
  routes: readonly { path: string }[];
  endpoints: readonly {
    methods: readonly string[];
    kind: "exact" | "subtree";
    path: string;
  }[];
  trailingSlash: "always" | "never" | "preserve";
}): Promise<void> {
  const serverDir = path.join(buildRoot, "server");
  await fs.mkdir(serverDir, { recursive: true });
  const clientDir = path.join(buildRoot, "client");
  const generatedRoot = path.join(rootDir, GENERATED_DIR);
  await fs.mkdir(generatedRoot, { recursive: true });

  const generatedEntryFile = path.join(generatedRoot, "ssr-entry.mjs");
  const assetPlan = await readClientAssetPlan(clientDir);
  await fs.writeFile(generatedEntryFile, createSsrEntrySource({ pagesDir, assetPlan }), "utf8");

  await vite.build({
    root: rootDir,
    build: {
      ssr: generatedEntryFile,
      outDir: path.relative(rootDir, serverDir),
      emptyOutDir: true,
      minify: false,
      rollupOptions: {
        output: {
          entryFileNames: "entry.mjs",
          chunkFileNames: "chunks/[name]-[hash].mjs",
          assetFileNames: "assets/[name]-[hash][extname]"
        }
      }
    }
  });

  await fs.writeFile(
    path.join(serverDir, "start.mjs"),
    createPreviewServerSource({
      routes: routes.map((route) => route.path),
      endpoints,
      trailingSlash,
    }),
    "utf8",
  );

  await fs.writeFile(
    path.join(buildRoot, "build-manifest.json"),
    `${JSON.stringify(
      {
        schemaVersion: ARTIFACT_SCHEMA_VERSION,
        generatedAt: new Date().toISOString(),
        clientDir: "client",
        serverDir: "server",
        pagesDir: toPosixPath(pagesDir),
        cssEntries,
        deployment: {
          node: { start: "server/start.mjs", entry: "server/entry.mjs" }
        }
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

export async function buildWithRouteReport(flags: BuildFlags = {}): Promise<void> {
  const rootDir = process.cwd();
  const vite = await loadViteFromProjectRoot(rootDir);
  const projectConfig = await loadProjectConfig(rootDir);
  const pagesDir = await readPagesDirFromConfig(rootDir);
  const cssEntries = await readCssEntriesFromConfig(rootDir);
  const configuredBudgets = await readBuildBudgetsFromConfig(rootDir);
  const configuredPrerenderStyleMode = await readPrerenderStyleModeFromConfig(rootDir);
  const requestedPrerenderStyleMode = flags["prerender-styles"];
  if (
    requestedPrerenderStyleMode !== undefined &&
    requestedPrerenderStyleMode !== "inline" &&
    requestedPrerenderStyleMode !== "external"
  ) {
    throw new Error("tavo build: --prerender-styles must be inline or external");
  }
  const prerenderStyleMode = typeof requestedPrerenderStyleMode === "string"
    ? requestedPrerenderStyleMode
    : configuredPrerenderStyleMode;
  const resolvedCssEntries = await resolveExistingCssEntries(rootDir, cssEntries);
  const hasServerEntry = await fileExists(path.join(rootDir, "server.mjs"));
  const buildRoot = path.join(rootDir, BUILD_DIR);
  await fs.mkdir(buildRoot, { recursive: true });

  const clientResult = (await vite.build({
    root: rootDir,
    build: {
      outDir: path.relative(rootDir, path.join(buildRoot, "client")),
      manifest: true,
      ssrManifest: true
    }
  })) as ViteBuildResult;

  const routes = await collectPageRoutes(rootDir, pagesDir);
  const pluginGraph = inspectPluginGraph(projectConfig.plugins, {
    appRoutes: routes.map((route) => route.path),
  });
  const linkDiagnostics = await collectTrailingSlashLinkDiagnostics(
    rootDir,
    routes,
    projectConfig.routing?.trailingSlash ?? "preserve",
  );
  await generateRouteArtifacts(
    rootDir,
    routes,
    projectConfig.routing?.trailingSlash ?? "preserve",
  );
  await writeProductionSsrFiles({
    rootDir,
    buildRoot,
    pagesDir,
    cssEntries: resolvedCssEntries,
    vite,
    routes,
    endpoints: pluginGraph.endpoints,
    trailingSlash: projectConfig.routing?.trailingSlash ?? "preserve",
  });
  const buildConfigKey = Symbol.for(BUILD_CONFIG_GLOBAL_KEY);
  const buildGlobal = globalThis as typeof globalThis & {
    [buildConfigKey]?: unknown;
  };
  const previousBuildConfig = buildGlobal[buildConfigKey];
  let routeModes: Map<string, string>;
  let prerender: Awaited<ReturnType<typeof writePrerenderedStaticPages>>;
  buildGlobal[buildConfigKey] = projectConfig;
  try {
    routeModes = await readRouteBuildModes(buildRoot);
    prerender = await writePrerenderedStaticPages({
      rootDir,
      buildRoot,
      styleMode: prerenderStyleMode,
      routes,
      trailingSlash: projectConfig.routing?.trailingSlash ?? "preserve",
      endpoints: pluginGraph.endpoints,
    });
  } finally {
    if (previousBuildConfig === undefined) {
      delete buildGlobal[buildConfigKey];
    } else {
      buildGlobal[buildConfigKey] = previousBuildConfig;
    }
  }

  const report = createRouteBuildReport({
    outputs: normalizeBuildOutputs(clientResult),
    routes,
    hasServerEntry,
    routeModes
  });

  printRouteBuildReport(report);
  const firstLoadBudget = parseByteSize(
    typeof flags["max-first-load-js"] === "string"
      ? flags["max-first-load-js"]
      : configuredBudgets.firstLoadJs
  );
  const routeBudget = parseByteSize(
    typeof flags["max-route-js"] === "string"
      ? flags["max-route-js"]
      : configuredBudgets.routeJs
  );
  const budgetViolations = validateBuildBudgets(report, {
    firstLoadJs: firstLoadBudget,
    routeJs: routeBudget
  });
  if (flags["report-json"]) {
    const reportFile = await writeBuildReportJson(rootDir, report);
    console.log(`Build report JSON: ${path.relative(rootDir, reportFile)}`);
  }
  console.log("");
  console.log(`Generated route manifest: ${path.join(GENERATED_DIR, "route-manifest.json")}`);
  console.log(`Generated route types: ${path.join(GENERATED_DIR, "routes.d.ts")}`);
  console.log(`Prerendered static pages: ${prerender.count}`);
  console.log(`Prerendered styles: ${prerenderStyleMode}`);
  for (const diagnostic of prerender.diagnostics) {
    console.warn(`Prerender warning: ${diagnostic}`);
  }
  for (const diagnostic of linkDiagnostics) {
    console.warn(`Routing warning: ${diagnostic}`);
  }
  if (budgetViolations.length > 0) {
    throw new Error(
      `tavo build: JavaScript budgets exceeded:\n${budgetViolations.map((violation) => `- ${violation}`).join("\n")}`
    );
  }
  console.log(`Production SSR build: ${BUILD_DIR}`);
}

export async function writeBuildReportJson(rootDir: string, report: BuildReport): Promise<string> {
  const generatedDir = path.join(rootDir, GENERATED_DIR);
  await fs.mkdir(generatedDir, { recursive: true });
  const target = path.join(generatedDir, "build-report.json");
  await fs.writeFile(
    target,
    `${JSON.stringify({
      schemaVersion: ARTIFACT_SCHEMA_VERSION,
      generatedAt: new Date().toISOString(),
      rows: report.rows,
      routes: report.rows.map((row) => ({
        route: row.route,
        mode: row.mode ?? null,
        symbol: row.symbol,
        size: row.size,
        firstLoadJs: row.firstLoadJs
      }))
    }, null, 2)}\n`,
    "utf8"
  );
  return target;
}
