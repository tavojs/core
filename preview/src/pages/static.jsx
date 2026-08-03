export const revalidate = 5;

let staticRenderCount = 0;

export async function load() {
  staticRenderCount += 1;
  return {
    generatedAt: new Date().toISOString(),
    renderCount: staticRenderCount
  };
}

export const head = (
  <>
    <title>tavo preview - static SSR</title>
    <meta
      name="description"
      content="Static SSR page with incremental revalidation in Tavo.js."
    />
  </>
);

export default function StaticPage(props) {
  return (
    <section className="tavo-stack">
      <section className="tavo-panel">
        <h2>Static SSR With Revalidate</h2>
        <p className="tavo-muted">
          This route is server-rendered once and reused for 5 seconds.
        </p>
        <p className="tavo-muted">
          After the window expires, the next SSR request regenerates the HTML and refreshes the
          loader data.
        </p>
      </section>

      <section className="tavo-panel">
        <h3>Server Payload</h3>
        <p>
          Generated at: <code>{props.data?.generatedAt}</code>
        </p>
        <p>
          Render count in this server process: <code>{props.data?.renderCount}</code>
        </p>
        <p className="tavo-muted">
          Run the preview in SSR mode and refresh this page a few times within 5 seconds to see
          the cached HTML stay stable.
        </p>
      </section>
    </section>
  );
}
