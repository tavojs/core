export const head = (
  <>
    <title>tavo preview - deployment</title>
    <meta name="description" content="Tavo.js deployment and config preview" />
  </>
);

export default function DeploymentPage() {
  return (
    <section>
      <section className="tavo-panel">
        <h3>Production Output + Config</h3>
        <p className="tavo-muted">
          Tavo.js builds static client files and one generated Node server.
        </p>
      </section>

      <section className="tavo-panel">
        <h3>Build Outputs</h3>
        <p className="tavo-muted">
          Deploy the client directory to static hosting, or run the generated server for SSR.
        </p>
        <pre className="tavo-code">{`.tavo/build/client
.tavo/build/server/start.mjs`}</pre>
      </section>

      <section className="tavo-panel">
        <h3>tavo.config.ts</h3>
        <p className="tavo-muted">
          Every framework and SSR option lives in the single root <code>tavo.config.ts</code>.
        </p>
        <pre className="tavo-code">{`import { defineConfig } from "@tavojs/core/config";

export default defineConfig({
  pagesDir: "src/pages",
  cssEntries: ["src/styles.css"],
  diagnostics: { devOverlay: true },
  ssr: {
    document: {
      title: "Tavo.js app"
    }
  }
});`}</pre>
      </section>

      <section className="tavo-panel">
        <h3>CLI Workflow</h3>
        <p className="tavo-muted">
          The CLI can scaffold apps and delegate common project scripts.
        </p>
        <pre className="tavo-code">{`npx tavo create app my-app
npx tavo dev
npx tavo build
npx tavo preview
npx tavo generate page profile
npx tavo generate component UserCard
npx tavo generate store session`}</pre>
      </section>

      <section className="tavo-panel">
        <h3>Production Modes</h3>
        <div className="tavo-store-metrics">
          <span className="tavo-badge">static: .tavo/build/client</span>
          <span className="tavo-badge">Node: .tavo/build/server/start.mjs</span>
          <span className="tavo-badge">streaming SSR</span>
        </div>
      </section>
    </section>
  );
}
