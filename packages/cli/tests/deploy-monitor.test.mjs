import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewServerSource } from "../dist/cli/build/templates.mjs";
import { monitorServer } from "../dist/cli/commands/monitor.mjs";
import { renderMonitorPayload } from "../dist/monitor-renderer.mjs";

async function withMockFetch(mockFetch, callback) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mockFetch;
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test("monitor renderer prints stable tables for server and route stats", () => {
  const output = renderMonitorPayload(
    {
      server: { mode: "production-ssr", pid: 123, uptimeSeconds: 65 },
      requests: {
        total: 10,
        inflight: 2,
        errors: 1,
        averageRenderDurationMs: 12.4,
        lastRenderDurationMs: 8,
        maxRenderDurationMs: 24,
        staticAssetHits: 3,
        lastRequestAt: "2026-05-09T10:00:00.000Z",
        topRoutes: [{ pathname: "/store", hits: 7 }]
      },
      process: {
        rss: 2048,
        heapUsed: 1024,
        heapTotal: 4096,
        cpuUserMicros: 5000,
        cpuSystemMicros: 3000,
        loadAverage: [1, 2, 3]
      }
    },
    "http://127.0.0.1:4174/_tavo/monitor"
  );

  assert.match(output, /Monitor URL/);
  assert.match(output, /production-ssr/);
  assert.match(output, /Top routes/);
  assert.match(output, /\/store/);
});

test("generated production monitor requires a bearer token even on loopback", () => {
  const source = createPreviewServerSource();
  assert.match(source, /if \(!monitorToken\) return false/);
  assert.match(source, /req\.headers\.authorization === expected/);
  assert.doesNotMatch(source, /isLocalHost\(host\)/);
  assert.doesNotMatch(source, /searchParams\.get\("token"\)/);
  assert.match(source, /process\.env\.NODE_ENV \|\|= "production"/);
});

test("monitor connection errors identify the URL and suggest starting SSR", async () => {
  await withMockFetch(
    async () => {
      throw new TypeError("fetch failed");
    },
    async () => {
      await assert.rejects(
        monitorServer({ once: true }),
        (error) => {
          assert.match(error.message, /could not connect to http:\/\/127\.0\.0\.1:4174\/_tavo\/monitor/);
          assert.match(error.message, /tavo preview --ssr/);
          assert.match(error.message, /--url <server-url>/);
          assert.doesNotMatch(error.message, /^fetch failed$/);
          return true;
        }
      );
    }
  );
});

test("monitor 404 errors explain the required token", async () => {
  await withMockFetch(
    async () => new Response("Not found", { status: 404 }),
    async () => {
      await assert.rejects(
        monitorServer({ once: true }),
        (error) => {
          assert.match(error.message, /monitor endpoint was not found/);
          assert.match(error.message, /TAVO_MONITOR_TOKEN/);
          assert.match(error.message, /--token <token>/);
          return true;
        }
      );
    }
  );
});

test("generated preview server contains request failures instead of rethrowing", () => {
  const source = createPreviewServerSource();

  assert.doesNotMatch(source, /catch \(error\)[\s\S]{0,120}throw error/);
  assert.match(source, /Internal Server Error/);
  assert.match(source, /res\.headersSent/);
  assert.match(source, /res\.writableEnded/);
});

test("generated preview server caches fingerprinted assets and sizes buffered files", () => {
  const source = createPreviewServerSource();

  assert.match(source, /if \(segments\.length === 0\) \{\s+return \[\];/);
  assert.match(source, /public, max-age=31536000, immutable/);
  assert.match(source, /return segments\[0\] === "assets"/);
  assert.match(source, /: "no-cache"/);
  assert.match(source, /"Content-Length": String\(body\.byteLength\)/);
  assert.match(source, /"Cache-Control": cacheControlForFilePath\(assetPath\)/);
});
