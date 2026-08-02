import path from "node:path";
import { readCssEntriesFromConfig, readPagesDirFromConfig } from "../project/config.mjs";
import { collectPageRoutes } from "../project/routes.mjs";
import { fileExists, readFilesRecursive } from "../utils/fs.mjs";
import { toPosixPath } from "../utils/path.mjs";
import { analyzeProjectFile } from "./analysis.mjs";
import { inspectRouteFiles, listPageFiles } from "./helpers.mjs";
import type { InventoryFile, ProjectInventory } from "./types.mjs";

export async function collectProjectInventory(rootDir: string): Promise<ProjectInventory> {
  const pagesDir = await readPagesDirFromConfig(rootDir);
  const cssEntries = await readCssEntriesFromConfig(rootDir);
  const routes = await collectPageRoutes(rootDir, pagesDir);
  const inspectedRoutes = inspectRouteFiles(rootDir, routes);
  const routeByFile = new Map(inspectedRoutes.map((route) => [route.file, route]));
  const pages = [];
  const actions: ProjectInventory["actions"] = [];
  const publicExports: Record<string, string[]> = {};

  for (const route of routes) {
    const fileRelative = toPosixPath(path.relative(rootDir, route.file));
    const analyzed = await analyzeProjectFile(route.file);
    const exports = analyzed?.analysis.exports ?? [];
    publicExports[fileRelative] = exports;
    if (exports.includes("action")) {
      actions.push({ route: route.path, file: fileRelative, exportName: "action" });
    }
    pages.push({
      ...routeByFile.get(fileRelative)!,
      exports,
      hasLoader: exports.includes("load"),
      hasAction: exports.includes("action"),
      importPath: `./${fileRelative.replace(/\.[^.]+$/, "")}`
    });
  }

  const layouts = await collectLayouts(rootDir, pagesDir, publicExports);

  return {
    pages,
    layouts,
    components: await inventoryFolder(rootDir, "src/components", publicExports),
    stores: await inventoryFolder(rootDir, "src/store", publicExports),
    actions,
    cssEntries,
    publicExports
  };
}

async function inventoryFolder(
  rootDir: string,
  folder: string,
  publicExports: Record<string, string[]>
): Promise<InventoryFile[]> {
  const absolute = path.join(rootDir, folder);
  if (!(await fileExists(absolute))) {
    return [];
  }
  const files = await readFilesRecursive(absolute);
  const items: InventoryFile[] = [];
  for (const file of files) {
    const analyzed = await analyzeProjectFile(file);
    const fileRelative = toPosixPath(path.relative(rootDir, file));
    const exports = analyzed?.analysis.exports ?? [];
    publicExports[fileRelative] = exports;
    items.push({
      name: path.basename(file).replace(/\.[^.]+$/, "") === "index"
        ? path.basename(path.dirname(file))
        : path.basename(file).replace(/\.[^.]+$/, ""),
      file: fileRelative,
      exports,
      imports: analyzed?.analysis.imports ?? []
    });
  }
  return items.sort((left, right) => left.file.localeCompare(right.file));
}

async function collectLayouts(
  rootDir: string,
  pagesDir: string,
  publicExports: Record<string, string[]>
): Promise<InventoryFile[]> {
  const layouts: InventoryFile[] = [];
  for (const file of await listPageFiles(rootDir, pagesDir)) {
    if (path.basename(file).replace(/\.[^.]+$/, "") !== "_layout") {
      continue;
    }
    const analyzed = await analyzeProjectFile(file);
    const fileRelative = toPosixPath(path.relative(rootDir, file));
    const exports = analyzed?.analysis.exports ?? [];
    publicExports[fileRelative] = exports;
    layouts.push({
      name: "_layout",
      file: fileRelative,
      exports,
      imports: analyzed?.analysis.imports ?? []
    });
  }
  return layouts.sort((left, right) => left.file.localeCompare(right.file));
}
