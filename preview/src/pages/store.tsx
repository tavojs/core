import { createTavo, shallowEqual, TavoController } from "@tavojs/core";
import { createStore, type Store } from "@tavojs/core";

type DemoState = {
  count: number;
  theme: "sunset" | "mint";
  profile: {
    name: string;
    role: string;
  };
  flags: {
    active: boolean;
  };
};

type StoreDemoState = {
  snapshot: DemoState;
  log: string[];
  listenersActive: boolean;
  subscribeEvents: number;
  selectorEvents: number;
  watchEvents: number;
};

type LiveReadoutModel = {
  count: number;
  profile: {
    name: string;
    role: string;
  };
};

type StoreMetricsModel = Pick<
  StoreDemoState,
  "listenersActive" | "subscribeEvents" | "selectorEvents" | "watchEvents"
>;

type StoreSnapshotModel = {
  snapshot: DemoState;
};

type StoreLogModel = {
  log: string[];
};

const names = ["Ada", "Grace", "Katherine", "Radia"];

function createInitialDemoState(): DemoState {
  return {
    count: 0,
    theme: "sunset",
    profile: {
      name: "Ada",
      role: "Engineer",
    },
    flags: {
      active: true,
    },
  };
}

function createInitialStoreDemoState(): StoreDemoState {
  return {
    snapshot: createInitialDemoState(),
    log: [],
    listenersActive: false,
    subscribeEvents: 0,
    selectorEvents: 0,
    watchEvents: 0,
  };
}

const demoStore = createStore(createInitialDemoState());
const storeDemoState = createStore(createInitialStoreDemoState());

class StoreDemoService {
  stopActiveListeners: (() => void) | null = null;

  constructor() {
    this.refresh("getState() read initial snapshot");
    this.startListeners();
  }

  patchState(partial: Partial<StoreDemoState>) {
    storeDemoState.patch(partial);
  }

  record(message: string) {
    storeDemoState.patch((previous) => ({
      log: [
        `${new Date().toLocaleTimeString()} - ${message}`,
        ...previous.log,
      ].slice(0, 10),
    }));
  }

  refresh(reason = "getState() refreshed the snapshot") {
    this.patchState({
      snapshot: demoStore.getState(),
    });
    this.record(reason);
  }

  replaceState() {
    const previous = demoStore.getState();
    demoStore.setState({
      count: previous.count + 10,
      theme: previous.theme === "sunset" ? "mint" : "sunset",
      profile: {
        name: names[(previous.count + 1) % names.length],
        role: previous.profile.role === "Engineer" ? "Architect" : "Engineer",
      },
      flags: {
        active: !previous.flags.active,
      },
    });
  }

  patchCount() {
    demoStore.patch((previous) => ({
      count: previous.count + 1,
    }));
  }

  setCount() {
    demoStore.set("count", (count) => count + 1);
  }

  setNestedName() {
    demoStore.set("profile.name", (name, state) =>
      names[(state.count + name.length + 1) % names.length],
    );
  }

  patchNestedObject() {
    demoStore.patch((previous) => ({
      profile: {
        ...previous.profile,
        name: names[
          (previous.count + previous.profile.name.length) % names.length
        ],
      },
    }));
  }

  toggleTheme() {
    demoStore.patch((previous) => ({
      theme: previous.theme === "sunset" ? "mint" : "sunset",
    }));
  }

  toggleFlag() {
    demoStore.patch((previous) => ({
      flags: {
        active: !previous.flags.active,
      },
    }));
  }

  resetStore() {
    demoStore.setState(createInitialDemoState());
  }

  startListeners() {
    if (this.stopActiveListeners) {
      return;
    }

    const stopSubscribe = demoStore.subscribe((state, previous) => {
      storeDemoState.patch((modelState) => ({
        snapshot: state,
        subscribeEvents: modelState.subscribeEvents + 1,
      }));
      this.record(
        `listen(): any state changed, count ${previous.count} -> ${state.count}`,
      );
    });

    const stopSelect = demoStore.subscribeSelector(
      (state) => state.count,
      (count, previousCount) => {
        storeDemoState.patch((modelState) => ({
          selectorEvents: modelState.selectorEvents + 1,
        }));
        this.record(`select(): count ${previousCount} -> ${count}`);
      },
      { immediate: true },
    );

    const stopThemeWatch = demoStore.watch("theme", (theme, previousTheme) => {
      storeDemoState.patch((modelState) => ({
        watchEvents: modelState.watchEvents + 1,
      }));
      this.record(`watch("theme"): ${previousTheme} -> ${theme}`);
    });

    const stopNameWatch = demoStore.watch<string>(
      "profile.name",
      (name, previousName) => {
        storeDemoState.patch((modelState) => ({
          watchEvents: modelState.watchEvents + 1,
        }));
        this.record(`watch("profile.name"): ${previousName} -> ${name}`);
      },
    );

    this.stopActiveListeners = () => {
      stopSubscribe();
      stopSelect();
      stopThemeWatch();
      stopNameWatch();
      this.stopActiveListeners = null;
    };

    this.patchState({ listenersActive: true });
    this.record('listen(), select(), and watch() listeners attached');
  }

  stopListeners() {
    this.stopActiveListeners?.();
    this.stopActiveListeners = null;
    this.patchState({ listenersActive: false });
    this.record("cleanup(): active listeners detached");
  }
}

const storeDemoService = new StoreDemoService();

class LiveReadoutController extends TavoController {
  declare model: Store<LiveReadoutModel>;

  sync() {
    const state = demoStore.getState();
    this.model.patch({
      count: state.count,
      profile: state.profile,
    });
  }

  onInit() {
    this.sync();
    this.select(
      demoStore,
      (state) => state.count,
      (count) => {
        this.model.patch({ count });
      },
    );
    this.select(
      demoStore,
      (state) => ({
        name: state.profile.name,
        role: state.profile.role,
      }),
      (profile) => {
        this.model.patch({ profile });
      },
      { isEqual: shallowEqual },
    );
  }
}

const LiveStoreReadout = createTavo<
  Record<string, unknown>,
  LiveReadoutModel,
  LiveReadoutController
>({
  model: () => ({
    count: 0,
    profile: {
      name: "",
      role: "",
    },
  }),
  controller: LiveReadoutController,
  view: ({ state }) => (
    <section className="tavo-panel">
      <h3>MVC subscriptions + shallowEqual</h3>
      <p className="tavo-muted">
        This child component uses a controller to subscribe to{" "}
        <code>count</code> and a shallow-equal profile selector. No hook-style
        API is needed in user code.
      </p>
      <div className="tavo-store-metrics">
        <span className="tavo-badge">count: {state.count}</span>
        <span className="tavo-badge">name: {state.profile.name}</span>
        <span className="tavo-badge">role: {state.profile.role}</span>
      </div>
    </section>
  ),
});

class StoreMetricsController extends TavoController {
  declare model: Store<StoreMetricsModel>;

  sync() {
    const state = storeDemoState.getState();
    this.model.patch({
      listenersActive: state.listenersActive,
      subscribeEvents: state.subscribeEvents,
      selectorEvents: state.selectorEvents,
      watchEvents: state.watchEvents,
    });
  }

  onInit() {
    this.sync();
    this.select(
      storeDemoState,
      (state) => ({
        listenersActive: state.listenersActive,
        subscribeEvents: state.subscribeEvents,
        selectorEvents: state.selectorEvents,
        watchEvents: state.watchEvents,
      }),
      (next) => {
        this.model.patch(next);
      },
      { isEqual: shallowEqual },
    );
  }
}

const StoreMetricsView = createTavo<
  Record<string, unknown>,
  StoreMetricsModel,
  StoreMetricsController
>({
  model: () => ({
    listenersActive: false,
    subscribeEvents: 0,
    selectorEvents: 0,
    watchEvents: 0,
  }),
  controller: StoreMetricsController,
  view: ({ state }) => (
    <section className="tavo-panel">
      <h3>Current getState() Snapshot</h3>
      <div className="tavo-store-metrics">
        <span className="tavo-badge">
          listeners: {state.listenersActive ? "on" : "off"}
        </span>
        <span className="tavo-badge">
          subscribe events: {state.subscribeEvents}
        </span>
        <span className="tavo-badge">
          selector events: {state.selectorEvents}
        </span>
        <span className="tavo-badge">watch events: {state.watchEvents}</span>
      </div>
      <StoreSnapshotView />
    </section>
  ),
});

class StoreSnapshotController extends TavoController {
  declare model: Store<StoreSnapshotModel>;

  onInit() {
    this.model.patch({
      snapshot: storeDemoState.getState().snapshot,
    });
    this.select(
      storeDemoState,
      (state) => state.snapshot,
      (snapshot) => {
        this.model.patch({ snapshot });
      },
    );
  }
}

const StoreSnapshotView = createTavo<
  Record<string, unknown>,
  StoreSnapshotModel,
  StoreSnapshotController
>({
  model: () => ({
    snapshot: createInitialDemoState(),
  }),
  controller: StoreSnapshotController,
  view: ({ state }) => (
    <pre className="tavo-code">{JSON.stringify(state.snapshot, null, 2)}</pre>
  ),
});

class StoreLogController extends TavoController {
  declare model: Store<StoreLogModel>;

  onInit() {
    this.model.patch({
      log: storeDemoState.getState().log,
    });
    this.select(
      storeDemoState,
      (state) => state.log,
      (log) => {
        this.model.patch({ log });
      },
    );
  }
}

const StoreLogView = createTavo<
  Record<string, unknown>,
  StoreLogModel,
  StoreLogController
>({
  model: () => ({
    log: [],
  }),
  controller: StoreLogController,
  view: ({ state }) => (
    <section className="tavo-panel">
      <h3>Event Log</h3>
      <ul className="tavo-list">
        {state.log.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
    </section>
  ),
});

function StoreActionsView() {
  return (
    <section className="tavo-panel">
      <h3>Actions</h3>
      <div className="tavo-controls">
        <button type="button" onClick={() => storeDemoService.refresh()}>
          getState snapshot
        </button>
        <button type="button" onClick={() => storeDemoService.replaceState()}>
          setState replace
        </button>
        <button type="button" onClick={() => storeDemoService.patchCount()}>
          patch count
        </button>
        <button type="button" onClick={() => storeDemoService.setCount()}>
          set count
        </button>
        <button
          type="button"
          onClick={() => storeDemoService.patchNestedObject()}
        >
          patch profile.name
        </button>
        <button type="button" onClick={() => storeDemoService.setNestedName()}>
          set profile.name
        </button>
        <button type="button" onClick={() => storeDemoService.toggleTheme()}>
          patch theme
        </button>
        <button type="button" onClick={() => storeDemoService.toggleFlag()}>
          patch flag
        </button>
        <button type="button" onClick={() => storeDemoService.startListeners()}>
          start managed listeners
        </button>
        <button type="button" onClick={() => storeDemoService.stopListeners()}>
          cleanup listeners
        </button>
        <button type="button" onClick={() => storeDemoService.resetStore()}>
          reset store
        </button>
      </div>
    </section>
  );
}

export const head = <title>tavo preview - store</title>;

export default function StorePage() {
  return (
    <section>
      <section className="tavo-panel">
        <h3>Store API Playground</h3>
        <p className="tavo-muted">
          This route demonstrates <code>createStore</code>,{" "}
          <code>getState</code>, <code>setState</code>, <code>set</code>,{" "}
          <code>patch</code>, controller <code>listen</code>, <code>select</code>,{" "}
          <code>watch</code>, <code>cleanup</code>, and{" "}
          <code>shallowEqual</code> from MVC-connected sections.
        </p>
      </section>

      <StoreActionsView />
      <LiveStoreReadout />
      <StoreMetricsView />
      <StoreLogView />
    </section>
  );
}
