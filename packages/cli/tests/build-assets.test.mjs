import assert from "node:assert/strict";
import test from "node:test";
import { createClientAssetPlan } from "../dist/cli/commands/build.mjs";
import { createSsrEntrySource } from "../dist/cli/build/templates.mjs";
import { externalizePrerenderedStyles } from "../dist/cli/build/prerender.mjs";

test("production assets: route modules collect dependency CSS before owning CSS", () => {
  const plan = createClientAssetPlan({
    "index.html": {
      file: "assets/index-entry.js",
      css: ["assets/shared.css"],
      isEntry: true
    },
    "_common.js": {
      file: "assets/common.js",
      css: ["assets/common.css"]
    },
    "_page-dependency.js": {
      file: "assets/page-dependency.js",
      imports: ["_common.js"],
      css: ["assets/page-dependency.css"]
    },
    "src/pages/_layout.tsx": {
      file: "assets/layout.js",
      src: "src/pages/_layout.tsx",
      isDynamicEntry: true,
      imports: ["index.html", "_common.js"],
      css: ["assets/layout.css"]
    },
    "src/pages/docs/_layout.tsx": {
      file: "assets/docs-layout.js",
      src: "src/pages/docs/_layout.tsx",
      isDynamicEntry: true,
      imports: ["_common.js"],
      css: ["assets/docs-layout.css"]
    },
    "src/pages/docs/index.tsx": {
      file: "assets/docs-page.js",
      src: "src/pages/docs/index.tsx",
      isDynamicEntry: true,
      imports: ["_page-dependency.js", "_common.js"],
      css: ["assets/docs-page.css"]
    }
  }, {
    "src/pages/docs/index.tsx": [
      "/assets/docs-page.js",
      "/assets/docs-page.css",
      "/assets/ssr-only.css"
    ]
  });

  assert.deepEqual(plan.sharedCss, ["assets/shared.css"]);
  assert.equal(plan.clientEntryScript, "assets/index-entry.js");
  assert.deepEqual(plan.moduleCss["/src/pages/_layout.tsx"], [
    "assets/common.css",
    "assets/layout.css"
  ]);
  assert.deepEqual(plan.moduleCss["/src/pages/docs/_layout.tsx"], [
    "assets/common.css",
    "assets/docs-layout.css"
  ]);
  assert.deepEqual(plan.moduleCss["/src/pages/docs/index.tsx"], [
    "assets/common.css",
    "assets/page-dependency.css",
    "assets/docs-page.css",
    "assets/ssr-only.css"
  ]);
});

test("production assets: generated SSR entry keeps shared CSS separate from route metadata", () => {
  const source = createSsrEntrySource({
    pagesDir: "src/pages",
    assetPlan: {
      sharedCss: ["assets/shared.css"],
      clientEntryScript: "assets/entry.js",
      moduleCss: {
        "/src/pages/index.tsx": ["assets/home.css"]
      }
    }
  });

  assert.match(source, /generatedHead = `<link rel="stylesheet" href="\/assets\/shared\.css">`/);
  assert.match(source, /"clientEntryScript":"assets\/entry\.js"/);
  assert.match(source, /"\/src\/pages\/index\.tsx":\["assets\/home\.css"\]/);
  assert.match(source, /__tavoProductionAssets: productionAssets/);
  assert.equal(
    source.match(/createPagesRuntimeAsync\(/g)?.length,
    1,
    "the generated entry must create exactly one pages runtime",
  );
  assert.match(
    source,
    /createNodeRequestHandler\(options, runtimePromise\)/,
  );
  assert.match(
    source,
    /import\.meta\.glob\("\/src\/pages\/\*\*\/\*\.\{js,jsx,ts,tsx\}"\)/,
  );
  assert.match(source, /wrapped\.__tavo_loader__ = true/);
  assert.doesNotMatch(source, /pages\/\*\*\/\*\.\{js,jsx,ts,tsx\}"\s*,\s*\{\s*eager:\s*true/);
  assert.match(source, /await runtime\.loadRouteModules\(route\)/);
  assert.match(
    source,
    /runtime\.routes\.map\(\(route\) => runtime\.loadRouteModules\(route\)\)/,
  );
  assert.match(source, /import\.meta\.glob\(\["\/tavo\.config\.ts"\]\)/);
  assert.match(source, /@tavojs\/core\/config\/build-value/);
  assert.doesNotMatch(source, /tavo\.config\.ts"\], \{ eager: true \}/);
  assert.doesNotMatch(source, /loadPrerenderModules/);
  assert.doesNotMatch(
    source,
    /\b(?:createFetchRequestHandler|fetchHandler|cloudflare|lambda|vercel)\b/i,
  );
  assert.doesNotMatch(source, /generatedHead[^\n]+entry\.js/);
});

test("production assets: prerender styles become one fingerprinted route asset", () => {
  const result = externalizePrerenderedStyles(
    '<!doctype html><html><head><style data-tavo-style="tui.box">.box{display:block}</style><style data-tavo-style="tui.page">.page{padding:2rem}</style></head><body></body></html>'
  );

  assert.ok(result.asset);
  assert.match(result.asset.file, /^assets\/tavo-ssr-styles-[a-f0-9]{16}\.css$/);
  assert.equal(result.asset.css, ".box{display:block}\n.page{padding:2rem}\n");
  assert.deepEqual(result.asset.styleIds, ["tui.box", "tui.page"]);
  assert.match(result.html, new RegExp(`<link rel="stylesheet" href="/${result.asset.file}" data-tavo-style-bundle>`));
  assert.match(result.html, /<style data-tavo-style="tui\.box" data-tavo-style-external><\/style>/);
  assert.match(result.html, /<style data-tavo-style="tui\.page" data-tavo-style-external><\/style>/);
  assert.doesNotMatch(result.html, /\.box\{display:block\}/);
  assert.doesNotMatch(result.html, /\.page\{padding:2rem\}/);
});

test("production assets: custom attributed style tags stay inline", () => {
  const html = '<style data-tavo-style="demo.print" media="print">.print{display:block}</style>';
  const result = externalizePrerenderedStyles(html);

  assert.equal(result.asset, undefined);
  assert.equal(result.html, html);
});
