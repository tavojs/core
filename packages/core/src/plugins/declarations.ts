import { TavoError } from "../diagnostics.js";
import type { AnyRecord } from "../framework/types.js";
import { diagnostic } from "./internal.js";
import type {
  PluginCapabilityToken,
  PluginDiagnostic,
  PluginStoreToken,
  TavoPlugin,
  TavoPluginPhase,
} from "./types.js";

/** Current public contract implemented by the Tavo.js plugin runtime. */
export const TAVO_PLUGIN_API_VERSION = 1 as const;

export function defineCapability<
  T,
  TScope extends "runtime" | "request",
>(definition: {
  provider: string;
  name: string;
  scope: TScope;
}): PluginCapabilityToken<T, TScope> {
  return Object.freeze({
    kind: "capability",
    ...definition,
  }) as PluginCapabilityToken<T, TScope>;
}

/** Defines an owned runtime store and its optional hydration contract. */
export function definePluginStore<T extends AnyRecord>(
  definition: Omit<PluginStoreToken<T>, "kind" | "scope" | "hydrate"> & {
    hydrate?: boolean;
  },
): PluginStoreToken<T> {
  if (
    definition.hydrate &&
    (!definition.validate || !definition.serialize || !definition.deserialize)
  ) {
    throw new TavoError(
      "TAVO_PLUGIN_002",
      `Hydrated plugin store "${definition.provider}:${definition.name}" requires validate, serialize, and deserialize hooks.`,
    );
  }
  return Object.freeze({
    kind: "store",
    scope: "runtime",
    hydrate: false,
    ...definition,
  }) as PluginStoreToken<T>;
}

/** Defines a phase implementation while preserving its literal keys. */
export function definePluginPhase<T extends TavoPluginPhase>(phase: T): T {
  return phase;
}

/** Defines a Plugin API v1 descriptor. Validation occurs during graph compilation. */
export function definePlugin<T extends TavoPlugin>(plugin: T): T {
  return plugin;
}

/** Defines a typed plugin factory. */
export function definePluginFactory<TOptions, TPlugin extends TavoPlugin>(
  factory: (options: TOptions) => TPlugin,
): (options: TOptions) => TPlugin {
  return factory;
}

/** Checks a plugin descriptor without running phase code. */
export function checkPluginCompatibility(plugin: {
  id: string;
  apiVersion: number;
}): {
  compatible: boolean;
  currentVersion: typeof TAVO_PLUGIN_API_VERSION;
  requestedVersion: number;
  diagnostic?: PluginDiagnostic;
} {
  const compatible = plugin.apiVersion === TAVO_PLUGIN_API_VERSION;
  return {
    compatible,
    currentVersion: TAVO_PLUGIN_API_VERSION,
    requestedVersion: Number(plugin.apiVersion),
    diagnostic: compatible
      ? undefined
      : diagnostic(
          "TAVO_PLUGIN_001",
          `Plugin "${plugin.id}" targets API ${String(plugin.apiVersion)}; this runtime supports API ${TAVO_PLUGIN_API_VERSION}.`,
          { owners: [plugin.id] },
        ),
  };
}
