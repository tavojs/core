import { Deferred, createDeferredValue } from "@tavojs/core";

function createStreamingMessage() {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("Deferred section resolved on the server stream and is now ready.");
    }, 250);
  });
}

function createSlowStreamingMessage() {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve("Slow deferred content still resolved before the timeout.");
    }, 2500);
  });
}

export const head = (
  <>
    <title>tavo preview - streaming</title>
    <meta name="description" content="Progressive SSR streaming with Deferred boundaries in Tavo.js." />
  </>
);

export default function StreamingPage() {
  const sharedMessage = createDeferredValue(createStreamingMessage(), {
    id: "preview-streaming-shared"
  });

  return (
    <section className="tavo-stack">
      <section className="tavo-panel">
        <h3>Progressive SSR Streaming</h3>
        <p className="tavo-muted">
          This route demonstrates a <code>Deferred</code> boundary. The shell can stream first,
          then the late section is patched into the HTML stream when its promise resolves.
        </p>
        <p className="tavo-muted">
          Progressive streaming is an SSR feature. In pure CSR mode these promise-backed
          boundaries render their fallback UI instead of starting a client-side streaming workflow.
        </p>
      </section>

      <Deferred
        id="preview-streaming-message"
        value={createStreamingMessage()}
        fallback={
          <section className="tavo-panel">
            <h4>Streaming fallback</h4>
            <p className="tavo-muted">Waiting for the deferred server section...</p>
          </section>
        }
      >
        {(message) => (
          <section className="tavo-panel">
            <h4>Deferred chunk resolved</h4>
            <p>{message}</p>
          </section>
        )}
      </Deferred>

      <section className="tavo-panel">
        <h4>Shared async coordination</h4>
        <p className="tavo-muted">
          These two boundaries share one deferred value, so the server coordinates one async unit
          and patches both targets when it resolves.
        </p>
      </section>

      <Deferred
        value={sharedMessage}
        fallback={
          <section className="tavo-panel">
            <p className="tavo-muted">Waiting for shared deferred content...</p>
          </section>
        }
      >
        {(message) => (
          <section className="tavo-panel">
            <h4>Shared block A</h4>
            <p>{message}</p>
          </section>
        )}
      </Deferred>

      <Deferred
        value={sharedMessage}
        fallback={
          <section className="tavo-panel">
            <p className="tavo-muted">Waiting for shared deferred content...</p>
          </section>
        }
      >
        {(message) => (
          <section className="tavo-panel">
            <h4>Shared block B</h4>
            <p>{message}</p>
          </section>
        )}
      </Deferred>

      <Deferred
        value={createDeferredValue(createSlowStreamingMessage(), {
          id: "preview-streaming-timeout",
          timeoutMs: 1000,
          timeoutFallback: (
            <section className="tavo-panel">
              <h4>Timeout fallback</h4>
              <p className="tavo-muted">
                This deferred section exceeded its timeout budget, so the stream kept moving with
                a timeout fallback.
              </p>
            </section>
          ),
        })}
        fallback={
          <section className="tavo-panel">
            <p className="tavo-muted">Waiting for a deliberately slow deferred block...</p>
          </section>
        }
      >
        {(message) => (
          <section className="tavo-panel">
            <h4>Slow deferred block resolved</h4>
            <p>{message}</p>
          </section>
        )}
      </Deferred>
    </section>
  );
}
