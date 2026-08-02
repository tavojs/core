import assert from "node:assert/strict";
import test from "node:test";
import { agentEvaluationFixtures, agentEvaluationTasks } from "../evals/corpus.mjs";
import { scoreEvaluationResults } from "../evals/score.mjs";

test("agent evaluation corpus certifies at least forty authoring and repair tasks", () => {
  assert.equal(agentEvaluationTasks.length, 45);
  assert.equal(new Set(agentEvaluationTasks.map((task) => task.id)).size, 45);
  assert.deepEqual(new Set(agentEvaluationTasks.map((task) => task.task)), new Set([
    "create-route", "modify-route", "create-component", "modify-component", "add-loader", "add-action", "modify-store", "style-ui", "repair"
  ]));
  assert.equal(Object.keys(agentEvaluationFixtures).length, 5);
});

test("agent result scoring enforces first-pass and repaired release thresholds", () => {
  const passing = Array.from({ length: 20 }, (_, index) => ({ inputTokens: 1000, outputTokens: 500, firstPass: index < 18, repaired: index < 19 }));
  assert.equal(scoreEvaluationResults(passing).passed, true);
  const failing = passing.map((result, index) => ({ ...result, firstPass: index < 17 }));
  assert.equal(scoreEvaluationResults(failing).passed, false);
});
