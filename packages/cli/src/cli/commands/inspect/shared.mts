import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { BUILD_DIR, GENERATED_DIR } from "../../constants.mjs";
import { analyzeProjectFile } from "../../inspect/analysis.mjs";
import { readPackageJson } from "../../inspect/helpers.mjs";
import { collectProjectInventory } from "../../inspect/inventory.mjs";
import {
  detectPackageManager,
  readCssEntriesFromConfig,
  readPagesDirFromConfig
} from "../../project/config.mjs";
import { collectPageRoutes } from "../../project/routes.mjs";
import { fileExists } from "../../utils/fs.mjs";
import { toPosixPath } from "../../utils/path.mjs";

export type ProjectInventory = Awaited<ReturnType<typeof collectProjectInventory>>;

export function shellArgument(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export async function getProjectInfoPayload(rootDir: string) {
  const pagesDir = await readPagesDirFromConfig(rootDir);
  const cssEntries = await readCssEntriesFromConfig(rootDir);
  const routes = await collectPageRoutes(rootDir, pagesDir);
  const hasServerEntry = await fileExists(path.join(rootDir, "server.mjs"));
  const packageManager = await detectPackageManager(rootDir);

  return {
    root: rootDir,
    packageManager,
    pagesDir,
    routesCount: routes.length,
    ssrEntry: hasServerEntry ? "server.mjs" : null,
    generatedDir: path.join(rootDir, GENERATED_DIR),
    buildDir: path.join(rootDir, BUILD_DIR),
    cssEntries,
    validationCommands: ["tavo check", "tavo build"]
  };
}

function findInventoryItem(
  inventory: ProjectInventory,
  kind: string | undefined,
  target: string
): { file: string; [key: string]: unknown } | undefined {
  const normalizedKind = kind?.replace(/s$/, "");
  if (!normalizedKind || normalizedKind === "route") {
    const route = inventory.pages.find(
      (candidate) => candidate.path === target || candidate.file === target
    );
    if (route) return route;
  }
  if (!normalizedKind || normalizedKind === "component") {
    const component = inventory.components.find(
      (candidate) => candidate.name === target || candidate.file === target
    );
    if (component) return component;
  }
  if (!normalizedKind || normalizedKind === "store") {
    return inventory.stores.find(
      (candidate) => candidate.name === target || candidate.file === target
    );
  }
  return undefined;
}

async function findProjectFile(
  rootDir: string,
  kind: string | undefined,
  target: string
): Promise<{ file: string } | undefined> {
  if (kind?.replace(/s$/, "") !== "file") return undefined;
  const absolute = path.resolve(rootDir, target);
  if (absolute !== rootDir && !absolute.startsWith(`${rootDir}${path.sep}`)) return undefined;

  try {
    const [rootReal, fileReal, stat] = await Promise.all([
      fs.realpath(rootDir),
      fs.realpath(absolute),
      fs.stat(absolute)
    ]);
    const isInsideProject = fileReal === rootReal || fileReal.startsWith(`${rootReal}${path.sep}`);
    if (!stat.isFile() || !isInsideProject) return undefined;
    return { file: toPosixPath(path.relative(rootDir, absolute)) };
  } catch {
    return undefined;
  }
}

export async function inspectInventoryTarget(
  rootDir: string,
  inventory: ProjectInventory,
  kind: string | undefined,
  target: string | undefined
) {
  if (!target) return null;
  const item = findInventoryItem(inventory, kind, target)
    ?? await findProjectFile(rootDir, kind, target);
  if (!item) return null;

  const analyzed = await analyzeProjectFile(path.join(rootDir, item.file));
  return {
    ...item,
    sha256: analyzed
      ? crypto.createHash("sha256").update(analyzed.source).digest("hex")
      : null,
    imports: analyzed?.analysis.imports ?? [],
    parser: analyzed?.analysis.parser,
    parseDiagnostics: analyzed?.analysis.parseDiagnostics ?? []
  };
}

export { readPackageJson };
