import { renderMonitorPayload } from "../../monitor-renderer.mjs";
import type { MonitorFlags, MonitorPayload } from "../types.mjs";

function monitorAuthHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function readMonitorPayload(url: string, token = ""): Promise<MonitorPayload> {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: monitorAuthHeaders(token)
    });
  } catch {
    throw new Error(
      [
        `tavo monitor: could not connect to ${url}.`,
        "Start an SSR server with `tavo preview --ssr`, or pass its address with `--url <server-url>`."
      ].join("\n")
    );
  }
  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(
        [
          `tavo monitor: monitor endpoint was not found at ${url} (HTTP 404).`,
          "The production SSR server hides this endpoint unless `TAVO_MONITOR_TOKEN` is configured.",
          "Set the token on the server and pass the same value with `--token <token>` or through the CLI environment."
        ].join("\n")
      );
    }
    if (response.status === 401 || response.status === 403) {
      throw new Error(
        [
          `tavo monitor: authentication was rejected by ${url} (HTTP ${response.status}).`,
          "Pass the server's `TAVO_MONITOR_TOKEN` with `--token <token>` or through the CLI environment."
        ].join("\n")
      );
    }
    const statusText = response.statusText ? ` ${response.statusText}` : "";
    throw new Error(
      `tavo monitor: request to ${url} failed with HTTP ${response.status}${statusText}.`
    );
  }
  return await response.json();
}

function defaultMonitorUrl(flags: MonitorFlags = {}): string {
  const base = typeof flags.url === "string" ? flags.url : "http://127.0.0.1:4174";
  return base.endsWith("/_tavo/monitor") ? base : `${base.replace(/\/+$/, "")}/_tavo/monitor`;
}

export async function monitorServer(flags: MonitorFlags = {}): Promise<void> {
  const monitorUrl = defaultMonitorUrl(flags);
  const token = typeof flags.token === "string" ? flags.token : process.env.TAVO_MONITOR_TOKEN ?? "";
  const watch = flags.once ? false : true;
  const asJson = Boolean(flags.json);
  const intervalMs = typeof flags.interval === "string" ? Math.max(250, Number(flags.interval) || 1000) : 1000;

  const printOnce = async (): Promise<void> => {
    const payload = await readMonitorPayload(monitorUrl, token);
    if (asJson) {
      console.log(JSON.stringify(payload, null, 2));
      return;
    }
    console.log(renderMonitorPayload(payload, monitorUrl));
  };

  if (!watch) {
    await printOnce();
    return;
  }

  while (true) {
    if (typeof console.clear === "function") {
      console.clear();
    }
    try {
      await printOnce();
    } catch (error) {
      console.error(String(error));
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
