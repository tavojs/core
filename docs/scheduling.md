# Scheduling

> Online guide:
> [tavojs.dev/docs/core/scheduling-and-instrumentation](https://tavojs.dev/docs/core/scheduling-and-instrumentation)

Tavo.js batches component updates and supports explicit priorities for expensive or non-urgent state changes.

## Background Transitions

```ts
import { startTransition } from "@tavojs/core/dev";

startTransition(() => {
  resultsStore.patch({ filter: nextFilter });
});
```

Store notifications still happen synchronously, but subscribed component rendering yields until background work runs. A newer urgent update upgrades the queued component instead of rendering obsolete background work first.

## Explicit Priorities

```ts
import { runWithUpdatePriority } from "@tavojs/core/dev";

runWithUpdatePriority("user-blocking", () => {
  formStore.patch({ value });
});
```

Priorities are `immediate`, `user-blocking`, `normal`, `background`, and `idle`. Immediate through normal work remains microtask-batched; background work uses a later task; idle work uses `requestIdleCallback` when available.

## Synchronous Updates

```ts
import { flushSync } from "@tavojs/core/dev";

flushSync(() => {
  dialogStore.patch({ open: true });
});
```

Use `flushSync()` only when code must read the updated DOM immediately. Normal batching and transitions generally produce better responsiveness.
