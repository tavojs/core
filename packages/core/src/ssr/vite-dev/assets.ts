import type { PageModules } from "../../framework/index.js";
import type { NodeHandlerOptions, ViteDevServerLike } from "../types.js";
import { fileExists, readFilesRecursive, runtimeImport, toPosixPath } from "../runtime.js";

export async function resolveCssEntries(rootDir: string, entries?: string[]): Promise<string[]> {
  const path = await runtimeImport("node:path");
  const candidates = entries ?? ["src/styles.css", "src/styles.scss", "src/app.css", "src/app.scss"];
  const out: string[] = [];

  for (const entry of candidates) {
    const absolute = path.join(rootDir, entry);
    if (!(await fileExists(absolute))) {
      continue;
    }
    out.push(`/${toPosixPath(entry)}`);
  }

  return out;
}

export async function resolveClientModuleScripts(rootDir: string): Promise<string[]> {
  const path = await runtimeImport("node:path");
  const { readFile } = await runtimeImport("node:fs/promises");
  const indexFile = path.join(rootDir, "index.html");
  if (!(await fileExists(indexFile))) {
    return [];
  }

  const html = await readFile(indexFile, "utf8");
  const out: string[] = [];
  const scriptPattern = /<script\b(?=[^>]*\btype=["']module["'])(?=[^>]*\bsrc=["']([^"']+)["'])[^>]*><\/script>/gi;
  for (const match of html.matchAll(scriptPattern)) {
    const src = match[1];
    if (!src || !src.startsWith("/")) {
      continue;
    }
    out.push(src);
  }
  return out;
}

export async function resolveHtmlShellDocument(
  rootDir: string
): Promise<Pick<NonNullable<NodeHandlerOptions["document"]>, "title" | "unsafeHeadHtml">> {
  const path = await runtimeImport("node:path");
  const { readFile } = await runtimeImport("node:fs/promises");
  const indexFile = path.join(rootDir, "index.html");
  if (!(await fileExists(indexFile))) {
    return {};
  }

  const html = await readFile(indexFile, "utf8");
  const headMatch = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i);
  if (!headMatch) {
    return {};
  }

  let head = headMatch[1] ?? "";
  const titleMatch = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch?.[1]?.trim();
  head = head
    .replace(/<title\b[^>]*>[\s\S]*?<\/title>/gi, "")
    .replace(/<meta\b[^>]*charset=["']?[^>"']+["']?[^>]*>/gi, "")
    .replace(/<meta\b(?=[^>]*\bname=["']viewport["'])[^>]*>/gi, "")
    .replace(/<script\b(?=[^>]*\btype=["']module["'])[^>]*><\/script>/gi, "")
    .trim();

  return {
    ...(title ? { title } : {}),
    ...(head ? { unsafeHeadHtml: head } : {})
  };
}

export function mergeDocumentHeadWithDevAssets(
  document: NodeHandlerOptions["document"] | undefined,
  cssHrefs: string[],
  inlineStyles: string[],
  scriptSrcs: string[]
): NodeHandlerOptions["document"] {
  const originalHead = document?.unsafeHeadHtml ?? "";

  const links = cssHrefs
    .filter((href) => !originalHead.includes(`href="${href}"`))
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join("");

  const styles = inlineStyles.join("");

  const scripts = scriptSrcs
    .filter((src) => !originalHead.includes(`src="${src}"`))
    .map((src) => `<script type="module" src="${src}"></script>`)
    .join("");

  if (!links && !styles && !scripts) {
    return document;
  }

  return {
    ...(document ?? {}),
    unsafeHeadHtml: `${links}${styles}${originalHead}${scripts}`
  };
}

export function mergeHtmlShellDocument(
  shell: Pick<NonNullable<NodeHandlerOptions["document"]>, "title" | "unsafeHeadHtml">,
  document: NodeHandlerOptions["document"] | undefined
): NodeHandlerOptions["document"] {
  if (!shell.title && !shell.unsafeHeadHtml) {
    return document;
  }

  return {
    ...(document ?? {}),
    title: document?.title ?? shell.title,
    unsafeHeadHtml: `${shell.unsafeHeadHtml ?? ""}${document?.unsafeHeadHtml ?? ""}`
  };
}

export async function loadPageModulesForVite(
  vite: ViteDevServerLike,
  rootDir: string,
  pagesDir: string
): Promise<PageModules> {
  const path = await runtimeImport("node:path");
  const pagesRoot = path.join(rootDir, pagesDir);
  const files = await readFilesRecursive(pagesRoot);
  const modules: PageModules = {};

  for (const file of files) {
    const relative = toPosixPath(path.relative(rootDir, file));
    const modulePath = `/${relative}`;
    modules[modulePath] = (await vite.ssrLoadModule(modulePath)) as PageModules[string];
  }

  return modules;
}
