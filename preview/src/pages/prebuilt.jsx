export const prerender = true;

export const head = (
  <>
    <title>tavo preview - prebuilt static</title>
    <meta name="description" content="Build-time prerendered static page in Tavo." />
  </>
);

export default function PrebuiltStaticPage() {
  return (
    <section className="tavo-stack">
      <section className="tavo-panel">
        <h2>Prebuilt Static Page</h2>
        <p className="tavo-muted">
          This page configures <code>prerender = true</code> without revalidation, so production
          builds emit an HTML file for it.
        </p>
      </section>
    </section>
  );
}
