import { ErrorBoundary } from "@tavojs/core";
import { ControlsView } from "../components/ControlsView/index.jsx";
import { CrashyWidget } from "../components/CrashyWidget/index.jsx";
import { KeyedListView } from "../components/KeyedListView/index.jsx";
import { RouteCatalogView } from "../components/RouteCatalogView/index.jsx";
import { StatsView } from "../components/StatsView/index.jsx";
import { TsxFeatureCard } from "../components/TsxFeatureCard/index.tsx";

export const head = (
  <>
    <title>tavo preview - home</title>
    <meta name="description" content="tavo framework home preview" />
  </>
);

export default function HomePage() {
  return (
    <section>
      <section className="tavo-panel">
        <h3>Home</h3>
        <p className="tavo-muted">
          This page demonstrates MVC components, realtime stores, keyed diffing, route catalog,
          error boundaries, and TSX authoring.
        </p>
        <p className="tavo-muted">
          Visit <code>/features</code>, <code>/store</code>, <code>/router</code>, and{" "}
          <code>/i18n</code> to exercise the rest of the framework surface.
        </p>
      </section>
      <TsxFeatureCard
        title="TSX support"
        features={[
          "Use .tsx for pages and components.",
          "Keep automatic JSX with @tavojs/core.",
          "Mix existing JSX examples with typed TSX files."
        ]}
      />
      <StatsView />
      <ControlsView />
      <KeyedListView />
      <RouteCatalogView />
      <section className="tavo-panel">
        <h3>Error Boundary</h3>
        <ErrorBoundary
          fallback={(error) => <pre className="tavo-error">{String(error)}</pre>}
        >
          <CrashyWidget />
        </ErrorBoundary>
      </section>
    </section>
  );
}
