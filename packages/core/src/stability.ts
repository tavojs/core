export type ApiStability = "stable" | "experimental";

export type ApiStabilityEntry = {
  level: ApiStability;
  since: string;
  note: string;
};

/**
 * Machine-readable stability contract for public package entry points.
 * Stable entry points follow semantic versioning from Tavo 1.0 onward.
 */
export const TAVO_API_STABILITY = Object.freeze({
  "@tavojs/core": { level: "stable", since: "1.0", note: "Common application runtime APIs." },
  "@tavojs/core/config": { level: "stable", since: "1.0", note: "Project and Vite configuration." },
  "@tavojs/core/dev": { level: "experimental", since: "1.0", note: "Development, testing, and observability tools." },
  "@tavojs/core/jsx-dev-runtime": { level: "stable", since: "1.0", note: "Development JSX transform runtime." },
  "@tavojs/core/jsx-runtime": { level: "stable", since: "1.0", note: "JSX transform runtime." },
  "@tavojs/core/plugin": { level: "stable", since: "1.0", note: "Plugin graph and runtime APIs." },
  "@tavojs/core/router": { level: "stable", since: "1.0", note: "Routing, navigation, and route module APIs." },
  "@tavojs/core/server": { level: "stable", since: "1.0", note: "Node rendering, sessions, and server utilities." },
  "@tavojs/core/server-only": { level: "stable", since: "1.0", note: "Server-only module boundary marker." },
} satisfies Record<string, ApiStabilityEntry>);

export type TavoPublicEntryPoint = keyof typeof TAVO_API_STABILITY;

export function getApiStability(entryPoint: TavoPublicEntryPoint): ApiStabilityEntry {
  return TAVO_API_STABILITY[entryPoint];
}
