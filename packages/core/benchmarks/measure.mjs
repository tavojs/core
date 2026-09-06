import { performance } from "node:perf_hooks";

export async function runBenchmark(name, options, fn, consume) {
  const rounds = options.rounds ?? 6;
  const iterations = options.iterations ?? 1_000;
  const warmupIterations = options.warmupIterations ?? Math.max(100, Math.floor(iterations / 10));
  const isAsync = options.async === true;

  for (let index = 0; index < warmupIterations; index += 1) {
    const fixture = options.setup?.(index);
    try {
      consume(isAsync ? await fn(index, fixture) : fn(index, fixture));
    } finally {
      options.teardown?.(fixture);
    }
  }

  const samplesMs = [];
  for (let round = 0; round < rounds; round += 1) {
    let elapsedMs = 0;
    if (options.setup || options.teardown) {
      // Stateful workloads need fresh fixtures, but fixture creation and cleanup
      // must not be counted as framework execution time.
      for (let index = 0; index < iterations; index += 1) {
        const fixture = options.setup?.(index);
        const startedAt = performance.now();
        try {
          consume(isAsync ? await fn(index, fixture) : fn(index, fixture));
        } finally {
          elapsedMs += performance.now() - startedAt;
          options.teardown?.(fixture);
        }
      }
    } else {
      const startedAt = performance.now();
      for (let index = 0; index < iterations; index += 1) {
        consume(isAsync ? await fn(index) : fn(index));
      }
      elapsedMs = performance.now() - startedAt;
    }
    samplesMs.push(elapsedMs);
  }

  const avgMs = samplesMs.reduce((sum, value) => sum + value, 0) / samplesMs.length;
  const ordered = [...samplesMs].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  const medianMs = ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
  return {
    name,
    iterations,
    rounds,
    warmupIterations,
    samplesMs,
    avgMs,
    avgOpMs: avgMs / iterations,
    medianMs,
    medianOpMs: medianMs / iterations,
    opsPerSecond: (iterations / avgMs) * 1_000,
  };
}
