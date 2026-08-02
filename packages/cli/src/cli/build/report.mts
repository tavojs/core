import type { PageRoute } from "../project/routes.mjs";
import type {
  BuildReport,
  RollupBuildOutput,
  RollupChunkOutput,
  ViteBuildResult
} from "../types.mjs";
import { formatSize, pad } from "../utils/format.mjs";
import { normalizeModuleId } from "../utils/path.mjs";

function collectStaticImports(
  startFile: string | undefined,
  chunkByFile: Map<string, RollupChunkOutput>,
  visited = new Set<string>()
): Set<string> {
  if (!startFile || visited.has(startFile)) {
    return visited;
  }
  visited.add(startFile);
  const chunk = chunkByFile.get(startFile);
  if (!chunk) {
    return visited;
  }
  for (const imported of chunk.imports ?? []) {
    collectStaticImports(imported, chunkByFile, visited);
  }
  return visited;
}

export function normalizeBuildOutputs(result: ViteBuildResult): RollupBuildOutput[] {
  if (!result) {
    return [];
  }
  if (Array.isArray(result)) {
    return result.flatMap((entry) => entry.output ?? []);
  }
  return result.output ?? [];
}

export function createRouteBuildReport({
  outputs,
  routes,
  hasServerEntry,
  routeModes
}: {
  outputs: RollupBuildOutput[];
  routes: PageRoute[];
  hasServerEntry: boolean;
  routeModes?: Map<string, string>;
}): BuildReport {
  const chunkByFile = new Map<string, RollupChunkOutput>();
  const moduleRenderedLengths = new Map<string, number>();
  const initialEntries: string[] = [];

  for (const output of outputs) {
    if (output.type !== "chunk") {
      continue;
    }
    chunkByFile.set(output.fileName, output);
    if (output.isEntry) {
      initialEntries.push(output.fileName);
    }
    for (const [moduleId, details] of Object.entries(output.modules ?? {})) {
      moduleRenderedLengths.set(normalizeModuleId(moduleId), details.renderedLength ?? 0);
    }
  }

  const initialChunkFiles = new Set<string>();
  for (const entryFile of initialEntries) {
    collectStaticImports(entryFile, chunkByFile, initialChunkFiles);
  }

  let firstLoadJs = 0;
  for (const fileName of initialChunkFiles) {
    const chunk = chunkByFile.get(fileName);
    if (!chunk) {
      continue;
    }
    firstLoadJs += Buffer.byteLength(chunk.code ?? "", "utf8");
  }

  return {
    rows: routes.map((route) => ({
      symbol: hasServerEntry ? "ƒ" : "○",
      route: route.path,
      mode: routeModes?.get(route.path),
      size: route.files.reduce(
        (total, file) => total + (moduleRenderedLengths.get(normalizeModuleId(file)) ?? 0),
        0
      ),
      firstLoadJs
    }))
  };
}

export function printRouteBuildReport(report: BuildReport): void {
  if (!report.rows.length) {
    return;
  }

  const headerRoute = "Route (pages)";
  const headerMode = "Mode";
  const headerSize = "Size";
  const headerFirstLoad = "First Load JS";
  const routeWidth = Math.max(headerRoute.length, ...report.rows.map((row) => `${row.symbol} ${row.route}`.length)) + 4;
  const modeWidth = Math.max(headerMode.length, ...report.rows.map((row) => (row.mode ?? "").length)) + 4;
  const sizeWidth = Math.max(headerSize.length, ...report.rows.map((row) => formatSize(row.size).length)) + 4;

  console.log("");
  console.log(`${pad(headerRoute, routeWidth)}${pad(headerMode, modeWidth)}${pad(headerSize, sizeWidth)}${headerFirstLoad}`);
  report.rows.forEach((row, index) => {
    const prefix = index === 0 ? "┌" : index === report.rows.length - 1 ? "└" : "├";
    const routeLabel = `${prefix} ${row.symbol} ${row.route}`;
    console.log(`${pad(routeLabel, routeWidth)}${pad(row.mode ?? "", modeWidth)}${pad(formatSize(row.size), sizeWidth)}${formatSize(row.firstLoadJs)}`);
  });
}

export function validateBuildBudgets(
  report: BuildReport,
  budgets: { firstLoadJs?: number; routeJs?: number }
): string[] {
  const violations: string[] = [];
  for (const row of report.rows) {
    if (budgets.firstLoadJs !== undefined && row.firstLoadJs > budgets.firstLoadJs) {
      violations.push(
        `${row.route}: first-load JavaScript ${formatSize(row.firstLoadJs)} exceeds ${formatSize(budgets.firstLoadJs)}`
      );
    }
    if (budgets.routeJs !== undefined && row.size > budgets.routeJs) {
      violations.push(
        `${row.route}: route JavaScript ${formatSize(row.size)} exceeds ${formatSize(budgets.routeJs)}`
      );
    }
  }
  return violations;
}
