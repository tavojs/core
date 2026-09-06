# Streaming And Deferred Rendering

> Online guide:
> [tavojs.dev/docs/core/streaming-and-async](https://tavojs.dev/docs/core/streaming-and-async)

This guide explains Tavo.js’s progressive SSR features.

## Why Deferred Rendering Exists

Some parts of a page are expensive or slow to load:

- analytics summaries
- large dashboards
- secondary content panels
- remote data with higher latency

Tavo.js allows the initial HTML shell to render first, then progressively patch in deferred sections.

## `Deferred`

The main API is:

```tsx
import { Deferred } from "@tavojs/core";
```

Example:

```tsx
<Deferred
  id="hero-stats"
  value={loadStats()}
  fallback={<p>Loading stats...</p>}
>
  {(stats) => <section>{stats.title}</section>}
</Deferred>
```

This renders:

- fallback content first
- resolved content later, through a server stream during SSR or a local update during CSR

## Shared Deferred Values

Tavo.js also supports shared deferred units:

```tsx
import { Deferred, createDeferredValue } from "@tavojs/core";

const shared = createDeferredValue(fetchSomething(), { id: "hero-data" });
```

Then multiple `Deferred` boundaries can use the same async source while rendering their own final markup.

This avoids duplicated async work across the page.

Pass an `AbortSignal` when the work belongs to a request or lifecycle. Aborting settles the
boundary immediately even if the underlying promise cannot cancel itself:

```tsx
const controller = new AbortController();
const shared = createDeferredValue(loadPanel({ signal: controller.signal }), {
  id: "panel",
  signal: controller.signal,
});
```

## How It Works

At a high level:

1. the server renders the document shell
2. deferred sections render fallback content
3. resolved HTML chunks are streamed later
4. patch scripts replace fallback sections in place

That gives progressive delivery while keeping the page authoring model stable.

Document streams produce the next chunk when the consumer requests it. Settled deferred
updates remain queued while the consumer is paused, and nested patches follow their parent
markup. Cancelling the stream stops pending patch rendering and releases the stream's queue.
It cannot forcibly cancel a promise supplied by application code; pass cancellation signals
to the producer when its work should stop with the request.

## SSR And CSR Behavior

Progressive deferred streaming is SSR-only.

In SSR mode, promise-backed `Deferred` boundaries render fallback HTML first, then Tavo.js streams patch scripts that replace the fallback when each promise resolves.

In pure CSR mode, there is no server HTML stream to patch. Promise-backed `Deferred` boundaries instead subscribe in the browser and reconcile their fallback to resolved, rejected, or timed-out output. Rejections use `errorFallback`; timeouts prefer `timeoutFallback` when provided.

Hydrated SSR pages can still read serialized deferred results that were produced by the server.

Changing the promise, timeout, ID, serializer, or signal cancels the previous boundary run. Unmounting also clears its timeout and abort listener, and late promise continuations are ignored. This lifecycle cleanup cannot force an arbitrary third-party promise to stop; pass the same `AbortSignal` to the underlying operation when it supports cancellation.

## Good Use Cases

- below-the-fold panels
- dashboard summaries
- content sidebars
- expensive recommendation sections
- secondary tabs or late content blocks

## Not A Replacement For All Loaders

Deferred rendering complements route loaders; it does not replace them.

Use route loaders for:

- route-critical data
- SEO-critical content
- required shell data

Use deferred rendering for:

- slower secondary content
- non-blocking server content
- progressive UX improvements

## Timeout-aware Deferred Boundaries

`Deferred` and `createDeferredValue(...)` also support timeout behavior in SSR and CSR flows.

Example:

```tsx
const slowValue = createDeferredValue(fetchSlowData(), {
  id: "slow-panel",
  timeoutMs: 1500,
  timeoutFallback: (
    <section>
      <p>Timed out while waiting for slow panel data.</p>
    </section>
  ),
});

<Deferred value={slowValue} fallback={<p>Loading slow panel...</p>}>
  {(data) => <section>{data.title}</section>}
</Deferred>;
```

This helps when:

- a slow server promise should not hold the stream open forever
- you want an explicit timeout UX for secondary content
- you want to keep the shell responsive while treating very slow content as optional

## Current Scope

Tavo.js supports true progressive HTML patch streaming for deferred sections, shaped around Tavo.js’s own runtime and page model.

## Content Security Policy

Deferred streaming uses small inline patch scripts to replace fallback HTML as async content resolves.

If your app uses a strict Content Security Policy, pass the document `nonce` through SSR render options. Tavo.js applies it to the serialized state script and every deferred patch script:

```ts
createNodeRequestHandler({
  modules,
  stream: true,
  document: {
    nonce: requestNonce,
  },
});
```

## Best Practices

- keep fallbacks meaningful but lightweight
- use shared deferred values when multiple sections depend on the same async source
- avoid deferring critical above-the-fold content unless the UX tradeoff is deliberate
- connect deferred work to a request or component `AbortSignal` when it should not outlive its owner

## Next Reading

- [SSR And Hydration](./ssr-and-hydration.md)
- [Data Loading And Middleware](./data-loading-and-middleware.md)
