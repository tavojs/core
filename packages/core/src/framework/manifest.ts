import type { Component } from "../jsx.js";
import { TavoError } from "../diagnostics.js";
import type {
  AnyRecord,
  PageCachePolicy,
  PageMiddleware,
  PageModule,
  PageModuleLoader,
  PageModuleRecord,
  PageModules,
  PageRouteDefinition,
  PageRenderMode,
  PagesManifest
} from "./types.js";
import { compareRouteSpecificity, parentDirKeys, parsePageFile, toRoutePath } from "./path-utils.js";

const unresolvedComponent: Component<AnyRecord> = () => null;
(unresolvedComponent as { __tavo_deferred_component__?: true }).__tavo_deferred_component__ = true;

/** Returns true when a page module source is a lazy bundler loader wrapper. */
export function isPageModuleLoader(module: unknown): module is PageModuleLoader {
  return typeof module === "function" && (module as { __tavo_loader__?: boolean }).__tavo_loader__ === true;
}

/** Returns true when a route/layout component is still a lazy placeholder. */
export function isDeferredPlaceholderComponent(component: unknown): boolean {
  return (
    typeof component === "function" &&
    (component as { __tavo_deferred_component__?: boolean }).__tavo_deferred_component__ === true
  );
}

function staticSetting(module: PageModuleRecord): boolean | undefined {
  return module.prerender ?? module.static;
}

export function assertCompatibleStaticOptions(
  file: string,
  module: PageModuleRecord
): void {
  if (module.prerender === undefined || module.static === undefined) {
    return;
  }
  throw new TavoError(
    "TAVO_PAGES_006",
    `Page module "${file}" declares both prerender and static.`,
    {
      details: {
        file,
        prerender: module.prerender,
        static: module.static
      },
      hint: "Use export const prerender for a functional module, or static in defineRoutePage, but do not declare both forms."
    }
  );
}

/** Normalizes user-provided page modules into a canonical record shape. */
export function normalizePageModuleRecord(module: PageModule): PageModuleRecord {
  if (typeof module === "function") {
    return { default: module };
  }
  const candidate = module as unknown as { default?: unknown };
  if (
    candidate.default &&
    typeof candidate.default === "object" &&
    "default" in candidate.default &&
    typeof (candidate.default as { default?: unknown }).default === "function"
  ) {
    const helper = candidate.default as PageModuleRecord;
    const { default: _helperDefault, ...namedExports } = module as unknown as
      Record<string, unknown>;
    return {
      ...helper,
      ...namedExports,
      default: helper.default,
    } as PageModuleRecord;
  }
  if (!module || typeof module.default !== "function") {
    throw new Error("tavo pages: every page module must export a default component.");
  }
  return module;
}

/** Creates a placeholder route/layout record before lazy client modules are loaded. */
function createDeferredModuleRecord(): PageModuleRecord {
  return {
    default: unresolvedComponent
  };
}

/** Converts middleware input into a flat middleware list. */
function flattenMiddleware(
  middleware: PageMiddleware | PageMiddleware[] | undefined
): PageMiddleware[] {
  if (!middleware) {
    return [];
  }
  return Array.isArray(middleware) ? middleware : [middleware];
}

/** Resolves effective static SSR cache policy for a layout/page chain. */
export function resolveCachePolicy(modules: PageModuleRecord[]): PageCachePolicy {
  let staticEnabled = false;
  let revalidate: number | null = null;
  const vary = new Set<string>();
  const tags = new Set<string>();

  for (const module of modules) {
    const staticEnabledForModule = staticSetting(module);
    if (staticEnabledForModule === false || module.revalidate === false) {
      staticEnabled = false;
      revalidate = null;
      continue;
    }

    if (staticEnabledForModule === true) {
      staticEnabled = true;
    }

    if (typeof module.revalidate === "number" && Number.isFinite(module.revalidate)) {
      staticEnabled = true;
      const normalized = Math.max(0, Math.floor(module.revalidate));
      revalidate = revalidate === null ? normalized : Math.min(revalidate, normalized);
    }

    for (const header of Array.isArray(module.vary) ? module.vary : module.vary ? [module.vary] : []) {
      const normalized = header.trim().toLowerCase();
      if (normalized) {
        vary.add(normalized);
      }
    }

    if (typeof module.cacheTags !== "function") {
      for (const tag of Array.isArray(module.cacheTags) ? module.cacheTags : module.cacheTags ? [module.cacheTags] : []) {
        const normalized = tag.trim();
        if (normalized) {
          tags.add(normalized);
        }
      }
    }
  }

  return {
    static: staticEnabled,
    revalidate,
    vary: Array.from(vary),
    tags: Array.from(tags)
  };
}

/** Resolves whether a route should render HTML on the server or defer the body to the client. */
export function resolveRenderMode(modules: PageModuleRecord[]): PageRenderMode {
  for (const module of modules) {
    if (module.render === "csr") {
      return "csr";
    }
  }
  return "ssr";
}

function hasCsrIncompatibleStaticOptions(modules: PageModuleRecord[]): boolean {
  return modules.some((module) =>
    module.prerender === true ||
    module.static === true ||
    module.revalidate !== undefined ||
    module.vary !== undefined ||
    typeof module.generateStaticParams === "function"
  );
}

function hasDynamicHead(modules: PageModuleRecord[]): boolean {
  return modules.some((module) => typeof module.head === "function");
}

/** Builds the full pages manifest with routes, layouts, and diagnostics. */
export function createPagesManifestDetailed(modules: PageModules): PagesManifest {
  const layouts = new Map<string, { file: string; module: PageModuleRecord }>();
  let root: { file: string; module: PageModuleRecord } | null = null;
  const routes: PageRouteDefinition[] = [];
  const diagnostics: string[] = [];
  let notFound: Component<AnyRecord> | undefined;
  let notFoundHead: PageModuleRecord["head"];
  let error: Component<AnyRecord> | undefined;

  for (const [file, rawModule] of Object.entries(modules)) {
    const parsed = parsePageFile(file);
    const lazyModule = isPageModuleLoader(rawModule);
    const normalized = lazyModule ? createDeferredModuleRecord() : normalizePageModuleRecord(rawModule);
    const joinedDir = parsed.dirParts.join("/");
    assertCompatibleStaticOptions(file, normalized);

    if (parsed.fileStem === "_root") {
      if (joinedDir === "") {
        root = { file, module: normalized };
      }
      continue;
    }
    if (parsed.fileStem === "_layout") {
      layouts.set(joinedDir, { file, module: normalized });
      continue;
    }
    if (parsed.fileStem === "404") {
      if (!lazyModule) {
        notFound = normalized.default;
        notFoundHead = normalized.head;
      }
      continue;
    }
    if (parsed.fileStem === "_error") {
      if (!lazyModule) {
        error = normalized.default;
      }
      continue;
    }
  }

  for (const [file, rawModule] of Object.entries(modules)) {
    const parsed = parsePageFile(file);
    const lazyModule = isPageModuleLoader(rawModule);
    const normalized = lazyModule ? createDeferredModuleRecord() : normalizePageModuleRecord(rawModule);

    if (parsed.fileStem === "_root" || parsed.fileStem === "_layout" || parsed.fileStem === "404" || parsed.fileStem === "_error") {
      continue;
    }
    if (parsed.fileStem.startsWith("_")) {
      continue;
    }

    const path = toRoutePath(parsed.dirParts, parsed.fileStem);
    const layoutChain: Component<AnyRecord>[] = [];
    const layoutLayers: PageRouteDefinition["layoutLayers"] = [];
    if (root) {
      layoutChain.push(root.module.default);
      layoutLayers.push({
        kind: "root",
        id: "_root",
        file: root.file,
        component: root.module.default,
        load: root.module.load,
        head: root.module.head,
        middleware: flattenMiddleware(root.module.middleware),
        render: root.module.render,
        layout: root.module.layout,
        prerender: root.module.prerender,
        static: root.module.static,
        revalidate: root.module.revalidate,
        vary: root.module.vary
      });
    }
    if (normalized.layout !== false) {
      for (const key of parentDirKeys(parsed.dirParts)) {
        const layoutDef = layouts.get(key);
        if (layoutDef) {
          layoutChain.push(layoutDef.module.default);
          layoutLayers.push({
            kind: "layout",
            id: key || "/",
            file: layoutDef.file,
            component: layoutDef.module.default,
            load: layoutDef.module.load,
            head: layoutDef.module.head,
            middleware: flattenMiddleware(layoutDef.module.middleware),
            render: layoutDef.module.render,
            layout: layoutDef.module.layout,
            prerender: layoutDef.module.prerender,
            static: layoutDef.module.static,
            revalidate: layoutDef.module.revalidate,
            vary: layoutDef.module.vary,
            cacheTags: layoutDef.module.cacheTags
          });
        }
      }
    }

    const moduleChain = [
      ...layoutLayers.map((layer) => ({
        default: layer.component,
        load: layer.load,
        head: layer.head,
        middleware: layer.middleware,
        render: layer.render,
        layout: layer.layout,
        prerender: layer.prerender,
        static: layer.static,
        revalidate: layer.revalidate,
        vary: layer.vary,
        cacheTags: layer.cacheTags
      })),
      normalized
    ];

    const renderMode = resolveRenderMode(moduleChain);
    if (renderMode === "csr" && hasCsrIncompatibleStaticOptions(moduleChain)) {
      diagnostics.push(
        `Route "${path}" uses render: "csr"; prerender/static, revalidate, vary, and generateStaticParams settings are ignored.`
      );
    }
    if (renderMode === "csr" && hasDynamicHead(moduleChain)) {
      diagnostics.push(
        `Route "${path}" uses render: "csr" with a dynamic head() function; it runs in the browser after route resolution, not in the initial HTML.`
      );
    }

    routes.push({
      file,
      path,
      component: normalized.default,
      pending: normalized.pending,
      error: normalized.error,
      layouts: layoutChain,
      layoutLayers,
      action: normalized.action,
      load: normalized.load,
      head: normalized.head,
      middleware: flattenMiddleware(normalized.middleware),
      cacheTags: normalized.cacheTags,
      cacheTagResolvers: moduleChain
        .map((module) => module.cacheTags)
        .filter((tags): tags is NonNullable<typeof tags> => tags !== undefined),
      generateStaticParams: normalized.generateStaticParams,
      renderMode,
      cache: renderMode === "csr"
        ? { static: false, revalidate: null, vary: [], tags: [] }
        : resolveCachePolicy(moduleChain)
    });
  }

  routes.sort((left, right) => {
    const specificity = compareRouteSpecificity(left.path, right.path);
    if (specificity !== 0) {
      return specificity;
    }
    return left.path.localeCompare(right.path);
  });

  const seenPaths = new Set<string>();
  for (const route of routes) {
    if (seenPaths.has(route.path)) {
      diagnostics.push(`Duplicate route detected for path "${route.path}" (${route.file}).`);
    }
    seenPaths.add(route.path);
  }

  return {
    routes,
    notFound,
    notFoundHead,
    error,
    diagnostics
  };
}

/** Convenience helper returning only sorted route definitions. */
export function createPagesManifest(modules: PageModules): PageRouteDefinition[] {
  return createPagesManifestDetailed(modules).routes;
}

/** Returns route data and diagnostics without creating runtime objects. */
export function inspectPages(modules: PageModules): {
  routes: PageRouteDefinition[];
  diagnostics: string[];
} {
  const manifest = createPagesManifestDetailed(modules);
  return {
    routes: manifest.routes,
    diagnostics: manifest.diagnostics
  };
}
