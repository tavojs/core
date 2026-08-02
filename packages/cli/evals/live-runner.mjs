import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { agentEvaluationFixtures, agentEvaluationTasks } from "./corpus.mjs";
import { scoreEvaluationResults } from "./score.mjs";

const adapterArg = process.argv[2];
if (!adapterArg) throw new Error("Usage: node evals/live-runner.mjs <adapter-module> [output.json]");
const adapter = await import(pathToFileURL(path.resolve(adapterArg)).href);
if (typeof adapter.runTask !== "function" || typeof adapter.model !== "string") throw new Error("A live adapter must export model:string and runTask(task):Promise<EvaluationResult>.");

const results = [];
for (const task of agentEvaluationTasks) {
  const result = await adapter.runTask({ ...task, fixtureDefinition: agentEvaluationFixtures[task.fixture] });
  results.push({ schemaVersion: 1, model: adapter.model, taskId: task.id, retries: 0, invalidEdits: 0, ...result });
}
const report = { schemaVersion: 1, model: adapter.model, results, score: scoreEvaluationResults(results) };
if (process.argv[3]) await fs.writeFile(path.resolve(process.argv[3]), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify(report, null, 2));
if (!report.score.passed) process.exitCode = 1;
