import {
  createPagesManifest,
  createPagesManifestDetailed,
  inspectPages
} from "@tavojs/core/dev";

export const head = (
  <>
    <title>tavo preview - manifest</title>
    <meta name="description" content="Tavo route manifest and typed routing preview" />
  </>
);

export default function ManifestPage() {
  const modules = import.meta.glob("/src/pages/**/*.{js,jsx,ts,tsx}");
  const manifest = createPagesManifest(modules);
  const detailed = createPagesManifestDetailed(modules);
  const inspection = inspectPages(modules);

  return (
    <section>
      <section className="tavo-panel">
        <h3>Route Manifest Preview</h3>
        <p className="tavo-muted">
          Runtime inspection and generated build-time route artifacts describe the same page tree.
        </p>
        <div className="tavo-store-metrics">
          <span className="tavo-badge">routes: {manifest.length}</span>
          <span className="tavo-badge">diagnostics: {inspection.diagnostics.length}</span>
          <span className="tavo-badge">404 page: {detailed.notFound ? "yes" : "no"}</span>
          <span className="tavo-badge">error page: {detailed.error ? "yes" : "no"}</span>
        </div>
      </section>

      <section className="tavo-panel">
        <h3>Route Table</h3>
        <ul className="tavo-list">
          {manifest.map((route) => (
            <li key={route.file}>
              <code>{route.path}</code> from <code>{route.file.replace("/src/pages/", "")}</code>
            </li>
          ))}
        </ul>
      </section>

      <section className="tavo-panel">
        <h3>Typed Route Helper</h3>
        <p className="tavo-muted">
          Functional page modules are the default. Optional <code>defineRoutePage()</code> typing is
          demonstrated in <code>src/pages/blog/[id].jsx</code>.
          In TSX pages it can provide route-param and loader-data typing.
        </p>
        <pre className="tavo-code">{`import { defineRoutePage } from "@tavojs/core/router";

export default defineRoutePage<"/blog/[id]", { title: string }>("/blog/[id]", {
  load: async ({ params }) => ({ title: \`Post \${params.id}\` }),
  default: ({ params, data }) => <main>{params.id}: {data?.title}</main>
});`}</pre>
      </section>

      <section className="tavo-panel">
        <h3>Generated Route Contract</h3>
        <div className="tavo-store-metrics">
          <span className="tavo-badge">runtime manifest helpers</span>
          <span className="tavo-badge">route diagnostics</span>
          <span className="tavo-badge">.tavo/generated/route-manifest.json</span>
          <span className="tavo-badge">.tavo/generated/routes.d.ts</span>
        </div>
      </section>
    </section>
  );
}
