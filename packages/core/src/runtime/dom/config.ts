export type KeyedReconciliationStrategy = "auto" | "strict";

export type DomRuntimeOptions = {
  keyedStrategy?: KeyedReconciliationStrategy;
  keyedLargeListOptimizationThreshold?: number;
};

const runtimeConfig: Required<DomRuntimeOptions> = {
  keyedStrategy: "auto",
  keyedLargeListOptimizationThreshold: 100
};

export function configureDomRuntime(options: DomRuntimeOptions): void {
  if (options.keyedStrategy !== undefined) {
    runtimeConfig.keyedStrategy = options.keyedStrategy;
  }
  if (options.keyedLargeListOptimizationThreshold !== undefined) {
    runtimeConfig.keyedLargeListOptimizationThreshold = Math.max(
      1,
      options.keyedLargeListOptimizationThreshold
    );
  }
}

export function getDomRuntimeConfig(): Required<DomRuntimeOptions> {
  return runtimeConfig;
}
