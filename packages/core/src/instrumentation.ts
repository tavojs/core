export type TavoInstrumentationEventName =
  | "route.resolve"
  | "route.middleware"
  | "route.loader"
  | "route.action"
  | "route.cache";

export type TavoInstrumentationPhase =
  | "start"
  | "end"
  | "error"
  | "abort"
  | "hit"
  | "miss"
  | "invalidate";

export type TavoInstrumentationEvent = {
  name: TavoInstrumentationEventName;
  phase: TavoInstrumentationPhase;
  timestamp: number;
  requestId?: string;
  route?: string;
  layer?: string;
  durationMs?: number;
  status?: number;
  count?: number;
  cacheTags?: string[];
  error?: unknown;
};

export type TavoInstrumentation = {
  emit(event: TavoInstrumentationEvent): void;
};

export type TavoInstrumentationListener = (event: TavoInstrumentationEvent) => void;

export type OpenTelemetrySpanLike = {
  setAttribute?(name: string, value: string | number | boolean): unknown;
  recordException?(error: unknown): unknown;
  setStatus?(status: { code: number; message?: string }): unknown;
  end?(endTime?: number): unknown;
};

export type OpenTelemetryTracerLike = {
  startSpan(
    name: string,
    options?: { attributes?: Record<string, string | number | boolean>; startTime?: number }
  ): OpenTelemetrySpanLike;
};

/** Creates an isolated observer. Listener failures never interrupt framework work. */
export function createInstrumentation(listener: TavoInstrumentationListener): TavoInstrumentation {
  return {
    emit(event) {
      try {
        listener(event);
      } catch {
        // Observability must not change application behavior.
      }
    }
  };
}

/** Adapts Tavo.js events to the stable tracing subset shared by OpenTelemetry implementations. */
export function createOpenTelemetryInstrumentation(
  tracer: OpenTelemetryTracerLike,
  options?: { recordErrors?: boolean }
): TavoInstrumentation {
  const pending = new Map<string, OpenTelemetrySpanLike[]>();
  const keyFor = (event: TavoInstrumentationEvent) =>
    [event.requestId ?? "global", event.name, event.route ?? "", event.layer ?? ""].join("|");
  const attributesFor = (event: TavoInstrumentationEvent) => {
    const attributes: Record<string, string | number | boolean> = { "tavo.phase": event.phase };
    if (event.requestId) attributes["tavo.request_id"] = event.requestId;
    if (event.route) attributes["tavo.route"] = event.route;
    if (event.layer) attributes["tavo.layer"] = event.layer;
    if (event.status !== undefined) attributes["http.response.status_code"] = event.status;
    if (event.durationMs !== undefined) attributes["tavo.duration_ms"] = event.durationMs;
    if (event.count !== undefined) attributes["tavo.count"] = event.count;
    if (event.cacheTags?.length) attributes["tavo.cache_tags"] = event.cacheTags.join(",");
    return attributes;
  };

  return createInstrumentation((event) => {
    const key = keyFor(event);
    if (event.phase === "start") {
      const span = tracer.startSpan(`tavo.${event.name}`, {
        attributes: attributesFor(event),
        startTime: event.timestamp
      });
      const spans = pending.get(key) ?? [];
      spans.push(span);
      pending.set(key, spans);
      return;
    }

    const spans = pending.get(key);
    const span = spans?.shift() ?? tracer.startSpan(`tavo.${event.name}`, {
      attributes: attributesFor(event),
      startTime: event.durationMs === undefined ? event.timestamp : event.timestamp - event.durationMs
    });
    if (spans?.length === 0) pending.delete(key);
    for (const [name, value] of Object.entries(attributesFor(event))) span.setAttribute?.(name, value);
    if (event.phase === "error") {
      span.setStatus?.({ code: 2, message: "Tavo.js operation failed" });
      if (options?.recordErrors && event.error !== undefined) span.recordException?.(event.error);
    } else if (event.phase === "abort") {
      span.setStatus?.({ code: 2, message: "Tavo.js operation aborted" });
    } else {
      span.setStatus?.({ code: 1 });
    }
    span.end?.(event.timestamp);
  });
}

export function emitInstrumentation(
  instrumentation: TavoInstrumentation | undefined,
  event: Omit<TavoInstrumentationEvent, "timestamp"> & { timestamp?: number }
): void {
  if (!instrumentation) {
    return;
  }
  try {
    instrumentation.emit({
      ...event,
      timestamp: event.timestamp ?? Date.now()
    });
  } catch {
    // Custom implementations receive the same isolation guarantee as the helper.
  }
}
