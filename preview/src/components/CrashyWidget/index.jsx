import { createTavo } from "@tavojs/core";
import { appStore } from "../../store/index.js";

class CrashyController {
  constructor({ model }) {
    this.model = model;
  }

  sync() {
    this.model.patch({
      shouldThrow: appStore.getState().throwDemoError,
    });
  }

  onInit() {
    this.sync();
    this.listen(appStore, () => {
      this.sync();
    });
  }
}

export const CrashyWidget = createTavo({
  model: () => ({
    shouldThrow: false,
  }),
  controller: CrashyController,
  view: ({ state }) => {
    if (state.shouldThrow) {
      throw new Error("Demo runtime error from CrashyWidget");
    }
    return <p className="tavo-muted">Boundary demo is healthy.</p>;
  },
});
