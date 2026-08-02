# Async Work And Cancellation

> Online guide: [tavojs.dev/docs/core/async-ownership](https://tavojs.dev/docs/core/async-ownership)

Every long-running operation should have an owner. In Tavo, route work belongs to a navigation or
server request, resources belong to their latest load, and deferred work belongs to its explicit
signal or rendering lifecycle. This prevents obsolete work from publishing state after its owner
has moved on.

## Route Work

Loaders and middleware receive `signal`. A new browser navigation aborts the previous navigation;
disposing the auto-pages runtime aborts all pending navigation and prefetch work. Node handlers
also propagate client disconnects through the normalized Fetch `Request.signal`.

```ts
import type { PageLoadContext } from "@tavojs/core/router";

export async function load({ signal }: PageLoadContext) {
  const response = await fetch("https://api.example.com/items", { signal });
  return response.json();
}
```

Abort errors are control flow, not route failures. Tavo does not commit loader data or error UI
from superseded work.

## Resources

`createResource(loader)` passes `{ signal }` to the loader. Starting a new `load()` aborts the
previous load. `preload()` deduplicates concurrent callers, while `abort()` and `reset()` settle
waiters and reject late results even when the underlying dependency ignores cancellation.

```ts
const profile = createResource(({ signal }) =>
  fetch("/api/profile", { signal }).then((response) => response.json())
);

await profile.preload();
profile.abort();
```

An externally owned signal can be passed to `load({ signal })` or `preload({ signal })`.

## Deferred Work

`Deferred` and `createDeferredValue` accept `signal`. A timeout or abort settles the framework
wrapper and detaches its listeners; it cannot force a third-party promise to stop unless that
promise also receives the same signal.

## Actions

Actions read the normalized request, including `request.signal`. Pass that signal to downstream
database or HTTP clients that support cancellation. Once an action has committed an external side
effect, aborting the request does not roll it back; use transactions or idempotency keys for that
requirement.

## Rules For Library Authors

- Accept `AbortSignal` rather than inventing a framework-specific cancellation token.
- Check `signal.aborted` before expensive work and pass the signal through every supported layer.
- Remove abort listeners when work settles.
- Never publish a stale result after reset, unmount, navigation replacement, or runtime disposal.
- Treat cancellation as expected control flow in logs and tracing.

See [Data Loading and Middleware](./data-loading-and-middleware.md) and
[Streaming and Deferred Rendering](./streaming-and-deferred.md) for API-specific examples.
