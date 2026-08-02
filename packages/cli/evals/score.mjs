export const FIRST_PASS_TARGET = 0.9;
export const REPAIRED_TARGET = 0.95;

export function scoreEvaluationResults(results) {
  if (!Array.isArray(results) || results.length === 0) throw new Error("Evaluation results must be a non-empty array.");
  const firstPassCount = results.filter((result) => result.firstPass).length;
  const repairedCount = results.filter((result) => result.firstPass || result.repaired).length;
  const totalTokens = results.reduce((total, result) => total + result.inputTokens + result.outputTokens, 0);
  const successful = repairedCount;
  return {
    tasks: results.length,
    firstPassRate: firstPassCount / results.length,
    repairedRate: repairedCount / results.length,
    totalTokens,
    correctnessPer10kTokens: totalTokens === 0 ? 0 : successful / (totalTokens / 10_000),
    passed: firstPassCount / results.length >= FIRST_PASS_TARGET && repairedCount / results.length >= REPAIRED_TARGET
  };
}
