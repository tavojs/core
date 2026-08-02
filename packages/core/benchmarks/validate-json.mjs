import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

const inputPath = process.argv[2] ?? "benchmarks/results/latest.json";
const payload = JSON.parse(await fs.readFile(path.resolve(inputPath), "utf8"));

assert.equal(typeof payload.generatedAt, "string");
assert.equal(typeof payload.node, "string");
assert.ok(payload.baseline === null || typeof payload.baseline === "string" || payload.baseline === undefined);
assert.ok(Array.isArray(payload.benchmarks));
assert.ok(payload.benchmarks.length > 0);

for (const entry of payload.benchmarks) {
  assert.equal(typeof entry.name, "string");
  assert.equal(typeof entry.iterations, "number");
  assert.equal(typeof entry.avgMs, "number");
  assert.equal(typeof entry.avgOpMs, "number");
  assert.equal(typeof entry.opsPerSecond, "number");
  assert.ok(entry.baselineAvgOpMs === null || typeof entry.baselineAvgOpMs === "number" || entry.baselineAvgOpMs === undefined);
  assert.ok(entry.regressionPercent === null || typeof entry.regressionPercent === "number" || entry.regressionPercent === undefined);
  assert.ok(entry.threshold && typeof entry.threshold === "object");
  assert.ok(entry.thresholdStatus === "pass" || entry.thresholdStatus === "fail");
  assert.ok(Array.isArray(entry.thresholdFailures));
}

const failures = payload.benchmarks.filter((entry) => entry.thresholdStatus === "fail");
if (failures.length > 0) {
  console.error("Benchmark JSON contains failed thresholds:");
  for (const entry of failures) {
    console.error(`- ${entry.name}: ${entry.thresholdFailures.join("; ")}`);
  }
  process.exitCode = 1;
}
