import { createTavo } from "@tavojs/core";
import { getAvailableRoutes } from "@tavojs/core/router";
import { appStore, diagnosticsStore } from "../../store/index.js";

class DebugController {
  constructor({ model }) {
    this.model = model;
  }

  sync() {
    const app = appStore.getState();

    const diagnostics = diagnosticsStore.getState();
    this.model.patch({
      count: app.count,
      ticks: app.ticks,
      isAuthenticated: app.isAuthenticated,
      density: app.settings.panel.density,
      notes: app.notes,
      lastUpdate: app.lastUpdate,
      mismatches: diagnostics.mismatches,
      routes: getAvailableRoutes().map((route) => route.path),
    });
  }

  onInit() {
    this.sync();
    this.listen(appStore, () => this.sync());
    this.watch(appStore, "settings.panel.density", (density, previousDensity) => {
      this.model.patch({
        watchedChange: `${previousDensity} -> ${density}`,
      });
    }, { immediate: true });
    this.listen(diagnosticsStore, () => this.sync());
  }
}

export const DebugPanel = createTavo({
  model: () => ({
    count: 0,
    ticks: 0,
    isAuthenticated: false,
    density: "comfortable",
    watchedChange: "comfortable -> comfortable",
    notes: [],
    lastUpdate: "--:--:--",
    mismatches: [],
    routes: [],
  }),
  controller: DebugController,
  view: ({ state }) => (
    <section className="tavo-panel">
      <h3>Debug Route</h3>
      <p className="tavo-muted">
        App snapshot: count=<strong>{state.count}</strong>, ticks=
        <strong>{state.ticks}</strong>, auth=
        <strong>{String(state.isAuthenticated)}</strong>, updated=
        <strong>{state.lastUpdate}</strong>
      </p>
      <p className="tavo-muted">
        Watched nested state: settings.panel.density=
        <strong>{state.density}</strong>, last watch event=
        <strong>{state.watchedChange}</strong>
      </p>
      <div className="tavo-debug-grid">
        <article>
          <h4>Hydration Mismatches</h4>
          <pre className="tavo-code">
            {JSON.stringify(state.mismatches, null, 2)}
          </pre>
        </article>
        <article>
          <h4>Routes</h4>
          <pre className="tavo-code">
            {JSON.stringify(state.routes, null, 2)}
          </pre>
        </article>
        <article>
          <h4>Notes</h4>
          <pre className="tavo-code">
            {JSON.stringify(state.notes, null, 2)}
          </pre>
        </article>
      </div>
    </section>
  ),
});
