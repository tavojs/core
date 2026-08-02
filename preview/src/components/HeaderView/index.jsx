import { createTavo } from "@tavojs/core";
import { appStore } from "../../store/index.js";

class HeaderController {
  constructor({ model }) {
    this.model = model;
  }

  syncFromGlobal() {
    const state = appStore.getState();
    this.model.patch({
      count: state.count,
      theme: state.theme,
      isAuthenticated: state.isAuthenticated
    });
  }

  onInit() {
    this.syncFromGlobal();
    this.listen(appStore, () => {
      this.syncFromGlobal();
    });
  }
}

export const HeaderView = createTavo({
  model: () => ({
    count: 0,
    theme: "sunset",
    isAuthenticated: false
  }),
  controller: HeaderController,
  view: ({ state }) => (
    <header className="tavo-header">
      <h1 className="tavo-title">tavo framework preview</h1>
      <span className={`tavo-badge tavo-badge--${state.theme}`}>
        count: {state.count} | {state.isAuthenticated ? "auth: on" : "auth: off"}
      </span>
    </header>
  )
});
