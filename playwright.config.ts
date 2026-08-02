import { defineConfig } from "@playwright/test";
import fs from "node:fs";

const e2ePort = Number(process.env.TAVO_E2E_PORT || 5187);
const baseURL = `http://127.0.0.1:${e2ePort}`;
const monitorToken = process.env.TAVO_MONITOR_TOKEN || "tavo-e2e-monitor-token-2026";
const sessionSecret = process.env.TAVO_PREVIEW_SESSION_SECRET || "tavo-e2e-session-secret-at-least-thirty-two-bytes";
const chromePath = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const launchOptions = fs.existsSync(chromePath)
  ? {
      executablePath: chromePath
    }
  : undefined;

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  expect: {
    timeout: 5_000
  },
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL,
    browserName: "chromium",
    headless: true,
    launchOptions
  },
  webServer: {
    command: `PORT=${e2ePort} npm --prefix preview run start:ssr`,
    env: {
      TAVO_MONITOR_TOKEN: monitorToken,
      TAVO_PREVIEW_SESSION_SECRET: sessionSecret
    },
    url: baseURL,
    reuseExistingServer: process.env.TAVO_E2E_REUSE_SERVER === "1",
    timeout: 120_000
  }
});
