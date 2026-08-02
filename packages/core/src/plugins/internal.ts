import { TavoError } from "../diagnostics.js";
import type {
  AnyPluginToken,
  CompiledPlugin,
  PluginConfiguration,
  PluginDiagnostic,
  PluginDiagnosticCode,
  PluginMount,
} from "./types.js";

export const EMPTY_CONFIG: PluginConfiguration = Object.freeze({
  installs: [],
});
export const PLUGIN_ID =
  /^(?:@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)$/;
export const LOCAL_ID = /^[a-z][a-z0-9._-]*$/;

export function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return Boolean(
    value &&
    (typeof value === "object" || typeof value === "function") &&
    "then" in value,
  );
}

export function diagnostic(
  code: PluginDiagnosticCode,
  message: string,
  options: Partial<Omit<PluginDiagnostic, "code" | "message">> = {},
): PluginDiagnostic {
  return { code, severity: "error", phase: "compile", message, ...options };
}

export function pluginError(item: PluginDiagnostic): TavoError {
  return new TavoError(item.code, item.message, {
    details: {
      phase: item.phase,
      resource: item.resource,
      owners: item.owners,
    },
    hint: item.hint,
  });
}

export function normalizePath(path: string): string {
  const normalized = `/${path}`.replace(/\/{2,}/g, "/").replace(/\/$/, "");
  return normalized || "/";
}

export function joinPath(base: string, local: string): string {
  if (local === "/") return normalizePath(base);
  return normalizePath(`${base}/${local}`);
}

export function ownerOf(id: string, instanceId: string): string {
  return `${id}#${instanceId}`;
}

export function tokenKey(token: AnyPluginToken): string {
  return `${token.kind}:${token.provider}:${token.name}:${token.scope}`;
}

export function ownedTokenKey(owner: string, token: AnyPluginToken): string {
  return `${owner}|${token.kind}|${token.name}|${token.scope}`;
}

export function mountFor(
  config: PluginConfiguration,
  owner: CompiledPlugin,
  kind: PluginMount["kind"],
): PluginMount | undefined {
  return config.mounts?.find(
    (mount) =>
      mount.plugin === owner.id &&
      (mount.instanceId ?? "default") === owner.instanceId &&
      mount.kind === kind,
  );
}

export function publicPath(
  config: PluginConfiguration,
  owner: CompiledPlugin,
  kind: PluginMount["kind"],
  local: string,
): string {
  const mount = mountFor(config, owner, kind);
  const from = normalizePath(mount?.from ?? "/");
  const normalizedLocal = normalizePath(local);
  const relative =
    from === "/"
      ? normalizedLocal
      : normalizedLocal === from
        ? "/"
        : normalizedLocal.startsWith(`${from}/`)
          ? normalizedLocal.slice(from.length)
          : normalizedLocal;
  return joinPath(mount?.to ?? owner.defaultBasePath, relative);
}

export function ownerMatches(
  owner: string,
  reference: { plugin: string; instanceId?: string },
): boolean {
  return owner === ownerOf(reference.plugin, reference.instanceId ?? "default");
}

export function allowsReplacement(
  config: PluginConfiguration,
  kind: "page" | "endpoint" | "head" | "alias" | "define",
  key: string,
  left: string,
  right: string,
): boolean {
  return Boolean(
    config.overrides?.some((override) => {
      if (override.kind !== kind || override.key !== key) return false;
      const replacement =
        override.with.owner === "app"
          ? "app"
          : ownerOf(override.with.owner, override.with.instanceId ?? "default");
      return (
        (ownerMatches(left, override.replace) && replacement === right) ||
        (ownerMatches(right, override.replace) && replacement === left)
      );
    }),
  );
}

export function replacementWinner(
  config: PluginConfiguration,
  kind: "page" | "endpoint" | "head" | "alias" | "define",
  key: string,
  left: string,
  right: string,
): string | undefined {
  const override = config.overrides?.find(
    (candidate) => candidate.kind === kind && candidate.key === key,
  );
  if (!override) return undefined;
  const replaced = ownerOf(
    override.replace.plugin,
    override.replace.instanceId ?? "default",
  );
  const replacement =
    override.with.owner === "app"
      ? "app"
      : ownerOf(override.with.owner, override.with.instanceId ?? "default");
  if (
    (replaced === left && replacement === right) ||
    (replaced === right && replacement === left)
  ) {
    return replacement;
  }
  return undefined;
}

export function validateLocalIds(
  owner: string,
  kind: string,
  values: readonly { id: string }[] | undefined,
  diagnostics: PluginDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const value of values ?? []) {
    if (!LOCAL_ID.test(value.id)) {
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_002",
          `Plugin "${owner}" declares invalid ${kind} id "${value.id}".`,
          {
            resource: `${kind}:${value.id}`,
            owners: [owner],
          },
        ),
      );
    }
    if (seen.has(value.id)) {
      diagnostics.push(
        diagnostic(
          "TAVO_PLUGIN_003",
          `Plugin "${owner}" declares ${kind} "${value.id}" more than once.`,
          {
            resource: `${kind}:${value.id}`,
            owners: [owner],
          },
        ),
      );
    }
    seen.add(value.id);
  }
}
