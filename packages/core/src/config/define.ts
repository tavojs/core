import type { ExactTavoConfig, TavoConfig } from "./types.js";

export const TAVO_CONFIG_MARKER = Symbol.for(
  "@tavojs/core/config/defined",
);

/** Defines the single project configuration object and brands it for runtime validation. */
export function defineConfig<const T extends TavoConfig>(
  config: ExactTavoConfig<T>,
): T {
  Object.defineProperty(config, TAVO_CONFIG_MARKER, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return config;
}
