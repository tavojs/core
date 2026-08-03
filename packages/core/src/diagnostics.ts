export const TAVO_DIAGNOSTIC_MESSAGES = Object.freeze({
  TAVO_PAGES_001: "The resolved page cache limit is invalid.",
  TAVO_PAGES_002: "The client root element is missing.",
  TAVO_PAGES_003: "The auto-discovery pattern is unsupported.",
  TAVO_PAGES_004: "The bundler page-discovery API is unavailable.",
  TAVO_PAGES_005: "Server bootstrap is missing page modules.",
  TAVO_PAGES_006: "A page module declares conflicting static generation options.",
  TAVO_SSR_001: "The canonical SSR origin is invalid.",
  TAVO_CONFIG_001: "A server-only module reached the client bundle.",
  TAVO_CONFIG_002:
    "A likely secret environment value is referenced by client code.",
  TAVO_PLUGIN_001: "A plugin targets an unsupported Tavo.js plugin API version.",
  TAVO_PLUGIN_002: "A plugin manifest or identity is invalid.",
  TAVO_PLUGIN_003: "Plugin ownership or contribution is duplicated.",
  TAVO_PLUGIN_004:
    "A plugin dependency or capability requirement is not satisfied.",
  TAVO_PLUGIN_005: "A plugin dependency or ordering graph contains a cycle.",
  TAVO_PLUGIN_006:
    "A plugin requested a reserved resource or missing permission.",
  TAVO_PLUGIN_007: "A plugin phase does not implement its declared manifest.",
  TAVO_PLUGIN_008: "A plugin failed during initialization or build.",
  TAVO_PLUGIN_009: "A plugin failed while handling or disposing a request.",
  TAVO_HYDRATION_001: "Strict hydration detected a server/client mismatch.",
} as const);

export type TavoDiagnosticCode = keyof typeof TAVO_DIAGNOSTIC_MESSAGES;

export type TavoErrorOptions = {
  cause?: unknown;
  details?: Readonly<Record<string, unknown>>;
  hint?: string;
};

/** Framework error with a stable code and optional structured remediation context. */
export class TavoError extends Error {
  readonly code: TavoDiagnosticCode;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly hint?: string;

  constructor(
    code: TavoDiagnosticCode,
    message?: string,
    options?: TavoErrorOptions,
  ) {
    super(`[${code}] ${message ?? TAVO_DIAGNOSTIC_MESSAGES[code]}`, {
      cause: options?.cause,
    });
    this.name = "TavoError";
    this.code = code;
    this.details = options?.details;
    this.hint = options?.hint;
  }
}

export function isTavoError(error: unknown): error is TavoError {
  return error instanceof TavoError;
}

/** Produces a human-readable diagnostic while preserving the stable code for logs and tooling. */
export function formatTavoError(error: TavoError): string {
  return error.hint
    ? `${error.message}\nHow to fix: ${error.hint}`
    : error.message;
}
