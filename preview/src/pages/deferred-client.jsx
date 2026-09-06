import { Deferred } from "@tavojs/core";
import { defineRoutePage } from "@tavojs/core/router";

function resolveAfter(value, delay) {
  return new Promise((resolve) => {
    setTimeout(() => resolve(value), delay);
  });
}

function rejectAfter(error, delay) {
  return new Promise((_, reject) => {
    setTimeout(() => reject(error), delay);
  });
}

function createCancellationProbe() {
  const listeners = new Set();
  const probe = {
    abortListeners: 0,
    lateRenders: 0
  };
  const signal = {
    aborted: false,
    reason: undefined,
    addEventListener(type, listener) {
      if (type !== "abort") return;
      listeners.add(listener);
      probe.abortListeners = listeners.size;
    },
    removeEventListener(type, listener) {
      if (type !== "abort") return;
      listeners.delete(listener);
      probe.abortListeners = listeners.size;
    }
  };
  return { probe, signal };
}

export default defineRoutePage("/deferred-client", {
  render: "csr",
  head: {
    title: "tavo preview - client Deferred"
  },
  default: function DeferredClientPage() {
    const cancellation = createCancellationProbe();
    window.__TAVO_DEFERRED_CANCELLATION__ = cancellation.probe;

    return (
      <main className="page-stack">
        <section className="panel">
          <h1>Client Deferred Lifecycle</h1>
          <p>Promise-backed boundaries settle in the browser and release work on unmount.</p>
        </section>

        <Deferred
          id="browser-resolved"
          value={resolveAfter("browser value", 900)}
          fallback={<p data-testid="resolved-pending">Resolved branch pending</p>}
        >
          {(value) => <p data-testid="resolved-output">Resolved: {value}</p>}
        </Deferred>

        <Deferred
          id="browser-rejected"
          value={rejectAfter(new Error("browser rejection"), 900)}
          fallback={<p data-testid="rejected-pending">Rejected branch pending</p>}
          errorFallback={(error) => <p data-testid="rejected-output">Rejected: {String(error.message ?? error)}</p>}
        >
          <p>This branch must not resolve.</p>
        </Deferred>

        <Deferred
          id="browser-timeout"
          value={new Promise(() => {})}
          timeoutMs={600}
          fallback={<p data-testid="timeout-pending">Timeout branch pending</p>}
          timeoutFallback={<p data-testid="timeout-output">Timed out in browser</p>}
        >
          <p>This branch must not resolve.</p>
        </Deferred>

        <Deferred
          value={resolveAfter("too late", 3000)}
          timeoutMs={5000}
          signal={cancellation.signal}
          fallback={<p data-testid="cancellation-pending">Cancellation branch pending</p>}
        >
          {(value) => {
            cancellation.probe.lateRenders += 1;
            return <p>Unexpected late render: {value}</p>;
          }}
        </Deferred>
      </main>
    );
  }
});
