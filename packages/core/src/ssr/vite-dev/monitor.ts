import { readRequestHeader } from "../request.js";
import { runtimeImport } from "../runtime.js";

export type DevMonitorState = {
  startedAt: number;
  requestCount: number;
  inflight: number;
  errorCount: number;
  cacheHits: number;
  cacheMisses: number;
  lastRequestAt: number | null;
  lastRenderDurationMs: number | null;
  totalRenderDurationMs: number;
  maxRenderDurationMs: number;
  routeHits: Record<string, number>;
};

export function getProcessEnvValue(name: string): string | undefined {
  const processRef = (globalThis as unknown as { process?: { env?: Record<string, string | undefined> } }).process;
  const value = processRef?.env?.[name];
  return value && value.length > 0 ? value : undefined;
}

export function isPageRenderMethod(method: string | undefined): boolean {
  const normalized = (method ?? "GET").toUpperCase();
  return normalized === "GET" || normalized === "HEAD";
}

export function createDevStaticCacheKey(pathname: string, search: string, request: unknown, vary: string[] = []): string {
  const varyHeaders = Array.from(new Set(["accept-language", ...vary.map((header) => header.toLowerCase())]));
  const varyKey = varyHeaders
    .map((header) => `${header}=${readRequestHeader(request, header) ?? ""}`)
    .join("::");
  const base = `${pathname}${search}`;
  return varyKey ? `${base}::${varyKey}` : base;
}

export async function createMonitorPayload(
  state: DevMonitorState,
  options: {
    url: string;
    mode: "vite-dev";
    cacheEntries: number;
    port: number;
    host: string;
  }
) {
  const os = await runtimeImport("node:os");
  const processRef = (globalThis as unknown as {
    process?: {
      pid?: number;
      uptime?: () => number;
      memoryUsage?: () => Record<string, number>;
      cpuUsage?: () => { user: number; system: number };
    };
  }).process;

  const uptimeSeconds =
    typeof processRef?.uptime === "function"
      ? processRef.uptime()
      : Math.max(0, Math.round((Date.now() - state.startedAt) / 1000));
  const memory = typeof processRef?.memoryUsage === "function" ? processRef.memoryUsage() : {};
  const cpu = typeof processRef?.cpuUsage === "function" ? processRef.cpuUsage() : { user: 0, system: 0 };

  return {
    server: {
      url: options.url,
      mode: options.mode,
      pid: processRef?.pid ?? null,
      uptimeSeconds,
      port: options.port,
      host: options.host
    },
    requests: {
      total: state.requestCount,
      inflight: state.inflight,
      errors: state.errorCount,
      cacheHits: state.cacheHits,
      cacheMisses: state.cacheMisses,
      cacheEntries: options.cacheEntries,
      averageRenderDurationMs:
        state.requestCount > 0 ? Number((state.totalRenderDurationMs / state.requestCount).toFixed(2)) : 0,
      lastRenderDurationMs: state.lastRenderDurationMs,
      maxRenderDurationMs: state.maxRenderDurationMs,
      lastRequestAt: state.lastRequestAt ? new Date(state.lastRequestAt).toISOString() : null,
      topRoutes: Object.entries(state.routeHits)
        .sort((left, right) => right[1] - left[1])
        .slice(0, 5)
        .map(([pathname, hits]) => ({ pathname, hits }))
    },
    process: {
      rss: memory.rss ?? 0,
      heapUsed: memory.heapUsed ?? 0,
      heapTotal: memory.heapTotal ?? 0,
      external: memory.external ?? 0,
      cpuUserMicros: cpu.user ?? 0,
      cpuSystemMicros: cpu.system ?? 0,
      loadAverage: typeof os.loadavg === "function" ? os.loadavg() : []
    },
    timestamp: new Date().toISOString()
  };
}
