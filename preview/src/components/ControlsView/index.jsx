import { createTavo } from "@tavojs/core";
import { appController } from "../../store/index.js";

class ControlsController {
  run(action) {
    this.model.patch((previous) => ({
      localClicks: previous.localClicks + 1,
    }));
    action();
  }

  increment() {
    this.run(() => appController.increment());
  }

  burstIncrement() {
    this.run(() => appController.burstIncrement());
  }

  shuffleItems() {
    this.run(() => appController.shuffleItems());
  }

  toggleTheme() {
    this.run(() => appController.toggleTheme());
  }

  toggleError() {
    this.run(() => appController.toggleError());
  }

  toggleAuth() {
    this.run(() => appController.toggleAuth());
  }

  addNote() {
    this.run(() => appController.addNote());
  }

  goSecure() {
    this.router.navigate("/secure");
  }

  goDynamicExamples() {
    this.router.navigate("/blog/hello-tavo");
  }

  reset() {
    this.run(() => appController.reset());
  }
}

export const ControlsView = createTavo({
  model: () => ({
    localClicks: 0,
  }),
  controller: ControlsController,
  view: ({ state, controller }) => (
    <div className="tavo-controls">
      <button type="button" onClick={() => controller?.increment()}>
        Increment
      </button>
      <button type="button" onClick={() => controller?.burstIncrement()}>
        +3 (batched)
      </button>
      <button type="button" onClick={() => controller?.shuffleItems()}>
        Shuffle keyed list
      </button>
      <button type="button" onClick={() => controller?.toggleTheme()}>
        Toggle theme
      </button>
      <button type="button" onClick={() => controller?.toggleError()}>
        Toggle boundary error
      </button>
      <button type="button" onClick={() => controller?.toggleAuth()}>
        Toggle auth
      </button>
      <button type="button" onClick={() => controller?.addNote()}>
        Add note
      </button>
      <button type="button" onClick={() => controller?.goSecure()}>
        Go secure page
      </button>
      <button type="button" onClick={() => controller?.goDynamicExamples()}>
        Go dynamic route
      </button>
      <button type="button" onClick={() => controller?.reset()}>
        Reset
      </button>
      <span className="tavo-muted">local clicks: {state.localClicks}</span>
    </div>
  ),
});
