import path from "node:path";
import { performance } from "node:perf_hooks";
import { BUILD_DIR, GENERATED_DIR } from "../constants.mjs";
import {
  collectProjectDiagnostics,
  runTypecheckIfAvailable,
} from "../inspect/diagnostics.mjs";
import { applyFix, printFixDryRun } from "../inspect/fixes.mjs";
import { inspectRouteFiles, isJson, printJson } from "../inspect/helpers.mjs";
import { collectProjectInventory } from "../inspect/inventory.mjs";
import type { FixOperation, ProjectDiagnostic } from "../inspect/types.mjs";
import { readPagesDirFromConfig } from "../project/config.mjs";
import { collectPageRoutes } from "../project/routes.mjs";
import { createProtocolEnvelope } from "../protocol/index.mjs";
import type { CliFlags } from "../types.mjs";
import { pad } from "../utils/format.mjs";
import { toPosixPath } from "../utils/path.mjs";
import { getProjectInfoPayload } from "./inspect/shared.mjs";

export {
  getAgentContextPayload,
  printAgentContext,
  printTargetInspection,
} from "./inspect/context.mjs";
export { verifyProject } from "./inspect/verification.mjs";
export { printPluginInspection } from "./inspect/plugins.mjs";

export async function printRoutes(flags?: CliFlags): Promise<void> {
  const startedAt = performance.now();
  const rootDir = process.cwd();
  const pagesDir = await readPagesDirFromConfig(rootDir);
  const routes = await collectPageRoutes(rootDir, pagesDir);
  if (isJson(flags)) {
    const data = { pagesDir, routes: inspectRouteFiles(rootDir, routes) };
    printJson(
      createProtocolEnvelope({
        command: "routes",
        data,
        fingerprintSource: data.routes,
        startedAt,
      }),
    );
    return;
  }
  if (routes.length === 0) {
    console.log(`No pages found in ${pagesDir}`);
    return;
  }

  console.log(`Routes from ${pagesDir}:`);
  for (const route of routes) {
    console.log(
      `  ${pad(route.path, 24)} ${toPosixPath(path.relative(rootDir, route.file))}`,
    );
  }
}

export async function printProjectInfo(flags?: CliFlags): Promise<void> {
  const startedAt = performance.now();
  const rootDir = process.cwd();
  const payload = await getProjectInfoPayload(rootDir);
  if (isJson(flags)) {
    const portable = {
      ...payload,
      root: ".",
      generatedDir: GENERATED_DIR,
      buildDir: BUILD_DIR,
    };
    printJson(
      createProtocolEnvelope({
        command: "info",
        data: portable,
        fingerprintSource: portable,
        startedAt,
      }),
    );
    return;
  }

  console.log("Tavo.js project info");
  console.log("");
  console.log(`Root:            ${payload.root}`);
  console.log(`Package manager: ${payload.packageManager}`);
  console.log(`Pages dir:       ${payload.pagesDir}`);
  console.log(`Routes:          ${payload.routesCount}`);
  console.log(`SSR entry:       ${payload.ssrEntry ?? "not found"}`);
  console.log(`Generated dir:   ${payload.generatedDir}`);
  console.log(`Build dir:       ${payload.buildDir}`);
  console.log(`CSS entries:     ${payload.cssEntries.join(", ")}`);
}

export async function printInventory(flags?: CliFlags): Promise<void> {
  const startedAt = performance.now();
  const payload = await collectProjectInventory(process.cwd());
  if (isJson(flags)) {
    printJson(
      createProtocolEnvelope({
        command: "inventory",
        data: payload,
        fingerprintSource: payload.publicExports,
        startedAt,
      }),
    );
    return;
  }

  console.log("Tavo.js inventory");
  console.log("");
  console.log(`Pages:      ${payload.pages.length}`);
  console.log(`Layouts:    ${payload.layouts.length}`);
  console.log(`Components: ${payload.components.length}`);
  console.log(`Stores:     ${payload.stores.length}`);
  console.log(`Actions:    ${payload.actions.length}`);
  console.log("Use `tavo inventory --json` for machine-readable output.");
}

async function applyDoctorFixes(
  rootDir: string,
  diagnostics: ProjectDiagnostic[],
) {
  const applied: Array<{
    code: string;
    file?: string;
    operation: FixOperation;
  }> = [];
  const skipped: Array<{
    code: string;
    file?: string;
    reason: string;
    operation?: FixOperation;
  }> = [];
  for (const diagnostic of diagnostics) {
    if (!diagnostic.fix) {
      skipped.push({
        code: diagnostic.code,
        file: diagnostic.file,
        reason: "no-fix",
      });
      continue;
    }
    const result = await applyFix(rootDir, diagnostic.fix);
    if (result.applied) {
      applied.push({
        code: diagnostic.code,
        file: diagnostic.file,
        operation: diagnostic.fix,
      });
    } else {
      skipped.push({
        code: diagnostic.code,
        file: diagnostic.file,
        reason: result.reason ?? "not-applied",
        operation: diagnostic.fix,
      });
    }
  }
  return { applied, skipped };
}

export async function printDoctor(
  flags?: CliFlags,
): Promise<ProjectDiagnostic[]> {
  const startedAt = performance.now();
  const rootDir = process.cwd();
  const diagnostics = await collectProjectDiagnostics(rootDir);
  if (flags?.["fix-dry-run"]) {
    if (isJson(flags)) {
      const data = {
        fixes: diagnostics
          .filter((diagnostic) => diagnostic.fix?.risk === "low")
          .map((diagnostic) => ({
            code: diagnostic.code,
            file: diagnostic.file,
            kind: diagnostic.fix?.kind,
            precondition:
              diagnostic.fix?.kind === "create-file" ? "missing" : "sha256",
          })),
      };
      printJson(
        createProtocolEnvelope({
          command: "doctor",
          data,
          diagnostics,
          fingerprintSource: diagnostics,
          startedAt,
        }),
      );
    } else {
      printFixDryRun(diagnostics);
    }
    return diagnostics;
  }

  if (flags?.fix) {
    const { applied, skipped } = await applyDoctorFixes(rootDir, diagnostics);
    const finalDiagnostics = await collectProjectDiagnostics(rootDir);
    const ok = finalDiagnostics.every(
      (diagnostic) => diagnostic.level !== "error",
    );
    if (isJson(flags)) {
      printJson(
        createProtocolEnvelope({
          command: "doctor",
          data: { appliedFixes: applied, skippedFixes: skipped },
          diagnostics: finalDiagnostics,
          ok,
          fingerprintSource: finalDiagnostics,
          startedAt,
        }),
      );
    } else {
      console.log(
        `Tavo.js doctor applied ${applied.length} fix${applied.length === 1 ? "" : "es"}.`,
      );
      if (skipped.length > 0) {
        console.log(
          `Skipped ${skipped.length} fix${skipped.length === 1 ? "" : "es"}.`,
        );
      }
    }
    return finalDiagnostics;
  }

  if (isJson(flags)) {
    printJson(
      createProtocolEnvelope({
        command: "doctor",
        data: {},
        diagnostics,
        fingerprintSource: diagnostics,
        startedAt,
      }),
    );
    return diagnostics;
  }
  if (diagnostics.length === 0) {
    console.log("Tavo.js doctor: no issues found.");
    return diagnostics;
  }
  console.log("Tavo.js doctor diagnostics:");
  for (const diagnostic of diagnostics) {
    console.log(
      `  ${diagnostic.level.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`,
    );
  }
  return diagnostics;
}

export async function checkProject(
  flags?: CliFlags,
): Promise<ProjectDiagnostic[]> {
  const startedAt = performance.now();
  const diagnostics = [
    ...(await collectProjectDiagnostics(process.cwd())),
    ...(await runTypecheckIfAvailable(process.cwd())),
  ];
  const ok = diagnostics.every((diagnostic) => diagnostic.level !== "error");
  if (isJson(flags)) {
    printJson(
      createProtocolEnvelope({
        command: "check",
        data: {},
        diagnostics,
        ok,
        fingerprintSource: diagnostics,
        startedAt,
      }),
    );
  } else {
    console.log(
      ok
        ? diagnostics.length === 0
          ? "Tavo.js check passed."
          : "Tavo.js check passed with warnings."
        : "Tavo.js check failed.",
    );
    for (const diagnostic of diagnostics) {
      console.log(
        `  ${diagnostic.level.toUpperCase()} ${diagnostic.code}: ${diagnostic.message}`,
      );
    }
  }
  if (!ok) process.exitCode = 1;
  return diagnostics;
}
