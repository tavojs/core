import { navigate } from "@tavojs/core/router";
import { defineGlobalStore } from "@tavojs/core";

function nowTime() {
  return new Date().toLocaleTimeString();
}

const AUTH_STORAGE_KEY = "tavo_preview_auth";

function readAuthFromStorage() {
  if (typeof window === "undefined") {
    return false;
  }
  return window.localStorage.getItem(AUTH_STORAGE_KEY) === "1";
}

function writeAuthToStorage(value) {
  if (typeof window === "undefined") {
    return;
  }
  window.localStorage.setItem(AUTH_STORAGE_KEY, value ? "1" : "0");
}

async function submitAuthIntent(intent) {
  if (typeof window === "undefined") {
    return false;
  }
  const body = new URLSearchParams({ intent });
  const response = await fetch("/auth", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
    },
    body,
    credentials: "same-origin",
  });
  return response.status >= 200 && response.status < 400;
}

export const appStore = defineGlobalStore("preview:app", (set) => ({
  count: 0,
  ticks: 0,
  theme: "sunset",
  settings: {
    panel: {
      density: "comfortable",
    },
  },
  isAuthenticated: readAuthFromStorage(),
  throwDemoError: false,
  items: [
    { id: "a", label: "Alpha" },
    { id: "b", label: "Beta" },
    { id: "c", label: "Gamma" },
  ],
  notes: ["Tavo.js supports MVC components.", "Pages are routed from src/pages."],
  lastUpdate: nowTime(),
  setTheme(value) {
    set({
      theme: value,
      lastUpdate: nowTime(),
    });
  },
  async setAuthenticated(value) {
    const ok = await submitAuthIntent(value ? "login" : "logout");
    if (!ok) {
      return;
    }
    writeAuthToStorage(value);
    set({
      isAuthenticated: value,
      lastUpdate: nowTime(),
    });
  },
}));

export const diagnosticsStore = defineGlobalStore(
  "preview:diagnostics",
  () => ({
    mismatches: [],
  }),
);

export class AppController {
  constructor(appModel) {
    this.appModel = appModel;
  }

  update(updater) {
    this.appModel.patch((previous) => ({
      ...updater(previous),
      lastUpdate: nowTime(),
    }));
  }

  increment() {
    this.update((previous) => ({ count: previous.count + 1 }));
  }

  burstIncrement() {
    this.increment();
    this.increment();
    this.increment();
  }

  async reset() {
    await submitAuthIntent("logout");
    writeAuthToStorage(false);
    this.update(() => ({
      count: 0,
      ticks: 0,
      theme: "sunset",
      settings: {
        panel: {
          density: "comfortable",
        },
      },
      isAuthenticated: false,
      throwDemoError: false,
    }));
  }

  tick() {
    this.update((previous) => ({ ticks: previous.ticks + 1 }));
  }

  toggleTheme() {
    this.update((previous) => ({
      theme: previous.theme === "sunset" ? "mint" : "sunset",
      settings: {
        ...previous.settings,
        panel: {
          ...previous.settings.panel,
          density: previous.settings.panel.density === "comfortable" ? "compact" : "comfortable",
        },
      },
    }));
  }

  toggleError() {
    this.update((previous) => ({
      throwDemoError: !previous.throwDemoError,
    }));
  }

  async toggleAuth() {
    const previous = this.appModel.getState();
    const nextAuth = !previous.isAuthenticated;
    const ok = await submitAuthIntent(nextAuth ? "login" : "logout");
    if (!ok) {
      return;
    }
    this.update(() => {
      writeAuthToStorage(nextAuth);
      return {
        isAuthenticated: nextAuth,
      };
    });
  }

  shuffleItems() {
    this.update((previous) => ({
      items: [previous.items[2], previous.items[0], previous.items[1]],
    }));
  }

  addNote() {
    this.update((previous) => ({
      notes: [...previous.notes, `New note @ ${nowTime()}`],
    }));
  }

  navigate(pathname) {
    navigate(pathname);
  }
}

export const appController = new AppController(appStore);

export function pushMismatch(mismatch) {
  diagnosticsStore.patch((previous) => ({
    mismatches: [...previous.mismatches.slice(-8), mismatch],
  }));
}

export function attachPreviewRuntime() {
  const target = globalThis;
  const key = "__tavo_preview_runtime_attached__";
  if (target[key]) {
    return;
  }
  target[key] = true;

  setInterval(() => {
    appController.tick();
  }, 1000);
}
