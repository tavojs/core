import { diagnostic, LOCAL_ID } from "./internal.js";
import type {
  PluginBuildItemDeclaration,
  PluginDiagnostic,
  PluginMiddlewareDeclaration,
} from "./types.js";

export function validateBuildOrdering(
  owner: string,
  items: readonly PluginBuildItemDeclaration[],
  diagnostics: PluginDiagnostic[],
): void {
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (entry: PluginBuildItemDeclaration) => {
    if (visited.has(entry.id)) return;
    if (visiting.has(entry.id)) {
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_005",
          `Build plugin ordering for "${owner}" contains a cycle at "${entry.id}".`,
          { resource: entry.id, owners: [owner] },
        ),
      );
      return;
    }
    visiting.add(entry.id);
    for (const reference of entry.after ?? []) {
      const target = byId.get(reference);
      if (target) visit(target);
      else
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_004",
            `Build plugin "${owner}:${entry.id}" orders after unknown item "${reference}".`,
            { resource: entry.id, owners: [owner] },
          ),
        );
    }
    for (const candidate of items) {
      if ((candidate.before ?? []).includes(entry.id)) visit(candidate);
      for (const reference of candidate.before ?? []) {
        if (!byId.has(reference))
          diagnostics.push(
            diagnostic(
              "TAVO_PLUGIN_004",
              `Build plugin "${owner}:${candidate.id}" orders before unknown item "${reference}".`,
              { resource: candidate.id, owners: [owner] },
            ),
          );
      }
    }
    visiting.delete(entry.id);
    visited.add(entry.id);
  };
  for (const entry of items) visit(entry);
}

export function orderMiddleware(
  middleware: Array<PluginMiddlewareDeclaration & { owner: string }>,
  diagnostics: PluginDiagnostic[],
): Array<PluginMiddlewareDeclaration & { owner: string }> {
  const output: Array<PluginMiddlewareDeclaration & { owner: string }> = [];
  for (const stage of [
    "server:before-handler",
    "page:before-app",
    "page:after-app",
  ] as const) {
    const entries = middleware.filter((item) => item.stage === stage);
    const byKey = new Map(
      entries.map((entry) => [`${entry.owner}:${entry.id}`, entry]),
    );
    const resolveReference = (
      entry: (typeof entries)[number],
      reference: string,
    ) =>
      byKey.get(
        reference.includes(":") ? reference : `${entry.owner}:${reference}`,
      );
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (entry: (typeof entries)[number]) => {
      const key = `${entry.owner}:${entry.id}`;
      if (visited.has(key)) return;
      if (visiting.has(key)) {
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_005",
            `Plugin middleware ordering contains a cycle at "${key}".`,
            {
              resource: key,
              owners: [entry.owner],
            },
          ),
        );
        return;
      }
      visiting.add(key);
      for (const reference of entry.after ?? []) {
        const target = resolveReference(entry, reference);
        if (!target) {
          diagnostics.push(
            diagnostic(
              "TAVO_PLUGIN_004",
              `Plugin middleware "${key}" orders after unknown middleware "${reference}".`,
              { resource: key, owners: [entry.owner] },
            ),
          );
        } else visit(target);
      }
      for (const candidate of entries) {
        if (
          (candidate.before ?? []).some(
            (reference) => resolveReference(candidate, reference) === entry,
          )
        )
          visit(candidate);
      }
      visiting.delete(key);
      visited.add(key);
      output.push(entry);
    };
    for (const entry of entries) visit(entry);
  }
  return output;
}
