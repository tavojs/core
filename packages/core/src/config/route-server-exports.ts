import path from "node:path";
import { resolveDirectoryPaths } from "./directories.js";
import { isPagesModule, stripQuery } from "./route-server-exports/lexical.js";
import {
  applyReplacements,
  assertClientRouteActionsWereRemoved,
  assertClientRouteServerHelpersWereRemoved,
  collectClientRuntimeBranchReplacements,
  collectServerOnlyRouteExportReplacements,
  overlapsAny
} from "./route-server-exports/transforms.js";

export function createRouteServerExportsPlugin(pagesDir = "src/pages") {
  let directories = resolveDirectoryPaths(path.resolve(process.cwd(), pagesDir));
  return {
    name: "tavo:route-server-exports",
    enforce: "pre" as const,
    configResolved(config: { root?: string }) {
      directories = resolveDirectoryPaths(path.resolve(config.root ?? process.cwd(), pagesDir));
    },
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (options?.ssr) return null;
      const file = stripQuery(id);
      if (!directories.some((directory) => isPagesModule(file, directory, "."))) return null;

      const serverOnlyExports = collectServerOnlyRouteExportReplacements(code);
      const runtimeBranches = collectClientRuntimeBranchReplacements(code).filter(
        (replacement) => !overlapsAny(replacement, serverOnlyExports)
      );
      const replacements = [...serverOnlyExports, ...runtimeBranches]
        .sort((left, right) => right.start - left.start);
      const transformed = applyReplacements(code, replacements);
      assertClientRouteActionsWereRemoved(transformed, file);
      assertClientRouteServerHelpersWereRemoved(transformed, file);
      if (replacements.length === 0) return null;
      return { code: transformed, map: null };
    }
  };
}
