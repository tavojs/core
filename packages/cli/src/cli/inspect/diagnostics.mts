import path from "node:path";
import { ARTIFACT_SCHEMA_VERSION, GENERATED_DIR } from "../constants.mjs";
import { readCssEntriesFromConfig, readPagesDirFromConfig } from "../project/config.mjs";
import { collectPageRoutes } from "../project/routes.mjs";
import { fileExists } from "../utils/fs.mjs";
import { toPosixPath } from "../utils/path.mjs";
import { analyzeProjectFile } from "./analysis.mjs";
import { createBootstrapSource, createEmptyCssSource } from "./fixes.mjs";
import {
  enrichDiagnostic,
  findLine,
  hasInvalidRouteSegment,
  hasTavoConfig,
  listPageFiles,
  readFileSafe,
  readPackageJson,
  routePatternFromPageRelative,
  sourceRangeFromLine
} from "./helpers.mjs";
import type { ProjectDiagnostic } from "./types.mjs";

export async function collectProjectDiagnostics(rootDir: string): Promise<ProjectDiagnostic[]> {
  const diagnostics: ProjectDiagnostic[] = [];
  const pagesDir = await readPagesDirFromConfig(rootDir);
  const pagesRoot = path.join(rootDir, pagesDir);
  const cssEntries = await readCssEntriesFromConfig(rootDir);
  const routes = await collectPageRoutes(rootDir, pagesDir);

  if (!(await fileExists(path.join(rootDir, "package.json")))) {
    diagnostics.push({
      code: "missing-package-json",
      level: "error",
      message: "No package.json found in the project root.",
      suggestedFix: "Run `tavo create app <dir>` or add a package.json before using Tavo.js project commands.",
      docs: "docs/getting-started.md"
    });
  }

  if (!(await fileExists(pagesRoot))) {
    diagnostics.push({
      code: "missing-pages-dir",
      level: "error",
      message: `Pages directory not found: ${pagesDir}.`,
      suggestedFix: `Create ${pagesDir} or update pagesDir in tavo.config.ts.`,
      docs: "docs/routing-and-pages.md",
      commands: ["tavo generate page index"]
    });
  }

  if (await hasTavoConfig(rootDir)) {
    for (const entry of cssEntries) {
      if (!(await fileExists(path.join(rootDir, entry)))) {
        diagnostics.push({
          code: "missing-css-entry",
          level: "warning",
          message: `Configured CSS entry was not found: ${entry}.`,
          file: entry,
          suggestedFix: `Create ${entry} or remove it from cssEntries in tavo.config.ts.`,
          docs: "docs/styling.md",
          fix: {
            kind: "create-file",
            file: entry,
            content: createEmptyCssSource(),
            risk: "low"
          }
        });
      }
    }
  }

  const mainTsxExists = await fileExists(path.join(rootDir, "src/main.tsx"));
  const mainJsxExists = await fileExists(path.join(rootDir, "src/main.jsx"));
  const mainSource = await readFileSafe(path.join(rootDir, "src/main.tsx")) ?? await readFileSafe(path.join(rootDir, "src/main.jsx"));
  if (!mainSource || !mainSource.includes("bootTavo")) {
    diagnostics.push({
      code: "missing-bootstrap",
      level: "warning",
      message: "Expected src/main.tsx or src/main.jsx to bootstrap the app with bootTavo().",
      file: "src/main.tsx",
      suggestedFix: "Import bootTavo from @tavojs/core and call void bootTavo().",
      docs: "docs/getting-started.md",
      fix: !mainTsxExists && !mainJsxExists
        ? {
            kind: "create-file",
            file: "src/main.tsx",
            content: createBootstrapSource(),
            risk: "low"
          }
        : {
            kind: "manual",
            risk: "manual"
          }
    });
  }

  for (const file of await listPageFiles(rootDir, pagesDir)) {
    const relative = toPosixPath(path.relative(path.join(rootDir, pagesDir), file));
    const segments = relative.replace(/\.[^.]+$/, "").split("/");
    const fileStem = path.basename(relative).replace(/\.[^.]+$/, "");
    const isSpecialPageFile = fileStem === "_layout" || fileStem === "_error" || fileStem === "404";
    if (segments.some(hasInvalidRouteSegment)) {
      diagnostics.push({
        code: "invalid-route-segment",
        level: "error",
        message: `Route file contains an invalid bracket segment: ${relative}.`,
        file: toPosixPath(path.relative(rootDir, file)),
        suggestedFix: "Use [id], [[id]], [...all], or [[...slug]] for dynamic route segments.",
        docs: "docs/routing-and-pages.md"
      });
    }

    const analyzed = await analyzeProjectFile(file);
    const source = analyzed?.source;
    const analysis = analyzed?.analysis;
    const fileRelative = toPosixPath(path.relative(rootDir, file));
    if (
      source &&
      /render\s*:\s*["']csr["']/.test(source) &&
      (
        /\bprerender\s*(?::|=)/.test(source) ||
        /\bstatic\s*:/.test(source) ||
        /\brevalidate\s*(?::|=)/.test(source) ||
        /\bgenerateStaticParams\s*[:(=]/.test(source)
      )
    ) {
      diagnostics.push({
        code: "csr-static-options",
        level: "warning",
        message: "CSR routes ignore static, revalidate, vary, and generateStaticParams options.",
        file: fileRelative,
        line: findLine(source, /render\s*:\s*["']csr["']/),
        suggestedFix: "Remove static rendering options from this CSR page, or remove render: \"csr\" to use server rendering.",
        docs: "docs/ssr-and-hydration.md"
      });
    }

    if (source && analysis?.hasPageLoadContextReference && !analysis.hasPageLoadContextImport) {
      const importFix = analysis.coreImportFix;
      diagnostics.push({
        code: "missing-page-load-context-import",
        level: "error",
        message: "PageLoadContext is referenced but not imported from @tavojs/core.",
        file: fileRelative,
        line: findLine(source, "PageLoadContext"),
        suggestedFix: "Add `type PageLoadContext` to an @tavojs/core import.",
        docs: "docs/agent-codegen.md",
        fix: importFix
          ? {
              kind: "update-import",
              file: fileRelative,
              before: importFix.before,
              after: importFix.after,
              risk: "low"
            }
          : {
              kind: "manual",
              risk: "manual"
            }
      });
    }

    if (source && analysis?.browserApiInLoadLine) {
      diagnostics.push({
        code: "browser-api-in-loader",
        level: "warning",
        message: "Route files with loaders should keep browser-only APIs out of loader/server code.",
        file: fileRelative,
        line: analysis.browserApiInLoadLine,
        sourceRange: sourceRangeFromLine(analysis.browserApiInLoadLine),
        suggestedFix: "Move browser-only code into a createTavo controller lifecycle method or a client-only event handler.",
        docs: "docs/agent-codegen.md"
      });
    }

    if (source && analysis?.reactApiLine) {
      diagnostics.push({
        code: "react-api-in-tavo-component",
        level: "warning",
        message: "Tavo.js components should use controllers, stores, refs, and lifecycle methods instead of React imports or hooks.",
        file: fileRelative,
        line: analysis.reactApiLine,
        sourceRange: sourceRangeFromLine(analysis.reactApiLine),
        suggestedFix: "Replace React hook state/effects with createTavo model/controller logic.",
        docs: "docs/mvc-components.md"
      });
    }

    const declaredRoute = analysis?.defineRoutePageArg;
    const expectedRoute = routePatternFromPageRelative(relative);
    if (!isSpecialPageFile && declaredRoute && declaredRoute !== expectedRoute) {
      const before = analysis?.defineRoutePageCallText;
      const after = before?.replace(/(["'`])[^"'`]+\1$/, JSON.stringify(expectedRoute));
      diagnostics.push({
        code: "route-pattern-mismatch",
        level: "error",
        message: `defineRoutePage route pattern ${declaredRoute} does not match file route ${expectedRoute}.`,
        file: fileRelative,
        line: analysis?.defineRoutePageLine,
        sourceRange: sourceRangeFromLine(analysis?.defineRoutePageLine),
        suggestedFix: `Change the first defineRoutePage argument to ${JSON.stringify(expectedRoute)}.`,
        docs: "docs/routing-and-pages.md",
        fix: before && after
          ? {
              kind: "replace-text",
              file: fileRelative,
              before,
              after,
              risk: "low"
            }
          : {
              kind: "manual",
              risk: "manual"
            }
      });
    }
  }

  const manifestSource = await readFileSafe(path.join(rootDir, GENERATED_DIR, "route-manifest.json"));
  if (manifestSource) {
    try {
      const manifest = JSON.parse(manifestSource) as {
        schemaVersion?: number;
        routes?: Array<{ path?: string; file?: string }>;
      };
      if (manifest.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
        diagnostics.push({
          code: "incompatible-route-manifest",
          level: "warning",
          message: `Generated route manifest schema ${String(manifest.schemaVersion ?? "missing")} is incompatible with schema ${ARTIFACT_SCHEMA_VERSION}.`,
          file: `${GENERATED_DIR}/route-manifest.json`,
          suggestedFix: "Run `tavo build` with the installed CLI to regenerate compatible artifacts.",
          commands: ["tavo build"],
          fix: {
            kind: "run-command",
            command: "tavo build:routes",
            risk: "low"
          }
        });
      }
      const current = new Map(routes.map((route) => [toPosixPath(path.relative(rootDir, route.file)), route.path]));
      const generated = manifest.routes ?? [];
      if (generated.length !== routes.length || generated.some((route) => !route.file || current.get(route.file) !== route.path)) {
        diagnostics.push({
          code: "stale-route-artifacts",
          level: "warning",
          message: `Generated route artifacts are stale. Run tavo build or tavo check after route changes.`,
          file: `${GENERATED_DIR}/route-manifest.json`,
          suggestedFix: "Run `tavo build` to refresh generated route artifacts.",
          commands: ["tavo build"],
          fix: {
            kind: "run-command",
            command: "tavo build:routes",
            risk: "low"
          }
        });
      }
    } catch {
      diagnostics.push({
        code: "invalid-route-manifest",
        level: "warning",
        message: "Generated route manifest is not valid JSON.",
        file: `${GENERATED_DIR}/route-manifest.json`,
        suggestedFix: "Delete the invalid generated manifest and run `tavo build`.",
        commands: ["tavo build"],
        fix: {
          kind: "run-command",
          command: "tavo build:routes",
          risk: "low"
        }
      });
    }
  }

  return diagnostics.map(enrichDiagnostic);
}

export async function collectSmokeDiagnostics(rootDir: string): Promise<ProjectDiagnostic[]> {
  const pagesDir = await readPagesDirFromConfig(rootDir);
  const routes = await collectPageRoutes(rootDir, pagesDir);
  const diagnostics: ProjectDiagnostic[] = [];
  for (const route of routes) {
    const analyzed = await analyzeProjectFile(route.file);
    const fileRelative = toPosixPath(path.relative(rootDir, route.file));
    if (!analyzed) {
      continue;
    }
    for (const parseDiagnostic of analyzed.analysis.parseDiagnostics) {
      diagnostics.push({
        code: "route-parse-error",
        level: "error",
        category: "runtime-smoke",
        confidence: "high",
        safeToAutoFix: false,
        message: `Route ${route.path} could not be parsed: ${parseDiagnostic.message}`,
        file: fileRelative,
        line: parseDiagnostic.line,
        sourceRange: parseDiagnostic.sourceRange,
        suggestedFix: "Fix the TSX syntax error before running or building the route.",
        docs: "docs/agent-codegen.md"
      });
    }
    if (!analyzed.analysis.hasDefaultExport) {
      diagnostics.push({
        code: "route-missing-default-export",
        level: "error",
        category: "runtime-smoke",
        confidence: "high",
        safeToAutoFix: false,
        message: `Route ${route.path} is missing a default page export.`,
        file: fileRelative,
        suggestedFix: "Export a default page function or component.",
        docs: "docs/routing-and-pages.md"
      });
    }
    if (analyzed.analysis.topLevelThrowLine) {
      diagnostics.push({
        code: "route-top-level-throw",
        level: "error",
        category: "runtime-smoke",
        confidence: "medium",
        safeToAutoFix: false,
        message: `Route ${route.path} contains a top-level throw that will fail module evaluation.`,
        file: fileRelative,
        line: analyzed.analysis.topLevelThrowLine,
        sourceRange: sourceRangeFromLine(analyzed.analysis.topLevelThrowLine),
        suggestedFix: "Move test failures into explicit error boundaries or remove the top-level throw.",
        docs: "docs/routing-and-pages.md"
      });
    }
  }
  return diagnostics.map(enrichDiagnostic);
}

export async function runTypecheckIfAvailable(rootDir: string): Promise<ProjectDiagnostic[]> {
  const pkg = await readPackageJson(rootDir);
  const scripts = pkg?.scripts && typeof pkg.scripts === "object" ? pkg.scripts as Record<string, unknown> : {};
  if (typeof scripts.typecheck !== "string") {
    return [];
  }
  const hasTypescript =
    await fileExists(path.join(rootDir, "node_modules", "typescript", "package.json")) ||
    await fileExists(path.join(rootDir, "node_modules", ".bin", "tsc"));
  if (!hasTypescript) {
    const diagnostics: ProjectDiagnostic[] = [
      {
        code: "typecheck-skipped",
        level: "warning",
        message: "Skipped typecheck because local TypeScript dependencies are not installed.",
        suggestedFix: "Install project dependencies before relying on typecheck diagnostics.",
        commands: ["npm install"]
      }
    ];
    return diagnostics.map(enrichDiagnostic);
  }

  const { runPackageScript } = await import("../process.mjs");
  try {
    await runPackageScript("typecheck", { cwd: rootDir });
    return [];
  } catch (error) {
    const diagnostics: ProjectDiagnostic[] = [
      {
        code: "typecheck-failed",
        level: "error",
        message: error instanceof Error ? error.message : String(error),
        suggestedFix: "Fix TypeScript diagnostics, then rerun `tavo check`.",
        commands: ["tavo check"]
      }
    ];
    return diagnostics.map(enrichDiagnostic);
  }
}
