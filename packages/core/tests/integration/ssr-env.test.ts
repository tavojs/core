import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadServerEnv } from "../../src/ssr/index.ts";

test("loadServerEnv loads server env files with mode priority and shell env precedence", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-env-"));
  const fromFileKey = "TAVO_TEST_ENV_FROM_FILE";
  const shellKey = "TAVO_TEST_ENV_SHELL_WINS";
  const modeKey = "TAVO_TEST_ENV_MODE";
  const previousFromFile = process.env[fromFileKey];
  const previousShell = process.env[shellKey];
  const previousMode = process.env[modeKey];

  try {
    delete process.env[fromFileKey];
    process.env[shellKey] = "shell";
    delete process.env[modeKey];

    await fs.writeFile(
      path.join(root, ".env"),
      `${fromFileKey}=base\n${shellKey}=file\n${modeKey}=base\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".env.test"),
      `${fromFileKey}=mode\n${modeKey}=mode\n`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, ".env.test.local"),
      `${fromFileKey}=mode-local\n`,
      "utf8"
    );

    const loaded = loadServerEnv({ root, mode: "test" });

    assert.equal(loaded[fromFileKey], "mode-local");
    assert.equal(loaded[modeKey], "mode");
    assert.equal(process.env[fromFileKey], "mode-local");
    assert.equal(process.env[modeKey], "mode");
    assert.equal(process.env[shellKey], "shell");
  } finally {
    if (previousFromFile === undefined) {
      delete process.env[fromFileKey];
    } else {
      process.env[fromFileKey] = previousFromFile;
    }
    if (previousShell === undefined) {
      delete process.env[shellKey];
    } else {
      process.env[shellKey] = previousShell;
    }
    if (previousMode === undefined) {
      delete process.env[modeKey];
    } else {
      process.env[modeKey] = previousMode;
    }
    await fs.rm(root, { recursive: true, force: true });
  }
});
