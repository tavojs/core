import { createTavo } from "@tavojs/core";

class StatsController {
  sync() {
    const appStore = this.stores.get("preview:app");
    const state = appStore.getState();
    this.model.patch({
      count: state.count,
      ticks: state.ticks,
      lastUpdate: state.lastUpdate,
      notesCount: state.notes.length
    });
  }

  onInit() {
    const appStore = this.stores.get("preview:app");
    this.sync();
    this.listen(appStore, () => {
      this.sync();
    });
  }
}

export const StatsView = createTavo({
  model: () => ({
    count: 0,
    ticks: 0,
    lastUpdate: "--:--:--",
    notesCount: 0
  }),
  controller: StatsController,
  view: ({ state }) => (
    <section className="tavo-panel">
      <h3>Store Snapshot</h3>
      <p className="tavo-muted">
        Realtime store updates: counter = <strong>{state.count}</strong>, ticks ={" "}
        <strong>{state.ticks}</strong>
      </p>
      <p className="tavo-muted">Last update: {state.lastUpdate}</p>
      <p className="tavo-muted">Notes: {state.notesCount}</p>
    </section>
  )
});
