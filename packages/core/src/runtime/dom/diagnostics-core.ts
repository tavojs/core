import { TavoError } from "../../diagnostics.js";

export type DevTracePhase = "mount" | "patch" | "hydrate";

export type DevTraceEvent = {
  phase: DevTracePhase;
  kind: string;
  key?: string | number | null;
  detail?: string;
};

export type HydrationMismatchEvent = {
  message: string;
  expected?: string;
  found?: string;
  path?: string;
  pathSegments?: string[];
  phase?: DevTracePhase;
  kind?: string;
  recovery?: "text" | "subtree" | "cleanup";
};

export type DevDiagnosticsOptions = {
  enabled?: boolean;
  devMode?: boolean;
  onTrace?: ((event: DevTraceEvent) => void) | null;
  onHydrationMismatch?: ((event: HydrationMismatchEvent) => void) | null;
  onError?: ((error: unknown) => void) | null;
  strictHydration?: boolean;
};

const diagnostics: Required<DevDiagnosticsOptions> = {
  enabled: false,
  devMode: false,
  onTrace: null,
  onHydrationMismatch: null,
  onError: null,
  strictHydration: false
};

let overlayHandler: ((error: unknown) => void) | null = null;

/** Updates runtime diagnostics callbacks used by the DOM renderer. */
export function configureDevDiagnostics(options: DevDiagnosticsOptions): void {
  if (options.enabled !== undefined) {
    diagnostics.enabled = options.enabled;
  }
  if (options.devMode !== undefined) {
    diagnostics.devMode = options.devMode;
  }
  if (options.onTrace !== undefined) {
    diagnostics.onTrace = options.onTrace;
  }
  if (options.onHydrationMismatch !== undefined) {
    diagnostics.onHydrationMismatch = options.onHydrationMismatch;
  }
  if (options.onError !== undefined) {
    diagnostics.onError = options.onError;
  }
  if (options.strictHydration !== undefined) {
    diagnostics.strictHydration = options.strictHydration;
  }
}

/** Installs an optional overlay renderer without making the base runtime own overlay DOM code. */
export function setDevOverlayHandler(handler: ((error: unknown) => void) | null): void {
  overlayHandler = handler;
}

/** Emits dev traces only when diagnostics tracing is enabled. */
export function emitTrace(event: DevTraceEvent): void {
  if (!diagnostics.enabled || !diagnostics.onTrace) {
    return;
  }
  diagnostics.onTrace(event);
}

/** Returns true when runtime trace payloads are actually consumed. */
export function shouldEmitTrace(): boolean {
  return diagnostics.enabled && diagnostics.onTrace !== null;
}

/** Returns true when hydration mismatch metadata should be collected. */
export function shouldTrackHydrationDetails(): boolean {
  return diagnostics.devMode || diagnostics.strictHydration;
}

export function shouldThrowHydrationMismatch(): boolean {
  return diagnostics.strictHydration;
}

/** Reports hydration mismatches through callbacks or a console fallback in dev mode. */
export function reportHydrationMismatch(event: HydrationMismatchEvent): void {
  if (!diagnostics.devMode && !diagnostics.strictHydration) {
    return;
  }

  if (diagnostics.onHydrationMismatch) {
    diagnostics.onHydrationMismatch(event);
  } else if (typeof console !== "undefined" && typeof console.warn === "function") {
    console.warn(
      `[tavo hydration mismatch] ${event.message}`,
      event.expected ? `expected=${event.expected}` : "",
      event.found ? `found=${event.found}` : "",
      event.path ? `path=${event.path}` : "",
      event.pathSegments ? `segments=${event.pathSegments.join(">")}` : ""
    );
  }
  if (diagnostics.strictHydration) {
    throw new TavoError("TAVO_HYDRATION_001", event.message, {
      details: { event }
    });
  }
}

/** Reports runtime errors through configured diagnostics or a console fallback. */
export function reportRuntimeError(error: unknown): void {
  if (diagnostics.onError) {
    diagnostics.onError(error);
    return;
  }

  if (typeof console !== "undefined" && typeof console.error === "function") {
    console.error("[tavo runtime error]", error);
  }
}

/** Displays a configured overlay when one is installed through the dev entrypoint. */
export function showConfiguredDevOverlay(error: unknown): void {
  if (!diagnostics.devMode || !overlayHandler) {
    return;
  }
  overlayHandler(error);
}
