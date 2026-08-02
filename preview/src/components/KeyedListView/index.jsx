import { createTavo } from "@tavojs/core";
import { appStore } from "../../store/index.js";

class KeyedListController {
  constructor({ model }) {
    this.model = model;
  }

  sync() {
    this.model.patch({
      items: appStore.getState().items
    });
  }

  onInit() {
    this.sync();
    this.listen(appStore, () => {
      this.sync();
    });
  }
}

export const KeyedListView = createTavo({
  model: () => ({
    items: []
  }),
  controller: KeyedListController,
  view: ({ state }) => (
    <section className="tavo-panel">
      <h3>Keyed Reconciliation</h3>
      <ul className="tavo-list">
        {state.items.map((item) => (
          <li key={item.id}>
            <strong>{item.id}</strong>: {item.label}
          </li>
        ))}
      </ul>
    </section>
  )
});
