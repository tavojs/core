import type { Child } from "./jsx.js";
import { createPagesRuntime } from "./framework/runtime.js";
import type {
  PageModules,
  PageRuntimeOptions
} from "./framework/types.js";
export { clearServices, unregisterService } from "./framework/services.js";
import { createRoot } from "./runtime/dom/root.js";
import {
  configureDevDiagnostics,
  type DevTraceEvent,
  type HydrationMismatchEvent
} from "./runtime/dom/diagnostics.js";

export type TestRoot = {
  container: HTMLElement;
  render(node: Child): void;
  hydrate(node: Child): void;
  unmount(): void;
  text(): string;
  html(): string;
};

export function createTestRoot(): TestRoot {
  if (typeof document === "undefined") {
    throw new Error("@tavojs/core/dev: createTestRoot requires a DOM environment.");
  }

  const container = document.createElement("div");
  const root = createRoot(container);

  return {
    container,
    render(node: Child): void {
      root.render(node);
    },
    hydrate(node: Child): void {
      root.hydrate(node);
    },
    unmount(): void {
      root.unmount();
    },
    text(): string {
      return container.textContent ?? "";
    },
    html(): string {
      return container.innerHTML;
    }
  };
}

export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => {
    queueMicrotask(() => resolve());
  });
}

export function captureDiagnostics(): {
  traces: DevTraceEvent[];
  mismatches: HydrationMismatchEvent[];
  restore(): void;
} {
  const traces: DevTraceEvent[] = [];
  const mismatches: HydrationMismatchEvent[] = [];

  configureDevDiagnostics({
    enabled: true,
    devMode: true,
    onTrace(event) {
      traces.push(event);
    },
    onHydrationMismatch(event) {
      mismatches.push(event);
    }
  });

  return {
    traces,
    mismatches,
    restore(): void {
      configureDevDiagnostics({
        enabled: false,
        devMode: false,
        onTrace: null,
        onHydrationMismatch: null
      });
    }
  };
}

export function expectTextContent(root: TestRoot, expected: string): void {
  const actual = root.text();
  if (actual !== expected) {
    throw new Error(
      `@tavojs/core/dev: expected text "${expected}" but received "${actual}".`
    );
  }
}

export function createPagesTestHarness(
  modules: PageModules,
  options?: PageRuntimeOptions
): {
  runtime: ReturnType<typeof createPagesRuntime>;
  renderPath(pathname: string): string;
  resolvePath(pathname: string): Promise<unknown>;
} {
  const runtime = createPagesRuntime(modules, options);
  return {
    runtime,
    renderPath(pathname: string): string {
      if (typeof document === "undefined") {
        throw new Error("@tavojs/core/dev: renderPath requires a DOM environment.");
      }
      const root = createTestRoot();
      root.render(runtime.renderPath(pathname));
      return root.html();
    },
    async resolvePath(pathname: string): Promise<unknown> {
      return runtime.resolvePathAsync(pathname);
    }
  };
}
