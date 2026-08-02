export {
  configureDevDiagnostics,
  type DevDiagnosticsOptions,
  type DevTraceEvent,
  type DevTracePhase,
  type HydrationMismatchEvent
} from "./runtime/dom/diagnostics-core.js";

export { installDevOverlay } from "./runtime/dom/overlay.js";

export { startViteAutoPagesDevServer } from "./ssr/vite-dev.js";
export type {
  RunningDevServer,
  ViteAutoPagesDevServerOptions,
  ViteDevServerLike,
} from "./ssr/types.js";

export { getAutoPagesInspection } from "./auto-pages/index.js";
export {
  createPagesManifest,
  createPagesManifestDetailed,
  inspectPages,
} from "./framework/index.js";
export { inspectPluginGraph } from "./plugins/compiler.js";
export { loadTavoConfig, type LoadTavoConfigOptions } from "./config/load.js";
export * from "./devtools.js";
export {
  createInstrumentation,
  createOpenTelemetryInstrumentation,
  type OpenTelemetrySpanLike,
  type OpenTelemetryTracerLike,
  type TavoInstrumentation,
  type TavoInstrumentationEvent,
  type TavoInstrumentationEventName,
  type TavoInstrumentationListener,
  type TavoInstrumentationPhase,
} from "./instrumentation.js";
export * from "./scheduler.js";
export * from "./testing.js";
export * from "./validation.js";
