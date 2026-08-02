import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { agentEvaluationFixtures, agentEvaluationTasks } from "./corpus.mjs";

const packageRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const cli = path.join(packageRoot, "dist", "tavo.mjs");
const contextTargetsMs = { cold: 500, cached: 200 };
const enforceContextTiming = process.env.GITHUB_ACTIONS !== "true"
  || process.env.TAVO_ENFORCE_PERFORMANCE === "1";
const contextLimitsMs = enforceContextTiming ? contextTargetsMs : null;
const taskNames = new Set(["create-route", "modify-route", "create-component", "modify-component", "add-loader", "add-action", "modify-store", "style-ui", "repair"]);
assert.ok(agentEvaluationTasks.length >= 40, "The certified corpus must contain at least 40 tasks.");
assert.equal(new Set(agentEvaluationTasks.map((task) => task.id)).size, agentEvaluationTasks.length, "Task ids must be unique.");
for (const task of agentEvaluationTasks) {
  assert.equal(task.schemaVersion, 1);
  assert.ok(taskNames.has(task.task));
  assert.ok(task.prompt.length > 20);
  assert.ok(task.assertions.length >= 3);
  assert.ok(agentEvaluationFixtures[task.fixture]);
  assert.equal(task.maxContextBytes, 8192);
}

for (const schema of ["protocol-v1", "context-v1", "diagnostic-v1", "change-plan-v1", "change-receipt-v1", "evaluation-result-v1"]) {
  const parsed = JSON.parse(await fs.readFile(path.join(packageRoot, "schemas", `${schema}.schema.json`), "utf8"));
  assert.ok(parsed.$id.includes(schema));
}

const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "tavo-agent-eval-"));
await fs.mkdir(path.join(fixture, "src", "pages"), { recursive: true });
await fs.writeFile(path.join(fixture, "package.json"), '{"name":"agent-medium","type":"module"}\n', "utf8");
await fs.writeFile(path.join(fixture, "tavo.config.ts"), [
  "function defineConfig(config) {",
  '  Object.defineProperty(config, Symbol.for("@tavojs/core/config/defined"), { value: true });',
  "  return config;",
  "}",
  "export default defineConfig({});",
  ""
].join("\n"), "utf8");
for (let index = 0; index < 100; index += 1) {
  await fs.writeFile(path.join(fixture, "src", "pages", `route-${index}.tsx`), `export default function Route${index}(){return <main>${index}</main>}\n`, "utf8");
}

function runContext() {
  const result = spawnSync(process.execPath, [cli, "agent-context", "--json", "--task", "modify-route", "--target", "/route-50"], { cwd: fixture, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function assertContextDuration(label, durationMs, targetMs, limitMs) {
  if (durationMs >= targetMs) {
    console.warn(
      `[tavo agent evaluation] ${label} context took ${durationMs}ms; `
      + `the target is below ${targetMs}ms.`
    );
  }
  if (limitMs === null) {
    return;
  }
  assert.ok(
    durationMs < limitMs,
    `${label} context took ${durationMs}ms; expected below ${limitMs}ms.`
  );
}

const cold = runContext();
const warm = runContext();
assert.ok(cold.metrics.bytes <= 8192, `Compact context was ${cold.metrics.bytes} bytes.`);
assert.ok(cold.metrics.estimatedTokens <= 2000, `Compact context was approximately ${cold.metrics.estimatedTokens} tokens.`);
assertContextDuration("Cold", cold.metrics.durationMs, contextTargetsMs.cold, contextLimitsMs?.cold ?? null);
assertContextDuration("Cached", warm.metrics.durationMs, contextTargetsMs.cached, contextLimitsMs?.cached ?? null);
assert.equal(cold.data.focus.file, "src/pages/route-50.tsx");

await fs.rm(fixture, { recursive: true, force: true });
console.log(JSON.stringify({
  schemaVersion: 1,
  ok: true,
  tasks: agentEvaluationTasks.length,
  context: { bytes: cold.metrics.bytes, estimatedTokens: cold.metrics.estimatedTokens, coldMs: cold.metrics.durationMs, cachedMs: warm.metrics.durationMs },
  thresholds: {
    firstPass: 0.9,
    repaired: 0.95,
    contextMs: {
      target: contextTargetsMs,
      enforced: contextLimitsMs,
      environment: process.env.GITHUB_ACTIONS === "true" ? "github-actions" : "local",
      enforcement: enforceContextTiming ? "blocking" : "report-only"
    }
  }
}, null, 2));
