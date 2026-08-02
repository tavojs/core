import { defineLoader } from "@tavojs/core/router";
import { StatsView } from "../components/StatsView/index.jsx";

export const load = defineLoader(async (context) => {
  return {
    pathname: context.pathname,
    fetchedAt: new Date().toISOString(),
    rootLayoutData: context.layers?.["/"] ?? null
  };
});

export function head(context) {
  return (
    <>
      <title>tavo preview - stats ({context.params?.id || "route"})</title>
      <meta name="robots" content="noindex" />
    </>
  );
}

export default function StatsPage(props) {
  return (
    <section>
      <section className="tavo-panel">
        <h3>Stats Route</h3>
        <p className="tavo-muted">
          Loader payload: <code>{JSON.stringify(props.data)}</code>
        </p>
        <p className="tavo-muted">
          Layout layers passed into this loader:{" "}
          <code>{JSON.stringify(props.layerData)}</code>
        </p>
      </section>
      <StatsView />
    </section>
  );
}
