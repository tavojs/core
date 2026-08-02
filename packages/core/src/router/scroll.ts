import type { RouterNavigateOptions } from "./types.js";

type ScrollPosition = {
  x: number;
  y: number;
};

type PendingScroll = {
  pathname: string;
  hash: string;
  scroll: boolean;
  hashAttempts: number;
};

const scrollStateKey = "__tavoScrollKey";
const maxHashScrollAttempts = 8;
const scrollPositions = new Map<string, ScrollPosition>();

let initializedWindow: Window | null = null;
let nextScrollKey = 0;
let pendingScroll: PendingScroll | null = null;
let pendingHashFrame: { window: Window; id: number } | null = null;
let activeScrollKey: string | null = null;

function createScrollKey(): string {
  nextScrollKey += 1;
  return `tavo:${Date.now().toString(36)}:${nextScrollKey}`;
}

function readHistoryState(): Record<string, unknown> {
  if (typeof window === "undefined") {
    return {};
  }
  const state = window.history.state;
  return state && typeof state === "object" && !Array.isArray(state)
    ? { ...(state as Record<string, unknown>) }
    : {};
}

function readScrollKey(): string | null {
  const key = readHistoryState()[scrollStateKey];
  return typeof key === "string" ? key : null;
}

function writeScrollKey(key: string, url?: string): void {
  if (typeof window === "undefined") {
    return;
  }
  window.history.replaceState({
    ...readHistoryState(),
    [scrollStateKey]: key
  }, "", url ?? `${window.location.pathname}${window.location.search}${window.location.hash}`);
  activeScrollKey = key;
}

function saveCurrentScrollPosition(): void {
  if (typeof window === "undefined") {
    return;
  }
  const key = activeScrollKey ?? readScrollKey();
  if (!key) {
    return;
  }
  scrollPositions.set(key, {
    x: window.scrollX,
    y: window.scrollY
  });
}

function resolveTarget(to: string): URL | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return new URL(to || "/", window.location.href);
  } catch {
    return null;
  }
}

function decodeHash(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

function findHashTarget(hash: string): HTMLElement | null {
  if (typeof document === "undefined" || !hash) {
    return null;
  }
  const id = decodeHash(hash);
  const byId = document.getElementById(id);
  if (byId) {
    return byId;
  }
  const anchors = Array.from(document.getElementsByTagName("a"));
  return anchors.find((anchor) => anchor.getAttribute("name") === id) ?? null;
}

function scrollToHash(hash: string): boolean {
  const target = findHashTarget(hash);
  if (!target) {
    return false;
  }
  try {
    target.scrollIntoView();
  } catch {
    return false;
  }
  return true;
}

function scrollToPosition(position: ScrollPosition): void {
  if (
    typeof window === "undefined" ||
    typeof window.scrollTo !== "function" ||
    window.scrollTo.toString().includes("notImplemented")
  ) {
    return;
  }
  try {
    window.scrollTo(position.x, position.y);
  } catch {
    // Non-visual DOM environments can expose scrollTo as a throwing stub.
  }
}

function scrollToTop(): void {
  if (
    typeof window === "undefined" ||
    typeof window.scrollTo !== "function" ||
    window.scrollTo.toString().includes("notImplemented")
  ) {
    return;
  }
  try {
    window.scrollTo(0, 0);
  } catch {
    // Non-visual DOM environments can expose scrollTo as a throwing stub.
  }
}

function cancelPendingHashRetry(): void {
  if (!pendingHashFrame) {
    return;
  }
  pendingHashFrame.window.cancelAnimationFrame(pendingHashFrame.id);
  pendingHashFrame = null;
}

function clearPendingScroll(scroll: PendingScroll): void {
  if (pendingScroll !== scroll) {
    return;
  }
  pendingScroll = null;
  cancelPendingHashRetry();
}

function retryPendingHashScroll(scroll: PendingScroll): void {
  if (pendingScroll !== scroll) {
    return;
  }
  scroll.hashAttempts += 1;
  if (scrollToHash(scroll.hash)) {
    clearPendingScroll(scroll);
    return;
  }
  if (scroll.hashAttempts >= maxHashScrollAttempts) {
    clearPendingScroll(scroll);
    scrollToTop();
    return;
  }
  if (pendingHashFrame) {
    return;
  }
  if (typeof window.requestAnimationFrame !== "function") {
    clearPendingScroll(scroll);
    scrollToTop();
    return;
  }
  const frameWindow = window;
  const id = frameWindow.requestAnimationFrame(() => {
    if (pendingHashFrame?.window === frameWindow && pendingHashFrame.id === id) {
      pendingHashFrame = null;
    }
    if (pendingScroll !== scroll) {
      return;
    }
    if (
      frameWindow.location.pathname !== scroll.pathname ||
      frameWindow.location.hash !== scroll.hash
    ) {
      clearPendingScroll(scroll);
      return;
    }
    retryPendingHashScroll(scroll);
  });
  pendingHashFrame = { window: frameWindow, id };
}

/** Enables browser-like scroll behavior for client-side route transitions. */
export function ensureRouterScrollRestoration(): void {
  if (typeof window === "undefined") {
    return;
  }
  if (initializedWindow === window) {
    return;
  }
  cancelPendingHashRetry();
  pendingScroll = null;
  initializedWindow = window;
  if ("scrollRestoration" in window.history) {
    window.history.scrollRestoration = "manual";
  }
  if (!readScrollKey()) {
    writeScrollKey(createScrollKey());
  } else {
    activeScrollKey = readScrollKey();
  }
  window.addEventListener("pagehide", saveCurrentScrollPosition);
  window.addEventListener("popstate", saveCurrentScrollPosition, { capture: true });
}

/** Records the current position and marks how the next client navigation should scroll. */
export function prepareRouterScrollNavigation(to: string, options?: RouterNavigateOptions): void {
  if (typeof window === "undefined") {
    return;
  }
  ensureRouterScrollRestoration();
  saveCurrentScrollPosition();
  cancelPendingHashRetry();

  const target = resolveTarget(to);
  pendingScroll = {
    pathname: target?.pathname || "/",
    hash: target?.hash || "",
    scroll: options?.scroll !== false,
    hashAttempts: 0
  };
}

/** Returns history state for the next URL entry while preserving app-owned history state. */
export function createRouterHistoryState(options?: RouterNavigateOptions): Record<string, unknown> {
  ensureRouterScrollRestoration();
  const key = options?.replace ? readScrollKey() ?? createScrollKey() : createScrollKey();
  activeScrollKey = key;
  return {
    ...readHistoryState(),
    [scrollStateKey]: key
  };
}

/** Applies the pending or restored scroll position after a route has rendered. */
export function applyRouterScroll(pathname: string): void {
  if (typeof window === "undefined") {
    return;
  }
  ensureRouterScrollRestoration();

  if (pendingScroll && pendingScroll.pathname === pathname) {
    const next = pendingScroll;
    if (!next.scroll) {
      clearPendingScroll(next);
      return;
    }
    if (next.hash) {
      retryPendingHashScroll(next);
      return;
    }
    clearPendingScroll(next);
    scrollToTop();
    return;
  }

  const key = readScrollKey();
  activeScrollKey = key;
  const position = key ? scrollPositions.get(key) : null;
  if (position) {
    scrollToPosition(position);
  }
}
