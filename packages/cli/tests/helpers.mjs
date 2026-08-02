import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export function tavoConfigFixture(objectSource = "{}") {
  return [
    "function defineConfig(config) {",
    '  Object.defineProperty(config, Symbol.for("@tavojs/core/config/defined"), { value: true });',
    "  return config;",
    "}",
    `export default defineConfig(${objectSource});`,
    "",
  ].join("\n");
}

export async function createTempProject(prefix = "tavo-cli-test-") {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.writeFile(
    path.join(root, "tavo.config.ts"),
    tavoConfigFixture(),
    "utf8",
  );
  return root;
}

export async function writeFixtureFile(rootDir, relativePath, content = "") {
  const target = path.join(rootDir, relativePath);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return target;
}

export async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

export async function withCwd(cwd, callback) {
  const previous = process.cwd();
  process.chdir(cwd);
  try {
    return await callback();
  } finally {
    process.chdir(previous);
  }
}

export async function captureConsole(callback) {
  const logs = [];
  const errors = [];
  const originalLog = console.log;
  const originalError = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  try {
    const result = await callback();
    return {
      result,
      stdout: logs.join("\n"),
      stderr: errors.join("\n")
    };
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

export function assertIncludes(haystack, needle) {
  assert.ok(haystack.includes(needle), `Expected output to include ${JSON.stringify(needle)}.\n\n${haystack}`);
}
