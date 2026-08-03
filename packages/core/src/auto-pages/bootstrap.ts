import type { Component } from "../jsx.js";
import { h } from "../jsx.js";
import { createRoot } from "../dom.js";
import {
  AutoPagesApp,
  createAutoPagesRuntimeState,
  discoverPagesModules,
  prepareModulesForPath,
  type AutoPagesRuntimeState
} from "./app.js";
import {
  configureCsrActions,
  initializeAutoPagesClientState
} from "./state.js";
import { normalizeRedirectTarget } from "../security.js";
import { TavoError } from "../diagnostics.js";
import { isSsrDocument } from "../runtime/ssr-document.js";
import type { BootTavoOptions, BootTavoResult, TavoBootMode } from "./types.js";

export type { BootTavoOptions, BootTavoResult, TavoBootMode } from "./types.js";

/** Detects whether a server entrypoint file exists in the current Node project. */
async function hasServerEntrypoint(serverFile: string): Promise<boolean> {
  const processRef = (globalThis as unknown as { process?: { cwd?: () => string } }).process;
  if (typeof window !== "undefined" || typeof processRef?.cwd !== "function") {
    return false;
  }

  try {
    const runtimeImport = new Function(
      "specifier",
      "return import(specifier);"
    ) as (specifier: string) => Promise<any>;
    const [{ access }, { resolve }] = await Promise.all([
      runtimeImport("node:fs/promises"),
      runtimeImport("node:path")
    ]);
    await access(resolve(processRef.cwd(), serverFile));
    return true;
  } catch {
    return false;
  }
}

/** Resolves the DOM root element used for client render/hydration boot. */
function resolveClientRoot(options?: BootTavoOptions): Element | null {
  if (options?.root) {
    return options.root;
  }
  if (typeof document === "undefined") {
    return null;
  }
  return document.querySelector(options?.rootSelector ?? "#app");
}

/** Detects a server-rendered pages document that should hydrate on client boot. */
function shouldHydrateClientDocument(): boolean {
  return isSsrDocument();
}

function shouldHydrateRoot(root: Element, options?: BootTavoOptions): boolean {
  if (root.getAttribute("data-tavo-render-mode") === "csr") {
    return false;
  }
  return Boolean(options?.hydrate);
}

/** Returns the boot mode Tavo.js will use for the current document. */
export function getTavoBootMode(options?: Pick<BootTavoOptions, "root" | "rootSelector" | "hydrate">): TavoBootMode {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return "server";
  }
  const root = resolveClientRoot(options);
  if (!root) {
    return "none";
  }
  const hydrate = options?.hydrate ?? shouldHydrateClientDocument();
  return shouldHydrateRoot(root, { ...options, hydrate }) ? "ssr" : "csr";
}

function createInitialClientLoadRequest(pathname: string): Request | undefined {
  if (typeof Request === "undefined") {
    return undefined;
  }
  try {
    return new Request(new URL(pathname, window.location.href), {
      method: "GET"
    });
  } catch {
    return undefined;
  }
}

function applyInitialClientRedirect(
  redirect: string,
  options?: BootTavoOptions
): boolean {
  const target = normalizeRedirectTarget(redirect, {
    allowExternal: options?.allowExternalRedirects
  });
  const url = new URL(target, window.location.href);
  if (url.origin !== window.location.origin) {
    window.location.href = target;
    return false;
  }
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  return true;
}

async function resolveInitialClientRoute(
  runtimeState: AutoPagesRuntimeState,
  options?: BootTavoOptions
): Promise<void> {
  const maxRedirects = 8;
  const seen = new Set<string>();
  for (let index = 0; index < maxRedirects; index += 1) {
    const pathname = window.location.pathname || "/";
    if (seen.has(pathname)) {
      return;
    }
    seen.add(pathname);
    const resolved = await runtimeState.runtime.resolvePathAsync(
      pathname,
      createInitialClientLoadRequest(pathname)
    );
    if (resolved.redirect) {
      if (!applyInitialClientRedirect(resolved.redirect, options)) {
        return;
      }
      continue;
    }
    runtimeState.initialResolved = resolved;
    return;
  }
  if (typeof console !== "undefined") {
    console.warn(
      "[tavo pages] Initial client redirect resolution stopped after too many redirects. " +
        "Check route middleware for a redirect loop."
    );
  }
}

/** Boots auto-pages in client or server mode depending on execution environment. */
async function runBootTavo(
  options?: BootTavoOptions
): Promise<BootTavoResult> {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const rootElement = resolveClientRoot(options);
    if (!rootElement) {
      throw new TavoError(
        "TAVO_PAGES_002",
        `tavo pages: missing root element. Expected "${options?.rootSelector ?? "#app"}".`,
        {
          details: { rootSelector: options?.rootSelector ?? "#app" },
          hint: "Add the mount element to the HTML shell or pass root/rootSelector explicitly."
        }
      );
    }

    initializeAutoPagesClientState();
    const modules =
      options?.modules ?? discoverPagesModules(options?.pattern);
    if (Object.keys(modules).length === 0) {
      return { mode: "none" };
    }
    await prepareModulesForPath(modules, window.location.pathname || "/", {
      i18n: options?.i18n
    });

    const hydrateRoot = shouldHydrateRoot(rootElement, options);
    const csrActions = hydrateRoot ? undefined : options?.csrActions;
    const appProps = {
      modules,
      pattern: options?.pattern,
      getPageProps: options?.getPageProps,
      notFound: options?.notFound,
      csrFallback: options?.csrFallback,
      csrActions,
      middleware: options?.middleware,
      allowExternalRedirects: options?.allowExternalRedirects,
      i18n: options?.i18n,
      plugins: options?.plugins
    };
    configureCsrActions(csrActions);
    const runtimeState = hydrateRoot ? undefined : createAutoPagesRuntimeState(appProps);
    if (runtimeState) {
      await resolveInitialClientRoute(runtimeState, options);
    }

    const root = createRoot(rootElement);
    const node = h(AutoPagesApp as unknown as Component, {
      ...appProps,
      runtimeState
    });

    if (hydrateRoot) {
      root.hydrate(node);
    } else {
      root.render(node);
    }

    return { mode: "client", root };
  }

  const serverFile = options?.serverFile ?? "server.mjs";
  if (!(await hasServerEntrypoint(serverFile))) {
    return { mode: "none" };
  }

  const nodeOptions = options?.node ?? {};
  const modules = nodeOptions.modules ?? options?.modules;
  if (!modules) {
    throw new TavoError(
      "TAVO_PAGES_005",
      "tavo pages: server bootstrap requires page modules. " +
        'Pass `node.modules` (or `modules`) when running in Node.',
      { hint: "Pass the server route module map through bootTavo({ node: { modules } })." }
    );
  }

  const runtimeImport = new Function(
    "specifier",
    "return import(specifier);"
  ) as (specifier: string) => Promise<{ createNodeRequestHandler: typeof import("../ssr/index.js").createNodeRequestHandler }>;
  const { createNodeRequestHandler } = await runtimeImport("../ssr/index.js");
  const handle = createNodeRequestHandler({
    ...nodeOptions,
    modules,
    getPageProps: nodeOptions.getPageProps ?? options?.getPageProps,
    notFound: nodeOptions.notFound ?? options?.notFound,
    csrFallback: nodeOptions.csrFallback ?? options?.csrFallback,
    middleware: nodeOptions.middleware ?? options?.middleware,
    i18n: nodeOptions.i18n ?? options?.i18n
  });

  return { mode: "server", handle, modules };
}

/** Boots the default Tavo.js app behavior for projects that use file-based pages. */
export function bootTavo(options?: BootTavoOptions): Promise<BootTavoResult> {
  return runBootTavo({
    rootSelector: "#app",
    hydrate: shouldHydrateClientDocument(),
    ...options
  });
}
