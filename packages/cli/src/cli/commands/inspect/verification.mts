import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { analyzeProjectFile } from "../../inspect/analysis.mjs";
import {
  collectProjectDiagnostics,
  collectSmokeDiagnostics,
  runTypecheckIfAvailable,
} from "../../inspect/diagnostics.mjs";
import {
  inspectRouteFiles,
  isJson,
  printJson,
} from "../../inspect/helpers.mjs";
import { collectProjectInventory } from "../../inspect/inventory.mjs";
import type { ProjectDiagnostic } from "../../inspect/types.mjs";
import { readPagesDirFromConfig } from "../../project/config.mjs";
import { collectPageRoutes } from "../../project/routes.mjs";
import { createProtocolEnvelope } from "../../protocol/index.mjs";
import type { CliFlags } from "../../types.mjs";
import { toPosixPath } from "../../utils/path.mjs";
import { inspectProjectPlugins, pluginDiagnosticsForCli } from "./plugins.mjs";

function withoutExtension(file: string): string {
  return file.replace(/\.[^.]+$/, "");
}

function resolveKnownImport(
  known: string[],
  importer: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith(".")) return null;
  const base = toPosixPath(
    path.normalize(path.join(path.dirname(importer), specifier)),
  );
  return (
    known.find(
      (file) =>
        withoutExtension(file) === withoutExtension(base) ||
        withoutExtension(file) === `${withoutExtension(base)}/index`,
    ) ?? null
  );
}

async function buildDependentFileMap(
  rootDir: string,
  known: string[],
): Promise<Map<string, Set<string>>> {
  const dependents = new Map<string, Set<string>>();
  for (const importer of known) {
    const analyzed = await analyzeProjectFile(path.join(rootDir, importer));
    for (const imported of analyzed?.analysis.imports ?? []) {
      const target = resolveKnownImport(known, importer, imported.module);
      if (!target) continue;
      const group = dependents.get(target) ?? new Set<string>();
      group.add(importer);
      dependents.set(target, group);
    }
  }
  return dependents;
}

async function expandVerificationFiles(
  rootDir: string,
  selectedFiles: string[],
): Promise<string[]> {
  if (selectedFiles.length === 0) return [];
  const inventory = await collectProjectInventory(rootDir);
  const known = Object.keys(inventory.publicExports);
  const dependents = await buildDependentFileMap(rootDir, known);
  for (const route of inventory.pages) {
    for (const layer of route.files) {
      const group = dependents.get(layer) ?? new Set<string>();
      group.add(route.file);
      dependents.set(layer, group);
    }
  }

  const expanded = new Set(selectedFiles);
  const queue = [...selectedFiles];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const dependent of dependents.get(current) ?? []) {
      if (expanded.has(dependent)) continue;
      expanded.add(dependent);
      queue.push(dependent);
    }
  }
  return Array.from(expanded).sort();
}

function parseSelectedFiles(files: unknown): string[] {
  if (typeof files !== "string") return [];
  return files
    .split(",")
    .map((file) => file.trim().replace(/\\/g, "/"))
    .filter(Boolean);
}

async function readReceiptFiles(
  rootDir: string,
  receipt: string,
): Promise<string[]> {
  if (path.isAbsolute(receipt) || receipt.split(/[\\/]+/).includes("..")) {
    throw new Error(
      "Receipt paths must be project-relative and cannot contain '..'.",
    );
  }
  const [rootReal, receiptReal] = await Promise.all([
    fs.realpath(rootDir),
    fs.realpath(path.resolve(rootDir, receipt)),
  ]);
  const relativeReceipt = path.relative(rootReal, receiptReal);
  const escaped =
    relativeReceipt === ".." ||
    relativeReceipt.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeReceipt);
  if (escaped)
    throw new Error("Receipt path resolves outside the project root.");

  const receiptRaw = JSON.parse(await fs.readFile(receiptReal, "utf8")) as {
    data?: { fileHashes?: unknown };
  };
  const fileHashes = receiptRaw.data?.fileHashes;
  if (
    !fileHashes ||
    typeof fileHashes !== "object" ||
    Array.isArray(fileHashes)
  ) {
    throw new Error("Receipt must contain a fileHashes object.");
  }
  return Object.keys(fileHashes as Record<string, unknown>).sort();
}

function printReceiptError(
  error: unknown,
  flags: CliFlags | undefined,
  startedAt: number,
): void {
  if (!isJson(flags)) throw error;
  process.exitCode = 1;
  printJson(
    createProtocolEnvelope({
      command: "verify",
      data: { phase: "receipt", files: [] },
      diagnostics: [
        {
          code: "verify-receipt-invalid",
          level: "error",
          category: "spec",
          confidence: "high",
          safeToAutoFix: false,
          message: error instanceof Error ? error.message : String(error),
        },
      ],
      ok: false,
      startedAt,
    }),
  );
}

export async function verifyProject(flags?: CliFlags): Promise<void> {
  const startedAt = performance.now();
  const rootDir = process.cwd();
  const projectScriptsEnabled = flags?.["no-project-scripts"] !== true;
  let selectedFiles = parseSelectedFiles(flags?.files);
  if (typeof flags?.receipt === "string") {
    try {
      selectedFiles = await readReceiptFiles(rootDir, flags.receipt);
    } catch (error) {
      printReceiptError(error, flags, startedAt);
      return;
    }
  }

  const verificationFiles = await expandVerificationFiles(
    rootDir,
    selectedFiles,
  );
  const specPath = typeof flags?.spec === "string" ? flags.spec : undefined;
  let specDiagnostics: Array<{
    code: string;
    level: "error";
    message: string;
    path?: string;
  }> = [];
  if (specPath) {
    const { validateGeneratorSpecFile } = await import("../generate.mjs");
    specDiagnostics = (await validateGeneratorSpecFile(specPath)).map(
      (diagnostic) => ({
        category: "spec" as const,
        confidence: "high" as const,
        safeToAutoFix: false,
        ...diagnostic,
      }),
    );
  }

  const allProjectDiagnostics = await collectProjectDiagnostics(rootDir);
  const allSmokeDiagnostics = flags?.smoke
    ? await collectSmokeDiagnostics(rootDir)
    : [];
  const pluginInspection = await inspectProjectPlugins(rootDir);
  const pluginDiagnostics = pluginDiagnosticsForCli(pluginInspection);
  const relevant = <T extends { file?: string }>(items: T[]) =>
    selectedFiles.length === 0
      ? items
      : items.filter(
          (item) =>
            !item.file ||
            verificationFiles.includes(item.file.replace(/\\/g, "/")),
        );
  const diagnostics = [
    ...relevant(allProjectDiagnostics),
    ...relevant(allSmokeDiagnostics),
    ...(projectScriptsEnabled ? await runTypecheckIfAvailable(rootDir) : []),
    ...specDiagnostics,
    ...pluginDiagnostics,
  ];
  const routes = await collectPageRoutes(
    rootDir,
    await readPagesDirFromConfig(rootDir),
  );
  const ok = diagnostics.every((diagnostic) => diagnostic.level !== "error");
  const fixes = diagnostics
    .filter(
      (diagnostic) =>
        "fix" in diagnostic && Boolean((diagnostic as ProjectDiagnostic).fix),
    )
    .map((diagnostic) => ({
      code: diagnostic.code,
      file: "file" in diagnostic ? diagnostic.file : undefined,
      operation: (diagnostic as ProjectDiagnostic).fix,
    }));
  const inspectedRoutes = inspectRouteFiles(rootDir, routes);
  const relevantRoutes =
    selectedFiles.length === 0
      ? inspectedRoutes
      : inspectedRoutes.filter((route) =>
          route.files.some((file) => verificationFiles.includes(file)),
        );
  const payload = {
    phase: ok
      ? "complete"
      : specDiagnostics.length > 0
        ? "spec"
        : "diagnostics",
    fixes,
    routes: relevantRoutes,
    smoke: Boolean(flags?.smoke),
    projectScripts: projectScriptsEnabled,
    files: selectedFiles,
    dependencyFiles: verificationFiles.filter(
      (file) => !selectedFiles.includes(file),
    ),
    plugins: pluginInspection,
    nextCommands: ok ? ["tavo build"] : ["tavo doctor --fix-dry-run --json"],
  };

  if (isJson(flags)) {
    printJson(
      createProtocolEnvelope({
        command: "verify",
        data: payload,
        diagnostics,
        ok,
        fingerprintSource: { files: selectedFiles, routes: payload.routes },
        nextActions: payload.nextCommands.map((command) => ({
          command,
          reason: ok
            ? "Run the final production gate."
            : "Inspect available structured fixes.",
        })),
        startedAt,
      }),
    );
  } else {
    console.log(ok ? "Tavo.js verify passed." : "Tavo.js verify failed.");
    console.log("Use `tavo verify --json` for machine-readable output.");
  }
  if (!ok) process.exitCode = 1;
}
