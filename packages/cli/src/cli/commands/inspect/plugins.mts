import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import { createProtocolEnvelope } from "../../protocol/index.mjs";
import { collectPageRoutes } from "../../project/routes.mjs";
import type { CliFlags } from "../../types.mjs";
import { isJson, printJson } from "../../inspect/helpers.mjs";

type PluginDiagnostic = Record<string, unknown> & {
  code?: string;
  severity?: string;
  message?: string;
};

export type PluginGraphInspection = {
  valid: boolean;
  diagnostics: PluginDiagnostic[];
  plugins: unknown[];
  capabilities: unknown[];
  mounts: unknown[];
  middleware: unknown[];
  head: unknown[];
  endpoints: unknown[];
  permissions?: Array<{
    owner: string;
    name: string;
    required: boolean;
    reason: string;
  }>;
  exposure?: Array<{
    owner: string;
    target: string;
    from: string;
    to: string;
    reason: string;
  }>;
};

const EMPTY_INSPECTION: Omit<PluginGraphInspection, "valid" | "diagnostics"> = {
  plugins: [],
  capabilities: [],
  mounts: [],
  middleware: [],
  head: [],
  endpoints: [],
  permissions: [],
  exposure: [],
};

async function findPackageRoot(
  rootDir: string,
  packageName: string,
): Promise<string | null> {
  let current = path.resolve(rootDir);
  while (true) {
    const candidate = path.join(
      current,
      "node_modules",
      ...packageName.split("/"),
    );
    try {
      await fs.access(path.join(candidate, "package.json"));
      return candidate;
    } catch {}
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

async function resolvePackageExport(
  rootDir: string,
  packageName: string,
  exportName: string,
): Promise<string> {
  const packageRoot = await findPackageRoot(rootDir, packageName);
  if (!packageRoot) {
    throw new Error(`${packageName} is not installed in this project.`);
  }
  const packageJson = JSON.parse(
    await fs.readFile(path.join(packageRoot, "package.json"), "utf8"),
  ) as {
    exports?: Record<string, string | { import?: string; default?: string }>;
  };
  const entry = packageJson.exports?.[exportName];
  const relative =
    typeof entry === "string" ? entry : (entry?.import ?? entry?.default);
  if (!relative) {
    throw new Error(`${packageName} does not export ${exportName}.`);
  }
  return path.resolve(packageRoot, relative);
}

function unavailableInspection(error: unknown): PluginGraphInspection {
  return {
    valid: false,
    diagnostics: [
      {
        code: "plugin-preflight-unavailable",
        severity: "error",
        message: error instanceof Error ? error.message : String(error),
      },
    ],
    ...EMPTY_INSPECTION,
  };
}

export async function inspectProjectPlugins(
  rootDir: string,
): Promise<PluginGraphInspection> {
  try {
    const devEntry = await resolvePackageExport(
      rootDir,
      "@tavojs/core",
      "./dev",
    );
    const devModule = (await import(pathToFileURL(devEntry).href)) as {
      loadTavoConfig?: (
        rootDir: string,
      ) => Promise<{ pagesDir?: string; plugins?: unknown }>;
      inspectPluginGraph?: (
        config?: unknown,
        options?: { appRoutes?: readonly string[] },
      ) => PluginGraphInspection;
    };
    if (typeof devModule.loadTavoConfig !== "function") {
      throw new Error("@tavojs/core/dev does not export loadTavoConfig().");
    }
    if (typeof devModule.inspectPluginGraph !== "function") {
      throw new Error(
        "@tavojs/core/dev does not export inspectPluginGraph().",
      );
    }
    const config = await devModule.loadTavoConfig(rootDir);
    const appRoutes = (
      await collectPageRoutes(rootDir, config.pagesDir ?? "src/pages")
    ).map((route) => route.path);
    return devModule.inspectPluginGraph(config.plugins, { appRoutes });
  } catch (error) {
    return unavailableInspection(error);
  }
}

export function pluginDiagnosticsForCli(
  inspection: PluginGraphInspection,
): PluginDiagnostic[] {
  return inspection.diagnostics.map((diagnostic) => {
    const severity = diagnostic.severity;
    return {
      ...diagnostic,
      level: severity === "error" || severity === "fatal" ? "error" : "warning",
      message: diagnostic.message ?? "Plugin graph validation failed.",
    };
  });
}

export async function printPluginInspection(
  flags?: CliFlags,
): Promise<PluginGraphInspection> {
  const startedAt = performance.now();
  const inspection = await inspectProjectPlugins(process.cwd());
  const diagnostics = pluginDiagnosticsForCli(inspection);

  if (isJson(flags)) {
    printJson(
      createProtocolEnvelope({
        command: "inspect-plugins",
        data: inspection,
        diagnostics,
        ok: inspection.valid,
        fingerprintSource: inspection,
        startedAt,
      }),
    );
  } else {
    console.log(
      inspection.valid
        ? "Tavo.js plugin graph is valid."
        : "Tavo.js plugin graph is invalid.",
    );
    console.log(`Plugins:      ${inspection.plugins.length}`);
    console.log(`Capabilities: ${inspection.capabilities.length}`);
    console.log(`Mounts:       ${inspection.mounts.length}`);
    console.log(`Middleware:   ${inspection.middleware.length}`);
    console.log(`Endpoints:    ${inspection.endpoints.length}`);
    console.log(`Permissions:  ${inspection.permissions?.length ?? 0}`);
    for (const permission of inspection.permissions ?? []) {
      console.log(
        `  ${permission.owner} ${permission.name} (${permission.required ? "required" : "optional"})`,
      );
      console.log(`    ${permission.reason}`);
    }
    console.log(`Exposure:     ${inspection.exposure?.length ?? 0}`);
    for (const exposure of inspection.exposure ?? []) {
      console.log(
        `  ${exposure.owner} ${exposure.target} ${exposure.from} -> ${exposure.to}`,
      );
      console.log(`    ${exposure.reason}`);
    }
    for (const diagnostic of diagnostics) {
      console.log(
        `  ${String(diagnostic.level).toUpperCase()} ${diagnostic.code ?? "plugin"}: ${diagnostic.message}`,
      );
    }
  }

  if (!inspection.valid) process.exitCode = 1;
  return inspection;
}
