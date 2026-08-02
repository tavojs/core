# Observability

> Online guide:
> [tavojs.dev/docs/core/scheduling-and-instrumentation](https://tavojs.dev/docs/core/scheduling-and-instrumentation)

Tavo provides framework-neutral structured instrumentation. It has no required telemetry vendor and does not collect data unless an application supplies an observer.

## Configure an Observer

```ts
import { defineConfig } from "@tavojs/core/config";
import { createInstrumentation } from "@tavojs/core/dev";

const instrumentation = createInstrumentation((event) => {
  metrics.record(event.name, event.durationMs, {
    phase: event.phase,
    route: event.route,
  });
});

export default defineConfig({
  ssr: {
    instrumentation,
  },
});
```

`createInstrumentation()` isolates observer exceptions so telemetry failures cannot interrupt routing or server responses. Custom objects with an `emit(event)` method receive the same isolation inside the runtime.

## Events

Current event names are:

- `route.resolve`
- `route.middleware`
- `route.loader`
- `route.action`
- `route.cache`

Phases distinguish starts, successful completions, errors, aborts, cache hits, cache misses, and invalidation. Timed events include `durationMs`; related events share a process-local `requestId`.

## Privacy

Framework events intentionally contain route patterns and lifecycle metadata rather than request bodies, headers, cookies, authorization values, loader results, or store state. Treat custom error objects as potentially sensitive before exporting them to an external service.

## OpenTelemetry

Use the dependency-free adapter with any OpenTelemetry-compatible tracer:

```ts
import { trace } from "@opentelemetry/api";
import { createOpenTelemetryInstrumentation } from "@tavojs/core/dev";

const instrumentation = createOpenTelemetryInstrumentation(
  trace.getTracer("my-tavo-app")
);
```

The adapter pairs start/terminal lifecycle events into spans and records route, layer, timing,
status, and cache metadata as attributes. Error objects are not exported by default because they
may contain application data. Set `{ recordErrors: true }` only after configuring redaction.
Sampling, processors, and exporters remain in the application deployment layer, so Tavo adds no
OpenTelemetry runtime dependency.
