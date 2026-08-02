import { DebugPanel } from "../components/DebugPanel/index.jsx";

export const head = <title>tavo preview - debug</title>;

export default function DebugPage(props) {
  return (
    <section>
      <section className="tavo-panel">
        <h3>Debug</h3>
        <p className="tavo-muted">
          Diagnostics events and route catalog snapshots are shown below.
        </p>
      </section>
      <DebugPanel />
    </section>
  );
}
