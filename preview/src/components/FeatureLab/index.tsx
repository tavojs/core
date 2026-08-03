import {
  createTavo
} from "@tavojs/core";
import { Head } from "@tavojs/core";
import { createAction } from "@tavojs/core";
import { createFormAction } from "@tavojs/core";
import { createResource, type ResourceState } from "@tavojs/core";
import { createStore, type Store } from "@tavojs/core";
import { configureDevDiagnostics, installDevOverlay } from "@tavojs/core/dev";
import { computedStore, persistStore } from "@tavojs/core";
import css from "./FeatureLab.module.css";
import scss from "./FeatureLab.module.scss";

type PreferencesState = {
  accent: "amber" | "blue";
  visits: number;
};

type PreferencesSummary = {
  label: string;
  visitsText: string;
};

type ResourcePayload = {
  message: string;
  loadedAt: string;
};

type AsyncResourceModel = ResourceState<ResourcePayload> & {
  reads: number;
};

type ActionDemoModel = {
  status: string;
  result: string;
  error: string;
  formStatus: string;
  formResult: string;
};

type DevOverlayModel = {
  installed: boolean;
};

const preferencesStore = createStore<PreferencesState>({
  accent: "amber",
  visits: 0
});

const preferencesSummaryStore = computedStore<PreferencesState, PreferencesSummary>(
  preferencesStore,
  (state) => ({
    label: state.accent === "amber" ? "Warm amber workspace" : "Cool blue workspace",
    visitsText: `${state.visits} persisted visits`
  })
);

persistStore(preferencesStore, {
  key: "tavo_preview_preferences",
  pick: (state) => ({
    accent: state.accent,
    visits: state.visits
  })
});

const asyncResource = createResource<ResourcePayload>(
  () =>
    new Promise((resolve) => {
      setTimeout(() => {
        resolve({
          message: "Loaded through createResource() and mirrored into an MVC model.",
          loadedAt: new Date().toLocaleTimeString()
        });
      }, 350);
    })
);

const saveGreetingAction = createAction<{ name: string }, string>(({ input }) => {
  if (!input.name.trim()) {
    throw new Error("Name is required");
  }
  return `Saved greeting for ${input.name}`;
});

const contactFormAction = createFormAction((values) => ({
  email: String(values.email ?? ""),
  topic: String(values.topic ?? "general")
}));

class AsyncResourceController {
  model: Store<AsyncResourceModel>;
  listen!: (store: Store<any>, listener: (...args: any[]) => void, options?: { immediate?: boolean }) => () => void;

  constructor({ model }: { model: Store<AsyncResourceModel> }) {
    this.model = model;
  }

  sync(next = asyncResource.read()) {
    this.model.patch((previous: AsyncResourceModel) => ({
      ...next,
      reads: previous.reads
    }));
  }

  onInit() {
    this.sync();
    this.listen(asyncResource.store, (next) => {
      this.sync(next);
    });
  }

  async load() {
    this.model.patch((previous: AsyncResourceModel) => ({
      reads: previous.reads + 1
    }));
    await asyncResource.load();
  }

  async preload() {
    this.model.patch((previous: AsyncResourceModel) => ({
      reads: previous.reads + 1
    }));
    await asyncResource.preload();
  }

  reset() {
    asyncResource.reset();
  }
}

const AsyncResourcePanel = createTavo<Record<string, never>, AsyncResourceModel, AsyncResourceController>({
  model: () => ({
    status: "idle",
    data: null,
    error: null,
    updatedAt: null,
    reads: 0
  }),
  controller: AsyncResourceController,
  view: ({ state, controller }) => (
    <section className={`tavo-panel ${css.card}`}>
      <h3>createResource()</h3>
      <p className="tavo-muted">
        Resource state is explicit, observable, and controller-friendly.
      </p>
      <div className="tavo-controls">
        <button type="button" onClick={() => controller?.load()}>
          load resource
        </button>
        <button type="button" onClick={() => controller?.preload()}>
          preload resource
        </button>
        <button type="button" onClick={() => controller?.reset()}>
          reset resource
        </button>
      </div>
      <div className={css.resourceGrid}>
        <span className="tavo-badge">status: {state.status}</span>
        <span className="tavo-badge">loads requested: {state.reads}</span>
        <span className="tavo-badge">updated: {state.updatedAt ? "yes" : "no"}</span>
      </div>
      <pre className="tavo-code">{JSON.stringify(state.data ?? state.error ?? state, null, 2)}</pre>
    </section>
  )
});

type PreferencesModel = PreferencesState & PreferencesSummary;

class PreferencesController {
  model: Store<PreferencesModel>;
  listen!: (store: Store<any>, listener: (...args: any[]) => void, options?: { immediate?: boolean }) => () => void;

  constructor({ model }: { model: Store<PreferencesModel> }) {
    this.model = model;
  }

  sync() {
    this.model.patch({
      ...preferencesStore.getState(),
      ...preferencesSummaryStore.getState()
    });
  }

  onInit() {
    this.sync();
    this.listen(preferencesStore, () => this.sync());
    this.listen(preferencesSummaryStore, () => this.sync());
  }

  toggleAccent() {
    preferencesStore.patch((previous) => ({
      accent: previous.accent === "amber" ? "blue" : "amber"
    }));
  }

  recordVisit() {
    preferencesStore.patch((previous) => ({
      visits: previous.visits + 1
    }));
  }
}

const PreferencesPanel = createTavo<Record<string, never>, PreferencesModel, PreferencesController>({
  model: () => ({
    ...preferencesStore.getState(),
    ...preferencesSummaryStore.getState()
  }),
  controller: PreferencesController,
  view: ({ state, controller }) => (
    <section className="tavo-panel">
      <h3>computedStore() + persistStore()</h3>
      <p className="tavo-muted">
        The derived summary updates from a persisted source store.
      </p>
      <div className="tavo-controls">
        <button type="button" onClick={() => controller?.toggleAccent()}>
          toggle persisted accent
        </button>
        <button type="button" onClick={() => controller?.recordVisit()}>
          increment persisted visits
        </button>
      </div>
      <div className="tavo-store-metrics">
        <span className="tavo-badge">accent: {state.accent}</span>
        <span className="tavo-badge">{state.label}</span>
        <span className="tavo-badge">{state.visitsText}</span>
      </div>
    </section>
  )
});

class ActionDemoController {
  model: Store<ActionDemoModel>;
  listen!: (store: Store<any>, listener: (...args: any[]) => void, options?: { immediate?: boolean }) => () => void;

  constructor({ model }: { model: Store<ActionDemoModel> }) {
    this.model = model;
  }

  sync() {
    const action = saveGreetingAction.getState();
    const form = contactFormAction.store.getState();
    this.model.patch({
      status: action.status,
      result: action.data ?? "",
      error: action.error ? String(action.error) : "",
      formStatus: form.status,
      formResult: form.data ? JSON.stringify(form.data) : ""
    });
  }

  onInit() {
    this.sync();
    this.listen(saveGreetingAction.store, () => this.sync());
    this.listen(contactFormAction.store, () => this.sync());
  }

  runAction() {
    saveGreetingAction.run({ name: "Tavo.js Developer" });
  }

  runError() {
    saveGreetingAction.run({ name: "" });
  }

  submitForm() {
    contactFormAction.submit({
      email: "hello@tavo.local",
      topic: "framework actions"
    });
  }
}

const ActionDemoPanel = createTavo<Record<string, never>, ActionDemoModel, ActionDemoController>({
  model: () => ({
    status: "idle",
    result: "",
    error: "",
    formStatus: "idle",
    formResult: ""
  }),
  controller: ActionDemoController,
  view: ({ state, controller }) => (
    <section className="tavo-panel">
      <h3>createAction() + createFormAction()</h3>
      <p className="tavo-muted">
        Mutations and forms expose store-backed status for controller-driven views.
      </p>
      <div className="tavo-controls">
        <button type="button" onClick={() => controller?.runAction()}>
          run action
        </button>
        <button type="button" onClick={() => controller?.runError()}>
          run validation error
        </button>
        <button type="button" onClick={() => controller?.submitForm()}>
          submit form object
        </button>
      </div>
      <div className="tavo-store-metrics">
        <span className="tavo-badge">action: {state.status}</span>
        <span className="tavo-badge">form: {state.formStatus}</span>
      </div>
      <pre className="tavo-code">
        {JSON.stringify(
          {
            actionResult: state.result,
            actionError: state.error,
            formResult: state.formResult
          },
          null,
          2
        )}
      </pre>
    </section>
  )
});

class DevOverlayController {
  constructor({ model }: { model: Store<DevOverlayModel> }) {
    this.model = model;
  }

  model: Store<DevOverlayModel>;

  install() {
    configureDevDiagnostics({ devMode: true });
    installDevOverlay({ traces: false });
    this.model.patch({ installed: true });
  }

}

const DevOverlayPanel = createTavo<Record<string, never>, DevOverlayModel, DevOverlayController>({
  model: () => ({
    installed: false
  }),
  controller: DevOverlayController,
  view: ({ state, controller }) => (
    <section className="tavo-panel">
      <h3>Dev overlay</h3>
      <p className="tavo-muted">
        <code>installDevOverlay()</code> wires runtime and hydration errors into an in-browser
        overlay. Click the overlay to dismiss it.
      </p>
      <div className="tavo-controls">
        <button type="button" onClick={() => controller?.install()}>
          install overlay diagnostics
        </button>
      </div>
      <div className="tavo-store-metrics">
        <span className="tavo-badge">installed: {state.installed ? "yes" : "no"}</span>
      </div>
    </section>
  )
});

const OptionalMvcPanel = createTavo<{ label: string }, Record<string, never>>({
  view: ({ props }) => (
    <section className="tavo-panel">
      <h3>Optional MVC pieces</h3>
      <p className="tavo-muted">
        This component uses <code>createTavo()</code> with only a view. Model and controller are
        optional when a component is purely presentational.
      </p>
      <span className="tavo-badge">{props.label}</span>
    </section>
  )
});

export function FeatureLab() {
  return (
    <section>
      <Head
        title="tavo preview - feature lab"
        head='<meta name="x-tavo-client-head" content="Head component active">'
      />

      <section className="tavo-panel">
        <h3>Framework Feature Lab</h3>
        <p className="tavo-muted">
          A compact page for APIs that are easy to miss while building normal routes.
        </p>
      </section>

      <section
        className="tavo-panel"
        style={{
          borderColor: "#f97316",
          background: "linear-gradient(135deg, #fff7ed 0%, #ffffff 70%)"
        }}
      >
        <h3>CSS imports, CSS modules, SCSS modules, and inline style objects</h3>
        <p className="tavo-muted">
          Global CSS comes from <code>src/styles.css</code>; the badges below come from module
          imports.
        </p>
        <div className="tavo-store-metrics">
          <span className={css.modulePill}>CSS module class</span>
          <span className={scss.scssRibbon}>
            <strong>SCSS module class</strong>
          </span>
        </div>
      </section>

      <OptionalMvcPanel label="view-only createTavo component" />
      <PreferencesPanel />
      <AsyncResourcePanel />
      <ActionDemoPanel />
      <DevOverlayPanel />
    </section>
  );
}
