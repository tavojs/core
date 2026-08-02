import type { ViteDevServerLike } from "../types.js";
import { fileExists, readFilesRecursive, runtimeImport, toPosixPath } from "../runtime.js";
import { escapeHtml } from "../../security.js";

const SOURCE_MODULE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".mts", ".mjs", ".cts", ".cjs"];
const STYLE_EXTENSIONS = [".css", ".scss", ".sass", ".less", ".styl", ".stylus"];

function stripImportQuery(specifier: string): string {
  return specifier.split(/[?#]/)[0] ?? specifier;
}

export function isStyleModulePath(pathname: string): boolean {
  return STYLE_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

function isSourceModulePath(pathname: string): boolean {
  return SOURCE_MODULE_EXTENSIONS.some((extension) => pathname.endsWith(extension));
}

function isRelativeOrRootImport(specifier: string): boolean {
  return specifier.startsWith(".") || specifier.startsWith("/");
}

function extractStaticImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importPattern =
    /\bimport\s+(?:[^'"()]*?\s+from\s*)?["']([^"']+)["']|\bexport\s+[^"']*?\s+from\s+["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
  for (const match of source.matchAll(importPattern)) {
    const specifier = match[1] ?? match[2] ?? match[3];
    if (specifier) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

async function resolveImportPath(
  vite: ViteDevServerLike,
  rootDir: string,
  importer: string,
  specifier: string
): Promise<string | null> {
  const path = await runtimeImport("node:path");
  const resolver = vite.pluginContainer?.resolveId;
  if (resolver) {
    const resolved = await resolver.call(vite.pluginContainer, specifier, importer, { ssr: true });
    const resolvedId = typeof resolved === "string" ? resolved : resolved?.id;
    if (resolvedId && !resolvedId.startsWith("\0")) {
      let resolvedPath = stripImportQuery(resolvedId);
      if (resolvedPath.startsWith("/@fs/")) {
        resolvedPath = resolvedPath.slice(4);
      }
      if (!path.isAbsolute(resolvedPath)) {
        resolvedPath = path.resolve(rootDir, resolvedPath);
      }

      const relativeToRoot = path.relative(rootDir, resolvedPath);
      const isApplicationFile =
        relativeToRoot !== "" &&
        !relativeToRoot.startsWith(`..${path.sep}`) &&
        relativeToRoot !== ".." &&
        !path.isAbsolute(relativeToRoot) &&
        !relativeToRoot.split(path.sep).includes("node_modules");
      if (
        isApplicationFile &&
        (isStyleModulePath(resolvedPath) || isSourceModulePath(resolvedPath)) &&
        await fileExists(resolvedPath)
      ) {
        return resolvedPath;
      }
    }
  }

  if (!isRelativeOrRootImport(specifier)) {
    return null;
  }

  const cleanSpecifier = stripImportQuery(specifier);
  const base = cleanSpecifier.startsWith("/")
    ? path.join(rootDir, cleanSpecifier.slice(1))
    : path.resolve(path.dirname(importer), cleanSpecifier);

  if (isStyleModulePath(base) || isSourceModulePath(base)) {
    return (await fileExists(base)) ? base : null;
  }

  for (const extension of [...SOURCE_MODULE_EXTENSIONS, ...STYLE_EXTENSIONS]) {
    const file = `${base}${extension}`;
    if (await fileExists(file)) {
      return file;
    }
  }

  for (const extension of [...SOURCE_MODULE_EXTENSIONS, ...STYLE_EXTENSIONS]) {
    const file = path.join(base, `index${extension}`);
    if (await fileExists(file)) {
      return file;
    }
  }

  return null;
}

function escapeStyleText(css: string): string {
  return css.replace(/<\/style/gi, "<\\/style");
}

function minifyCss(css: string): string {
  let out = "";
  let quote: string | null = null;
  let escaped = false;
  let inComment = false;
  let pendingSpace = false;
  // CSS arithmetic requires whitespace around binary + and - operators.
  // Keeping + spaced also preserves valid adjacent-sibling selectors.
  const compactAround = "{}:;,>~[]=";

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index] ?? "";
    const next = css[index + 1] ?? "";

    if (inComment) {
      if (char === "*" && next === "/") {
        inComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      out += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "*") {
      inComment = true;
      index += 1;
      continue;
    }

    if (char === "\"" || char === "'") {
      if (pendingSpace && out && !compactAround.includes(out.at(-1) ?? "")) {
        out += " ";
      }
      pendingSpace = false;
      quote = char;
      out += char;
      continue;
    }

    if (/\s/.test(char)) {
      pendingSpace = true;
      continue;
    }

    if (compactAround.includes(char)) {
      out = out.replace(/\s+$/, "");
      out += char;
      pendingSpace = false;
      continue;
    }

    if (pendingSpace && out && !compactAround.includes(out.at(-1) ?? "")) {
      out += " ";
    }
    pendingSpace = false;
    out += char;
  }

  return out.trim().replace(/;}/g, "}");
}

async function collectStyleImportsFromPageGraph(
  vite: ViteDevServerLike,
  rootDir: string,
  pagesDir: string
): Promise<string[]> {
  const path = await runtimeImport("node:path");
  const { readFile } = await runtimeImport("node:fs/promises");
  const pagesRoot = path.join(rootDir, pagesDir);
  const pageFiles = await readFilesRecursive(pagesRoot);
  const visited = new Set<string>();
  const styles = new Set<string>();

  async function visit(file: string): Promise<void> {
    if (visited.has(file)) {
      return;
    }
    visited.add(file);

    if (isStyleModulePath(file)) {
      styles.add(file);
      return;
    }
    if (!isSourceModulePath(file)) {
      return;
    }

    let source = "";
    try {
      source = await readFile(file, "utf8");
    } catch {
      return;
    }

    for (const specifier of extractStaticImportSpecifiers(source)) {
      const resolved = await resolveImportPath(vite, rootDir, file, specifier);
      if (!resolved) {
        continue;
      }
      await visit(resolved);
    }
  }

  for (const pageFile of pageFiles) {
    await visit(pageFile);
  }

  return Array.from(styles);
}

export async function resolveInlineViteStyleTags(
  vite: ViteDevServerLike,
  rootDir: string,
  pagesDir: string
): Promise<string[]> {
  const path = await runtimeImport("node:path");
  const styleFiles = await collectStyleImportsFromPageGraph(vite, rootDir, pagesDir);
  const tags: string[] = [];

  for (const file of styleFiles) {
    const relative = toPosixPath(path.relative(rootDir, file));
    const modulePath = `/${relative}`;
    const viteStyleId = toPosixPath(file);
    // Keep selectors on the same invalidation graph as the SSR modules that
    // produced the markup. The client transform cache can lag behind SSR HMR.
    const loaded = (await vite.ssrLoadModule(`${modulePath}?inline`)) as {
      default?: unknown;
    };
    const cssText = loaded.default;
    if (typeof cssText !== "string" || !cssText) {
      continue;
    }
    tags.push(
      `<style type="text/css" data-vite-dev-id="${escapeHtml(viteStyleId)}">${escapeStyleText(minifyCss(cssText))}</style>`
    );
  }

  return tags;
}
