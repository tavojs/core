import type { PagesRuntime, RenderPagesDocumentAsyncOptions } from "../types.js";

type ProductionAssetMetadata = {
  clientEntryScript?: string;
  moduleCss?: Record<string, string[]>;
};

export function productionAssetHead(
  resolved: Awaited<ReturnType<PagesRuntime["resolvePathAsync"]>>,
  options?: RenderPagesDocumentAsyncOptions
): string {
  const assets = (options as RenderPagesDocumentAsyncOptions & {
    __tavoProductionAssets?: ProductionAssetMetadata;
  } | undefined)?.__tavoProductionAssets;
  if (!assets) return "";

  const cssFiles: string[] = [];
  const seen = new Set<string>();
  const appendModuleCss = (file: string) => {
    const normalized = `/${file.replace(/^\/+/, "")}`;
    for (const cssFile of assets.moduleCss?.[normalized] ?? []) {
      const href = `/${cssFile.replace(/^\/+/, "")}`;
      if (seen.has(href)) continue;
      seen.add(href);
      cssFiles.push(href);
    }
  };

  for (const layer of resolved.route?.layoutLayers ?? []) appendModuleCss(layer.file);
  if (resolved.route) appendModuleCss(resolved.route.file);

  const links = cssFiles
    .map((href) => `<link rel="stylesheet" href="${href}">`)
    .join("");
  const script = assets.clientEntryScript
    ? `<script type="module" src="/${assets.clientEntryScript.replace(/^\/+/, "")}"></script>`
    : "";
  return `${links}${script}`;
}
