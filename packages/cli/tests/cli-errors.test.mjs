import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../dist/tavo.mjs",
);

test("CLI errors omit stack traces by default", () => {
  const result = spawnSync(process.execPath, [cliFile, "create"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.equal(result.stderr, 'tavo CLI: unknown command "create".\n');
  assert.doesNotMatch(result.stderr, /\bat runCli\b/);
});

test("CLI --debug includes the error stack trace", () => {
  const result = spawnSync(process.execPath, [cliFile, "create", "--debug"], {
    encoding: "utf8",
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Error: tavo CLI: unknown command "create"\./);
  assert.match(result.stderr, /\bat runCli\b/);
});
