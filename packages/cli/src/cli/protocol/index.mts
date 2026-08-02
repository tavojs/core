import crypto from "node:crypto";
import { performance } from "node:perf_hooks";
import { AGENT_PROTOCOL_VERSION } from "./catalog.mjs";

export type ProtocolNextAction = {
  command: string;
  reason: string;
};

export type ProtocolEnvelope<T> = {
  schemaVersion: typeof AGENT_PROTOCOL_VERSION;
  command: string;
  ok: boolean;
  project: { fingerprint: string };
  data: T;
  diagnostics: unknown[];
  nextActions: ProtocolNextAction[];
  metrics: {
    durationMs: number;
    bytes: number;
    estimatedTokens: number;
  };
};

export function createProjectFingerprint(value: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
}

export function createProtocolEnvelope<T>(options: {
  command: string;
  data: T;
  diagnostics?: unknown[];
  nextActions?: ProtocolNextAction[];
  fingerprintSource?: unknown;
  startedAt?: number;
  ok?: boolean;
}): ProtocolEnvelope<T> {
  const diagnostics = options.diagnostics ?? [];
  const base = {
    schemaVersion: AGENT_PROTOCOL_VERSION,
    command: options.command,
    ok: options.ok ?? diagnostics.every((item) => (item as { level?: string }).level !== "error"),
    project: { fingerprint: createProjectFingerprint(options.fingerprintSource ?? options.data) },
    data: options.data,
    diagnostics,
    nextActions: options.nextActions ?? [],
    metrics: {
      durationMs: Math.round((performance.now() - (options.startedAt ?? performance.now())) * 100) / 100,
      bytes: 0,
      estimatedTokens: 0
    }
  } satisfies ProtocolEnvelope<T>;
  for (let index = 0; index < 3; index += 1) {
    const bytes = Buffer.byteLength(JSON.stringify(base));
    if (bytes === base.metrics.bytes) break;
    base.metrics.bytes = bytes;
    base.metrics.estimatedTokens = Math.ceil(bytes / 4);
  }
  return base;
}
