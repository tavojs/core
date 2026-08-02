import { declaredPermission } from "./authority.js";
import {
  allowsReplacement,
  diagnostic,
  replacementWinner,
} from "./internal.js";
import type {
  CompiledPlugin,
  PluginConfiguration,
  PluginDiagnostic,
  PluginHeadDeclaration,
} from "./types.js";

export function compileHeadContributions(
  config: PluginConfiguration,
  item: CompiledPlugin,
  head: Array<PluginHeadDeclaration & { owner: string }>,
  singletonHead: Map<string, string>,
  diagnostics: PluginDiagnostic[],
): void {
  const manifest = item.plugin.manifest;
  for (const entry of manifest.head ?? []) {
    const declaration = declaredPermission(manifest, "unsafeHeadHtml");
    if (entry.unsafeHeadHtml && !declaration) {
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_006",
          `Plugin head contribution "${item.owner}:${entry.id}" uses raw HTML without declaring unsafeHeadHtml permission.`,
          {
            resource: entry.key,
            owners: [item.owner],
            hint: 'The plugin manifest must declare permissions: [{ name: "unsafeHeadHtml", reason: "..." }].',
          },
        ),
      );
    }
    if (
      entry.unsafeHeadHtml &&
      declaration &&
      !config.permissions?.some(
        (permission) =>
          permission.plugin === item.id &&
          (permission.instanceId ?? "default") === item.instanceId &&
          permission.unsafeHeadHtml,
      )
    ) {
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_006",
          `Plugin head contribution "${item.owner}:${entry.id}" requires unsafeHeadHtml permission.`,
          {
            resource: entry.key,
            owners: [item.owner],
            hint: `${declaration.reason} Reinstall or inspect the plugin because its declared permission was not normalized.`,
          },
        ),
      );
    }
    if (entry.cardinality === "singleton") {
      const previous = singletonHead.get(entry.key);
      if (
        previous &&
        !allowsReplacement(config, "head", entry.key, previous, item.owner)
      )
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_003",
            `Singleton head key "${entry.key}" has multiple owners.`,
            { resource: entry.key, owners: [previous, item.owner] },
          ),
        );
      const winner = previous
        ? replacementWinner(config, "head", entry.key, previous, item.owner)
        : item.owner;
      if (winner === item.owner) {
        const previousIndex = head.findIndex(
          (candidate) =>
            candidate.cardinality === "singleton" &&
            candidate.key === entry.key,
        );
        if (previousIndex >= 0) head.splice(previousIndex, 1);
        singletonHead.set(entry.key, item.owner);
        head.push({ ...entry, owner: item.owner });
      }
      continue;
    }
    head.push({ ...entry, owner: item.owner });
  }
}
