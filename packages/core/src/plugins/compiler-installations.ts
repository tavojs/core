import { satisfies, valid as validSemver, validRange } from "semver";
import { TAVO_PLUGIN_API_VERSION } from "./declarations.js";
import {
  diagnostic,
  EMPTY_CONFIG,
  LOCAL_ID,
  PLUGIN_ID,
  normalizePath,
  ownerOf,
} from "./internal.js";
import type {
  CompiledPlugin,
  PluginConfiguration,
  PluginDiagnostic,
} from "./types.js";

export function compileInstallations(
  inputConfig: PluginConfiguration,
  diagnostics: PluginDiagnostic[],
): {
  config: PluginConfiguration;
  ordered: CompiledPlugin[];
  owners: Map<string, CompiledPlugin>;
} {
  let config = inputConfig;
  const compiled: CompiledPlugin[] = [];
  const owners = new Map<string, CompiledPlugin>();

  if (!config || !Array.isArray(config.installs)) {
    diagnostics.push(
      diagnostic(
        "TAVO_PLUGIN_002",
        "Plugin configuration must contain an installs array.",
      ),
    );
    config = EMPTY_CONFIG;
  }

  for (const installation of config.installs) {
    if (installation.enabled === false) continue;
    const plugin = installation.plugin;
    const instanceId = installation.instanceId ?? "default";
    if (
      !plugin ||
      !PLUGIN_ID.test(plugin.id) ||
      !LOCAL_ID.test(instanceId) ||
      !validSemver(plugin.version)
    ) {
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_002",
          "Plugin identity requires a package-style id, semantic version, and URL-safe instance id.",
          {
            owners: plugin?.id ? [ownerOf(plugin.id, instanceId)] : undefined,
          },
        ),
      );
      continue;
    }
    if (plugin.apiVersion !== TAVO_PLUGIN_API_VERSION) {
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_001",
          `Plugin "${plugin.id}" targets API ${String(plugin.apiVersion)}; this runtime supports API ${TAVO_PLUGIN_API_VERSION}.`,
          {
            owners: [ownerOf(plugin.id, instanceId)],
          },
        ),
      );
      continue;
    }
    const owner = ownerOf(plugin.id, instanceId);
    if (owners.has(owner)) {
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_003",
          `Plugin installation "${owner}" is duplicated.`,
          { resource: owner, owners: [owner] },
        ),
      );
      continue;
    }
    const item: CompiledPlugin = {
      owner,
      id: plugin.id,
      instanceId,
      version: plugin.version,
      plugin,
      dependencies: [],
      defaultBasePath: `/_plugins/${plugin.id}/${instanceId}`,
    };
    owners.set(owner, item);
    compiled.push(item);
  }

  const seenMounts = new Set<string>();
  for (const mount of config.mounts ?? []) {
    const owner = ownerOf(mount.plugin, mount.instanceId ?? "default");
    const key = `${owner}:${mount.kind}`;
    if (!owners.has(owner))
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_004",
          `Plugin mount references missing installation "${owner}".`,
          { resource: key, owners: [owner] },
        ),
      );
    if (seenMounts.has(key))
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_003",
          `Plugin mount "${key}" is declared more than once.`,
          { resource: key, owners: [owner] },
        ),
      );
    if (
      normalizePath(mount.to) === "/_tavo" ||
      normalizePath(mount.to).startsWith("/_tavo/")
    )
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_006",
          `Plugin mount "${key}" targets reserved framework URL space.`,
          { resource: mount.to, owners: [owner] },
        ),
      );
    seenMounts.add(key);
  }
  for (const permission of config.permissions ?? []) {
    const owner = ownerOf(
      permission.plugin,
      permission.instanceId ?? "default",
    );
    if (!owners.has(owner))
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_004",
          `Plugin permission references missing installation "${owner}".`,
          { resource: owner, owners: [owner] },
        ),
      );
  }
  for (const override of config.overrides ?? []) {
    const replaced = ownerOf(
      override.replace.plugin,
      override.replace.instanceId ?? "default",
    );
    const replacement =
      override.with.owner === "app"
        ? "app"
        : ownerOf(override.with.owner, override.with.instanceId ?? "default");
    if (!owners.has(replaced))
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_004",
          `Plugin override references missing replaced owner "${replaced}".`,
          { resource: `${override.kind}:${override.key}`, owners: [replaced] },
        ),
      );
    if (replacement !== "app" && !owners.has(replacement))
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_004",
          `Plugin override references missing replacement owner "${replacement}".`,
          {
            resource: `${override.kind}:${override.key}`,
            owners: [replacement],
          },
        ),
      );
  }

  const dependencyOwners = new Map<string, string[]>();
  for (const item of compiled) {
    const dependencies: string[] = [];
    for (const requirement of item.plugin.manifest.dependencies ?? []) {
      if (!validRange(requirement.version)) {
        diagnostics.push(
          diagnostic(
            "TAVO_PLUGIN_002",
            `Plugin "${item.owner}" declares invalid dependency range "${requirement.version}".`,
            { owners: [item.owner] },
          ),
        );
        continue;
      }
      const candidates = compiled.filter(
        (candidate) =>
          candidate.id === requirement.id &&
          (!requirement.instanceId ||
            candidate.instanceId === requirement.instanceId),
      );
      const provider =
        candidates.find((candidate) => candidate.instanceId === "default") ??
        (candidates.length === 1 ? candidates[0] : undefined);
      if (!provider) {
        if (!requirement.optional) {
          diagnostics.push(
            diagnostic(
              "TAVO_PLUGIN_004",
              `Plugin "${item.owner}" requires missing or ambiguous plugin "${requirement.id}".`,
              {
                resource: requirement.id,
                owners: [
                  item.owner,
                  ...candidates.map((candidate) => candidate.owner),
                ],
              },
            ),
          );
        }
        continue;
      }
      if (!satisfies(provider.version, requirement.version)) {
        if (!requirement.optional)
          diagnostics.push(
            diagnostic(
              "TAVO_PLUGIN_004",
              `Plugin "${item.owner}" requires ${requirement.id}@${requirement.version}, but ${provider.version} is installed.`,
              {
                resource: requirement.id,
                owners: [item.owner, provider.owner],
              },
            ),
          );
        continue;
      }
      dependencies.push(provider.owner);
    }
    dependencyOwners.set(item.owner, dependencies);
    (item as { dependencies: readonly string[] }).dependencies = dependencies;
  }

  const ordered: CompiledPlugin[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (item: CompiledPlugin) => {
    if (visited.has(item.owner)) return;
    if (visiting.has(item.owner)) {
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_005",
          `Plugin dependency graph contains a cycle at "${item.owner}".`,
          { resource: item.owner, owners: [item.owner] },
        ),
      );
      return;
    }
    visiting.add(item.owner);
    for (const dependency of dependencyOwners.get(item.owner) ?? []) {
      const target = owners.get(dependency);
      if (target) visit(target);
    }
    visiting.delete(item.owner);
    visited.add(item.owner);
    ordered.push(item);
  };
  for (const item of compiled) visit(item);
  return { config, ordered, owners };
}
