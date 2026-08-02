import {
  getAutoPagesInspection,
  subscribePathname,
  subscribeRouteStatus,
  type AutoPagesInspection
} from "./auto-pages/index.js";
import { getComponentRuntimeDiagnostics } from "./runtime/dom/component-runtime.js";
import { getScheduledUpdateCount } from "./runtime/dom/scheduler.js";

export type TavoDevtoolsSnapshot = AutoPagesInspection & {
  dom: {
    mountedComponents: number;
    pendingPassiveEffects: number;
    pendingUpdates: number;
  };
};

export function inspectTavoRuntime(): TavoDevtoolsSnapshot {
  const runtime = getComponentRuntimeDiagnostics();
  return {
    ...getAutoPagesInspection(),
    dom: {
      ...runtime,
      pendingUpdates: getScheduledUpdateCount()
    }
  };
}

/** Subscribes to navigation and route lifecycle changes with privacy-safe snapshots. */
export function subscribeTavoRuntime(
  listener: (snapshot: TavoDevtoolsSnapshot) => void,
  options?: { immediate?: boolean }
): () => void {
  const notify = () => listener(inspectTavoRuntime());
  const stopPath = subscribePathname(notify);
  const stopStatus = subscribeRouteStatus(notify);
  if (options?.immediate !== false) {
    notify();
  }
  return () => {
    stopPath();
    stopStatus();
  };
}

export type TavoDevtoolsPanel = {
  element: HTMLElement;
  refresh(): void;
  dispose(): void;
};

/** Installs an opt-in, dependency-free browser panel backed by privacy-safe snapshots. */
export function installTavoDevtoolsPanel(options?: {
  target?: HTMLElement;
  initiallyOpen?: boolean;
}): TavoDevtoolsPanel {
  if (typeof document === "undefined") {
    throw new Error("tavo devtools: the browser panel requires a DOM document.");
  }
  const target = options?.target ?? document.body;
  const panel = document.createElement("aside");
  panel.dataset.tavoDevtools = "true";
  panel.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:2147483647;width:min(420px,calc(100vw - 24px));max-height:70vh;overflow:auto;color:#e8e8ee;background:#15151a;border:1px solid #3b3b45;border-radius:8px;box-shadow:0 12px 32px #0008;font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace";

  const details = document.createElement("details");
  details.open = options?.initiallyOpen ?? false;
  const summary = document.createElement("summary");
  summary.textContent = "Tavo Runtime";
  summary.style.cssText = "cursor:pointer;padding:10px 12px;font-weight:700";
  const toolbar = document.createElement("div");
  toolbar.style.cssText = "display:flex;justify-content:flex-end;padding:0 10px 6px";
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "Refresh";
  button.style.cssText = "color:inherit;background:#292932;border:1px solid #50505c;border-radius:5px;padding:3px 8px;cursor:pointer";
  const output = document.createElement("pre");
  output.style.cssText = "box-sizing:border-box;margin:0;padding:10px 12px;border-top:1px solid #3b3b45;white-space:pre-wrap;overflow-wrap:anywhere";
  toolbar.append(button);
  details.append(summary, toolbar, output);
  panel.append(details);
  target.append(panel);

  const refresh = () => {
    output.textContent = JSON.stringify(inspectTavoRuntime(), null, 2);
  };
  button.addEventListener("click", refresh);
  const stop = subscribeTavoRuntime(refresh);
  return {
    element: panel,
    refresh,
    dispose() {
      stop();
      button.removeEventListener("click", refresh);
      panel.remove();
    }
  };
}
