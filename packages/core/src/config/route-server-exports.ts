import path from "node:path";
import { isPagesModule, stripQuery } from "./route-server-exports/lexical.js";
import {
  applyReplacements,
  assertClientRouteActionsWereRemoved,
  assertClientRouteServerHelpersWereRemoved,
  collectClientRuntimeBranchReplacements,
  collectServerOnlyRouteExportReplacements,
  overlapsAny
} from "./route-server-exports/transforms.js";

export function createRouteServerExportsPlugin() {
  let root = process.cwd();
  return {
    name: "tavo:route-server-exports",
    enforce: "pre" as const,
    configResolved(config: { root?: string }) {
      root = path.resolve(config.root ?? process.cwd());
    },
    transform(code: string, id: string, options?: { ssr?: boolean }) {
      if (options?.ssr) return null;
      const file = stripQuery(id);
      if (!isPagesModule(file, root)) return null;

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
