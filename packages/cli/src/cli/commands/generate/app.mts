import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAppMainTsxSource } from "../../../scaffold-templates.mjs";
import {
  createAgentGuideSource,
  createAgentManifestSource,
  defaultStyleSource
} from "../../generate/templates.mjs";
import type { GeneratorOptions } from "../../types.mjs";
import { ensureDir, writeFileSafe, writeIfMissing } from "../../utils/fs.mjs";
import { cliExecHint } from "../../utils/format.mjs";

const STARTER_ASSETS = [
  "favicon.ico",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "apple-touch-icon.png",
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "site.webmanifest",
  "tavo.svg"
] as const;

const STARTER_ASSETS_DIR = fileURLToPath(
  new URL("../../../../assets/starter/", import.meta.url)
);

export async function createApp(
  dir: string,
  options: GeneratorOptions = {}
): Promise<void> {
  const root = path.resolve(process.cwd(), dir);
  await Promise.all([
    ensureDir(path.join(root, "src/pages")),
    ensureDir(path.join(root, "src/components")),
    ensureDir(path.join(root, "src/store")),
    ensureDir(path.join(root, "public")),
    ensureDir(path.join(root, ".tavo"))
  ]);

  const packageManager = options.packageManager ?? "npm";
  const writeProjectFile = (target: string, content: string): Promise<void> => (
    options.force
      ? writeFileSafe(target, content, { force: true })
      : writeIfMissing(target, content)
  );
  const copyProjectAsset = async (name: typeof STARTER_ASSETS[number]): Promise<void> => {
    const target = path.join(root, "public", name);
    if (!options.force) {
      try {
        await fs.access(target);
        return;
      } catch {
        // Copy the packaged asset when the starter does not have one yet.
      }
    }
    await fs.copyFile(path.join(STARTER_ASSETS_DIR, name), target);
  };

  await writeProjectFile(path.join(root, "package.json"), [
    "{",
    `  "name": "${path.basename(root)}",`,
    '  "private": true,',
    '  "type": "module",',
    `  "packageManager": "${packageManager}",`,
    '  "engines": {',
    '    "node": "^20.19.0 || >=22.12.0"',
    "  },",
    '  "scripts": {',
    '    "dev": "tavo dev",',
    '    "dev:ssr": "tavo dev --ssr",',
    '    "dev:csr": "vite",',
    '    "build": "tavo build",',
    '    "build:report": "tavo build --report-json",',
    '    "preview": "tavo preview",',
    '    "preview:ssr": "tavo preview --ssr",',
    '    "preview:csr": "vite preview",',
    '    "monitor": "tavo monitor",',
    '    "typecheck": "tsc --noEmit"',
    "  },",
    '  "dependencies": {',
    '    "@tavojs/core": "^1.0.0"',
    "  },",
    '  "devDependencies": {',
    '    "@types/node": "^25.9.3",',
    '    "@tavojs/cli": "^1.0.0",',
    '    "typescript": "^5.9.3",',
    '    "vite": "^7.3.2"',
    "  }",
    "}",
    ""
  ].join("\n"));
  await writeProjectFile(path.join(root, ".gitignore"), [
    "node_modules",
    "dist",
    ".tavo/cache",
    ".tavo/build",
    ".tavo/generated",
    ""
  ].join("\n"));
  await writeProjectFile(path.join(root, "tsconfig.json"), [
    "{",
    '  "compilerOptions": {',
    '    "target": "ES2022",',
    '    "module": "ESNext",',
    '    "moduleResolution": "Bundler",',
    '    "strict": true,',
    '    "jsx": "react-jsx",',
    '    "jsxImportSource": "@tavojs/core",',
    '    "types": ["vite/client", "node"],',
    '    "noEmit": true,',
    '    "skipLibCheck": true',
    "  },",
    '  "include": ["src"]',
    "}",
    ""
  ].join("\n"));
  await writeProjectFile(
    path.join(root, "vite.config.ts"),
    [
      'import { defineTavoViteConfig } from "@tavojs/core/config";',
      "",
      "export default defineTavoViteConfig();",
      ""
    ].join("\n")
  );
  await writeProjectFile(path.join(root, "index.html"), [
    "<!doctype html>",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />',
    '    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />',
    '    <link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png" />',
    '    <link rel="manifest" href="/site.webmanifest" />',
    "    <title>Tavo counter</title>",
    "  </head>",
    "  <body>",
    '    <div id="app"></div>',
    '    <script type="module" src="/src/main.tsx"></script>',
    "  </body>",
    "</html>",
    ""
  ].join("\n"));
  await writeProjectFile(path.join(root, "src/main.tsx"), createAppMainTsxSource());
  await Promise.all(STARTER_ASSETS.map(copyProjectAsset));
  await writeProjectFile(path.join(root, "tavo.config.ts"), [
    'import { defineConfig } from "@tavojs/core/config";',
    "",
    "export default defineConfig({",
    '  pagesDir: "src/pages",',
    '  cssEntries: ["src/styles.css"],',
    "  diagnostics: {",
    "    devOverlay: true,",
    "    traces: false",
    "  }",
    "});",
    ""
  ].join("\n"));
  await writeProjectFile(path.join(root, "src/pages/index.tsx"), [
    'import { Seo, createTavo } from "@tavojs/core";',
    "",
    'const pageDescription = "A polished counter starter built with Tavo.";',
    "",
    "const HomePage = createTavo({",
    '  model: () => ({ count: 0, theme: "dark" as "light" | "dark" }),',
    "  view: ({ state, model }) => (",
    '    <main className={`home-shell theme-${state.theme}`}>',
    '      <header className="app-header">',
    '        <div className="header-inner">',
    '          <a className="brand" href="/" aria-label="Tavo home">',
    '            <img src="/tavo.svg" alt="" width="44" height="44" />',
    '            <span>Tavo<span className="brand-accent">.js</span></span>',
    "          </a>",
    '          <span className="starter-label">Counter starter</span>',
    '          <button className="theme-toggle" type="button"',
    '            aria-label={`Switch to ${state.theme === "light" ? "dark" : "light"} mode`}',
    '            aria-pressed={state.theme === "dark"}',
    '            onClick={() => model.patch((previous) => ({',
    '              theme: previous.theme === "light" ? "dark" : "light"',
    '            }))}>',
    '            {state.theme === "dark" ? "Light mode" : "Dark mode"}',
    "          </button>",
    "        </div>",
    "      </header>",
    '      <div className="page-content">',
    '        <section className="hero" aria-labelledby="page-title">',
    '          <div className="hero-copy">',
    '            <p className="eyebrow"><span className="status-dot" /> Tavo starter</p>',
    '            <h1 id="page-title">State that moves <span>with you.</span></h1>',
    '            <p className="hero-description">A small counter with reactive state,',
    '              polished interactions, and production-ready structure.</p>',
    '            <div className="feature-pills" aria-label="Starter features">',
    '              <span>Typed TSX</span><span>Reactive state</span><span>SSR ready</span>',
    "            </div>",
    "          </div>",
    '          <section className="counter-panel" aria-label="Interactive counter">',
    '            <header className="panel-header">',
    '              <span>Counter</span><span className="panel-status"><span className="status-dot" /> Live</span>',
    "            </header>",
    '            <div className="counter-stage">',
    '              <span className="counter-caption">Current value</span>',
    '              <output className="counter-value" aria-live="polite"',
    '                aria-label={`Current count: ${state.count}`}>{state.count}</output>',
    '              <div className="counter-actions" aria-label="Counter controls">',
    '                <button className="counter-button" type="button" aria-label="Decrease counter"',
    '                  onClick={() => model.patch((previous) => ({ count: previous.count - 1 }))}>',
    '                  <span className="counter-icon counter-icon--minus" aria-hidden="true" />',
    '                </button>',
    '                <button className="reset-button" type="button" onClick={() => model.patch({ count: 0 })}>Reset</button>',
    '                <button className="counter-button counter-button--primary" type="button"',
    '                  aria-label="Increase counter"',
    '                  onClick={() => model.patch((previous) => ({ count: previous.count + 1 }))}>',
    '                  <span className="counter-icon counter-icon--plus" aria-hidden="true" />',
    '                </button>',
    "              </div>",
    "            </div>",
    '            <footer className="panel-footer"><code>model.patch()</code><span>{state.count} instant updates</span></footer>',
    "          </section>",
    "        </section>",
    '        <section className="starter-grid" aria-label="What is included">',
    '          <article><span className="card-number">01</span><h2>Reactive by default</h2>',
    '            <p>Every interaction updates only what changed, with no extra setup.</p></article>',
    '          <article><span className="card-number">02</span><h2>Typed from day one</h2>',
    '            <p>Your page and state model stay clear as the application grows.</p></article>',
    '          <article><span className="card-number">03</span><h2>Ready to extend</h2>',
    '            <p>Add routes, stores, loaders, and server rendering when you need them.</p></article>',
    "        </section>",
    '        <footer className="app-footer"><span>Built with Tavo</span><code>src/pages/index.tsx</code></footer>',
    "      </div>",
    "    </main>",
    "  )",
    "});",
    "",
    'export const head = <Seo title="Tavo counter" description={pageDescription} />;',
    "",
    "export default HomePage;",
    ""
  ].join("\n"));
  await writeProjectFile(path.join(root, "src/styles.css"), defaultStyleSource());
  await writeProjectFile(
    path.join(root, "AGENTS.md"),
    createAgentGuideSource(packageManager)
  );
  await writeProjectFile(
    path.join(root, ".tavo/agent-manifest.json"),
    createAgentManifestSource(packageManager)
  );

  console.log(`Created Tavo app in ${root}`);
  console.log("");
  console.log("Next steps:");
  console.log(`  cd ${dir}`);
  console.log(`  ${packageManager} install`);
  console.log(`  ${cliExecHint(packageManager)} tavo dev`);
}
