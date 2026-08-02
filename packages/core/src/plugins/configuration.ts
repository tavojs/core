import { diagnostic, EMPTY_CONFIG } from "./internal.js";
import type {
  PluginConfiguration,
  PluginDiagnostic,
  PluginExposureTarget,
  PluginUse,
  TavoPlugin,
  TavoPluginInput,
} from "./types.js";

function isPlugin(value: unknown): value is TavoPlugin {
  return Boolean(
    value && typeof value === "object" && "id" in value && "manifest" in value,
  );
}

function exposureMount(
  plugin: string,
  instanceId: string | undefined,
  kind: "page" | "server",
  target: PluginExposureTarget,
) {
  return typeof target === "string"
    ? { plugin, instanceId, kind, from: "/", to: target }
    : { plugin, instanceId, kind, from: target.from ?? "/", to: target.to };
}

function normalizeUses(
  uses: readonly PluginUse[],
  overrides: PluginConfiguration["overrides"],
  diagnostics: PluginDiagnostic[],
): PluginConfiguration {
  const installs: PluginConfiguration["installs"][number][] = [];
  const mounts: NonNullable<PluginConfiguration["mounts"]>[number][] = [];

  for (const use of uses) {
    const record = isPlugin(use) ? { plugin: use } : use;
    if (!record || typeof record !== "object" || !("plugin" in record)) {
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_002",
          "Plugin use entries must contain a plugin descriptor.",
        ),
      );
      continue;
    }
    const { plugin, instanceId, enabled } = record;
    installs.push({ plugin, instanceId, enabled });
    if (enabled === false || !plugin || typeof plugin.id !== "string") continue;

    for (const kind of ["page", "server"] as const) {
      const target = record.expose?.[kind];
      if (target !== undefined)
        mounts.push(exposureMount(plugin.id, instanceId, kind, target));
    }
  }

  return applyDeclaredAuthority({
    installs,
    ...(mounts.length > 0 ? { mounts } : {}),
    ...(overrides && overrides.length > 0 ? { overrides } : {}),
  });
}

function applyDeclaredAuthority(
  input: PluginConfiguration,
): PluginConfiguration {
  const mounts = [...(input.mounts ?? [])];
  const permissions = (input.permissions ?? []).map((permission) => ({
    ...permission,
  }));
  for (const installation of input.installs) {
    if (installation.enabled === false || !installation.plugin) continue;
    const { plugin, instanceId } = installation;
    for (const declaration of plugin.manifest?.permissions ?? []) {
      if (!declaration || declaration.name !== "unsafeHeadHtml") continue;
      const existing = permissions.find(
        (permission) =>
          permission.plugin === plugin.id &&
          (permission.instanceId ?? "default") === (instanceId ?? "default"),
      );
      if (existing) existing.unsafeHeadHtml = true;
      else
        permissions.push({
          plugin: plugin.id,
          instanceId,
          unsafeHeadHtml: true,
        });
    }
    for (const declaration of plugin.manifest?.exposure ?? []) {
      if (
        !declaration ||
        (declaration.target !== "page" && declaration.target !== "server") ||
        typeof declaration.to !== "string"
      )
        continue;
      const existing = mounts.some(
        (mount) =>
          mount.plugin === plugin.id &&
          (mount.instanceId ?? "default") === (instanceId ?? "default") &&
          mount.kind === declaration.target,
      );
      if (!existing)
        mounts.push(
          exposureMount(plugin.id, instanceId, declaration.target, {
            from: declaration.from,
            to: declaration.to,
          }),
        );
    }
  }
  return {
    ...input,
    ...(mounts.length > 0 ? { mounts } : {}),
    ...(permissions.length > 0 ? { permissions } : {}),
  };
}

/** Converts ergonomic plugin authoring input into the strict compiler representation. */
export function normalizePluginConfiguration(
  input: TavoPluginInput | undefined,
  diagnostics: PluginDiagnostic[] = [],
): PluginConfiguration {
  if (input === undefined) return EMPTY_CONFIG;
  if (Array.isArray(input))
    return normalizeUses(input as readonly PluginUse[], undefined, diagnostics);
  if (input && typeof input === "object" && "use" in input) {
    const candidate = input as {
      use?: unknown;
      overrides?: PluginConfiguration["overrides"];
    };
    if (!Array.isArray(candidate.use)) {
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_002",
          "Plugin configuration use must be an array.",
        ),
      );
      return EMPTY_CONFIG;
    }
    return normalizeUses(
      candidate.use as readonly PluginUse[],
      candidate.overrides,
      diagnostics,
    );
  }
  diagnostics.push(
    diagnostic(
      "TAVO_PLUGIN_002",
      "Plugin configuration must be an array or an object with a use array.",
    ),
  );
  return EMPTY_CONFIG;
}
