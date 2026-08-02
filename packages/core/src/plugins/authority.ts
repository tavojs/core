import { diagnostic } from "./internal.js";
import type {
  CompiledPlugin,
  CompiledPluginGraph,
  PluginDiagnostic,
  PluginGraphInspection,
  TavoPluginManifest,
} from "./types.js";
import type { PluginMount } from "./configuration-types.js";

export function validateAuthorityDeclarations(
  plugin: CompiledPlugin,
  diagnostics: PluginDiagnostic[],
): void {
  const permissionNames = new Set<string>();
  for (const permission of plugin.plugin.manifest.permissions ?? []) {
    const valid =
      permission?.name === "unsafeHeadHtml" &&
      typeof permission.reason === "string" &&
      permission.reason.trim().length > 0 &&
      (permission.required === undefined ||
        typeof permission.required === "boolean");
    const name = permission?.name;
    if (!valid || (name !== undefined && permissionNames.has(name)))
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_002",
          `Plugin "${plugin.owner}" declares an invalid or duplicate permission "${String(name)}".`,
          {
            resource: `permission:${String(name)}`,
            owners: [plugin.owner],
          },
        ),
      );
    if (name !== undefined) permissionNames.add(name);
  }

  const exposureTargets = new Set<string>();
  for (const exposure of plugin.plugin.manifest.exposure ?? []) {
    const valid =
      (exposure?.target === "page" || exposure?.target === "server") &&
      typeof exposure.to === "string" &&
      typeof exposure.reason === "string" &&
      exposure.reason.trim().length > 0;
    const target = exposure?.target;
    if (!valid || (target !== undefined && exposureTargets.has(target)))
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_002",
          `Plugin "${plugin.owner}" declares invalid or duplicate exposure for "${String(target)}".`,
          {
            resource: `exposure:${String(target)}`,
            owners: [plugin.owner],
          },
        ),
      );
    if (target !== undefined) exposureTargets.add(target);
  }
}

export function declaredPermission(
  manifest: TavoPluginManifest,
  name: "unsafeHeadHtml",
) {
  return manifest.permissions?.find((permission) => permission.name === name);
}

export function inspectDeclaredAuthority(
  graph: CompiledPluginGraph,
  mounts: readonly PluginMount[] = [],
): {
  permissions: PluginGraphInspection["permissions"];
  exposure: PluginGraphInspection["exposure"];
} {
  const permissions: Array<PluginGraphInspection["permissions"][number]> = [];
  const exposure: Array<PluginGraphInspection["exposure"][number]> = [];
  for (const plugin of graph.plugins) {
    for (const declaration of plugin.plugin.manifest.permissions ?? []) {
      if (
        !declaration ||
        declaration.name !== "unsafeHeadHtml" ||
        typeof declaration.reason !== "string" ||
        declaration.reason.trim().length === 0
      )
        continue;
      permissions.push({
        owner: plugin.owner,
        name: declaration.name,
        required: declaration.required ?? true,
        reason: declaration.reason,
      });
    }
    for (const declaration of plugin.plugin.manifest.exposure ?? []) {
      if (
        !declaration ||
        (declaration.target !== "page" && declaration.target !== "server") ||
        typeof declaration.to !== "string" ||
        typeof declaration.reason !== "string" ||
        declaration.reason.trim().length === 0
      )
        continue;
      const mount = mounts.find(
        (candidate) =>
          candidate.plugin === plugin.id &&
          (candidate.instanceId ?? "default") === plugin.instanceId &&
          candidate.kind === declaration.target,
      );
      exposure.push({
        owner: plugin.owner,
        target: declaration.target,
        from: mount?.from ?? declaration.from ?? "/",
        to: mount?.to ?? declaration.to,
        reason: declaration.reason,
      });
    }
  }
  return { permissions, exposure };
}
