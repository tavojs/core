import type { MonitorPayload } from "./cli/types.mjs";

function pad(value: string, width: number): string {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}

function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  const kb = bytes / 1024;
  if (kb < 1024) {
    return `${kb.toFixed(1)} kB`;
  }
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatDurationMs(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return "0 ms";
  }
  if (value < 1000) {
    return `${Math.round(value)} ms`;
  }
  return `${(value / 1000).toFixed(2)} s`;
}

function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return "0s";
  }
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${secs}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
}

/** Formats one monitor payload as a stable terminal table. */
export function renderMonitorPayload(payload: MonitorPayload, monitorUrl: string): string {
  const rows: Array<[string, string]> = [
    ["Monitor URL", monitorUrl],
    ["Mode", payload.server?.mode ?? "unknown"],
    ["PID", String(payload.server?.pid ?? "n/a")],
    ["Uptime", formatSeconds(payload.server?.uptimeSeconds ?? 0)],
    [
      "Requests",
      `${payload.requests?.total ?? 0} total | ${payload.requests?.inflight ?? 0} inflight | ${payload.requests?.errors ?? 0} errors`
    ],
    [
      "Latency",
      `avg ${formatDurationMs(payload.requests?.averageRenderDurationMs ?? 0)} | last ${formatDurationMs(payload.requests?.lastRenderDurationMs ?? 0)} | max ${formatDurationMs(payload.requests?.maxRenderDurationMs ?? 0)}`
    ],
    [
      "Cache",
      `${payload.requests?.cacheHits ?? 0} hits | ${payload.requests?.cacheMisses ?? 0} misses | ${payload.requests?.cacheEntries ?? payload.requests?.staticAssetHits ?? 0} entries/assets`
    ],
    [
      "Memory",
      `rss ${formatSize(payload.process?.rss ?? 0)} | heap ${formatSize(payload.process?.heapUsed ?? 0)} / ${formatSize(payload.process?.heapTotal ?? 0)}`
    ],
    [
      "CPU",
      `user ${formatDurationMs((payload.process?.cpuUserMicros ?? 0) / 1000)} | system ${formatDurationMs((payload.process?.cpuSystemMicros ?? 0) / 1000)}`
    ],
    [
      "Load Avg",
      Array.isArray(payload.process?.loadAverage)
        ? payload.process.loadAverage.map((value: number) => Number(value).toFixed(2)).join(", ")
        : "n/a"
    ],
    ["Last Hit", payload.requests?.lastRequestAt ?? "n/a"]
  ];
  const labelWidth = Math.max(...rows.map(([label]) => label.length), "Metric".length);
  const valueWidth = Math.max(...rows.map(([, value]) => String(value).length), "Value".length);
  const border = `+${"-".repeat(labelWidth + 2)}+${"-".repeat(valueWidth + 2)}+`;
  const lines = [
    border,
    `| ${pad("Metric", labelWidth)} | ${pad("Value", valueWidth)} |`,
    border,
    ...rows.map(([label, value]) => `| ${pad(label, labelWidth)} | ${pad(String(value), valueWidth)} |`),
    border
  ];

  const topRoutes = Array.isArray(payload.requests?.topRoutes) ? payload.requests.topRoutes : [];
  if (topRoutes.length > 0) {
    lines.push("");
    const routeWidth = Math.max(...topRoutes.map((route) => route.pathname.length), "Path".length);
    const hitsWidth = Math.max(...topRoutes.map((route) => String(route.hits).length), "Hits".length);
    const routeBorder = `+${"-".repeat(routeWidth + 2)}+${"-".repeat(hitsWidth + 2)}+`;
    lines.push("Top routes");
    lines.push(routeBorder);
    lines.push(`| ${pad("Path", routeWidth)} | ${pad("Hits", hitsWidth)} |`);
    lines.push(routeBorder);
    for (const route of topRoutes) {
      lines.push(`| ${pad(route.pathname, routeWidth)} | ${pad(String(route.hits), hitsWidth)} |`);
    }
    lines.push(routeBorder);
  }

  return lines.join("\n");
}
