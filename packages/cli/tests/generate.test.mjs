import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import {
  createApp,
  generateComponent,
  generateFromSpec,
  generateLayout,
  generateNotFoundPage,
  generateErrorPage,
  generateActionPage,
  generatePage,
  generateStore
} from "../dist/cli/commands/generate.mjs";
import { createTempProject, withCwd } from "./helpers.mjs";

async function assertGeneratedFilesTypecheck(root, files) {
  const declarations = path.join(root, "generator-test-types.d.ts");
  await fs.writeFile(
    declarations,
    [
      "declare namespace JSX {",
      "  type Element = unknown;",
      "  interface ElementChildrenAttribute { children: {}; }",
      "  interface IntrinsicElements { [name: string]: Record<string, unknown>; }",
      "}",
      'declare module "@tavojs/core" {',
      "  export type Child = unknown;",
      "  export type PropsWithChildren<P extends Record<string, unknown> = Record<string, unknown>> = P & { children?: Child };",
      "}",
      'declare module "@tavojs/core/router" {',
      "  export type PageLoadContext = { params: Record<string, string | undefined> };",
      "  export function defineRoutePage<TPath extends string, TData = unknown>(path: TPath, definition: Record<string, unknown>): unknown;",
      "}",
      ""
    ].join("\n"),
    "utf8"
  );

  const program = ts.createProgram({
    rootNames: [declarations, ...files.map((file) => path.join(root, file))],
    options: {
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.Preserve,
      strict: true,
      noEmit: true,
      skipLibCheck: true
    }
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(
    diagnostics.map((diagnostic) => {
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
      if (!diagnostic.file || diagnostic.start === undefined) {
        return message;
      }
      const position = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start);
      return `${path.relative(root, diagnostic.file.fileName)}:${position.line + 1}:${position.character + 1} ${message}`;
    }),
    []
  );
}

function relativeLuminance(hex) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    .map((value) => {
      const channel = Number.parseInt(value, 16) / 255;
      return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(foreground, background) {
  const lighter = Math.max(relativeLuminance(foreground), relativeLuminance(background));
  const darker = Math.min(relativeLuminance(foreground), relativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

test("createApp scaffolds a usable Tavo.js project shape without overwriting existing files", async () => {
  const workspace = await createTempProject();
  await withCwd(workspace, async () => {
    await createApp("demo", { packageManager: "pnpm" });
  });

  const root = path.join(workspace, "demo");
  const packageJson = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
  assert.equal(packageJson.packageManager, "pnpm");
  assert.equal(packageJson.scripts.dev, "tavo dev");
  assert.equal(packageJson.scripts["dev:ssr"], "tavo dev --ssr");
  assert.equal(packageJson.scripts.build, "tavo build");
  assert.equal(packageJson.scripts.preview, "tavo preview");
  assert.equal(packageJson.scripts["preview:ssr"], "tavo preview --ssr");
  assert.equal(packageJson.scripts["dev:csr"], "vite");
  assert.equal(packageJson.scripts["preview:csr"], "vite preview");
  assert.equal(packageJson.dependencies["@tavojs/core"], "^1.0.0");
  assert.equal(packageJson.devDependencies["@tavojs/cli"], "^1.0.0");
  assert.equal(packageJson.devDependencies["@types/node"], "^25.9.3");

  const tsconfig = JSON.parse(await fs.readFile(path.join(root, "tsconfig.json"), "utf8"));
  assert.deepEqual(tsconfig.compilerOptions.types, ["vite/client", "node"]);

  const home = await fs.readFile(path.join(root, "src/pages/index.tsx"), "utf8");
  assert.match(home, /import \{ Seo, createTavo \} from "@tavojs\/core";/);
  assert.doesNotMatch(home, /@tavojs\/core\/(?:client|framework|seo)/);
  assert.match(home, /createTavo/);
  assert.match(home, /export default HomePage/);
  assert.match(home, /<Seo title="Tavo\.js counter" description=\{pageDescription\}/);
  assert.match(home, /State that moves/);
  assert.match(home, /aria-label="Interactive counter"/);
  assert.match(home, /counter-icon--minus/);
  assert.match(home, /counter-icon--plus/);
  assert.doesNotMatch(home, /SkipLink/);
  assert.match(home, /theme-\$\{state\.theme\}/);
  assert.doesNotMatch(home, /Suspense|clone|alternative|versus|vs\./i);

  const main = await fs.readFile(path.join(root, "src/main.tsx"), "utf8");
  assert.match(main, /bootTavo/);
  assert.doesNotMatch(main, /auto-pages|discoverPagesModules|bootstrapAutoPages/);

  const indexHtml = await fs.readFile(path.join(root, "index.html"), "utf8");
  assert.match(indexHtml, /<title>Tavo\.js counter<\/title>/);
  assert.doesNotMatch(indexHtml, /<meta name="description"/);
  assert.match(indexHtml, /href="\/favicon-32x32\.png"/);
  assert.match(indexHtml, /href="\/site\.webmanifest"/);

  const style = await fs.readFile(path.join(root, "src/styles.css"), "utf8");
  assert.match(style, /--accent: #a78bfa;/);
  assert.match(style, /--border: #2a2a2a;/);
  assert.match(style, /\.home-shell\.theme-dark/);
  assert.ok(contrastRatio("#000000", "#a78bfa") >= 4.5);

  const logo = await fs.readFile(path.join(root, "public/tavo.svg"), "utf8");
  assert.match(logo, /<svg/);
  assert.match(logo, /#974DFF/);

  const faviconHashes = {
    "favicon.ico": "68ffa68c6bffd987aabe4e47ea7424f59d29f5bdecbec71a1d8a4cf7df3f814a",
    "favicon-16x16.png": "2000b780544b4b08232345ad1c5f6952743a3e8a8d5c5f56bb94c54bca0c7d0d",
    "favicon-32x32.png": "ad08be6e4f89869537d0757f458ce6d8213894ed7e1e7fce3dab6f0a25ae0af3",
    "apple-touch-icon.png": "cbcad9ecda62477f4de47e871102e0040d1da2bdf14251acbfca663f740fbb6a",
    "android-chrome-192x192.png": "2a9397db1992b655fd0a5fbace680f17d63f2da51797d24579978341405e4798",
    "android-chrome-512x512.png": "367771249a2a6aba2cc956847dbe9a9fe0ade8571378238ab6d87a33ae353ccf"
  };
  for (const [name, expectedHash] of Object.entries(faviconHashes)) {
    const contents = await fs.readFile(path.join(root, "public", name));
    assert.equal(createHash("sha256").update(contents).digest("hex"), expectedHash);
  }
  const manifest = JSON.parse(await fs.readFile(path.join(root, "public/site.webmanifest"), "utf8"));
  assert.equal(manifest.icons.length, 2);

  const agentGuide = await fs.readFile(path.join(root, "AGENTS.md"), "utf8");
  assert.match(agentGuide, /defineRoutePage/);
  assert.match(agentGuide, /it is not React/);
  assert.match(agentGuide, /tavo:\/\/status/);
  assert.match(agentGuide, /Do not edit `\.tavo\/generated`/);

  const agentManifest = JSON.parse(await fs.readFile(path.join(root, ".tavo/agent-manifest.json"), "utf8"));
  assert.equal(agentManifest.framework, "tavo");
  assert.equal(agentManifest.schemaVersion, 1);
  assert.equal(agentManifest.conventions.preferredPageApi, "functional-module");
  assert.equal(agentManifest.conventions.optionalTypedPageApi, "defineRoutePage");
  assert.ok(agentManifest.tasks.includes("repair"));
  assert.equal(
    agentManifest.schemas.changePlan,
    "@tavojs/cli/schemas/change-plan-v1.schema.json"
  );
  assert.equal(agentManifest.documentation.index, "https://tavojs.dev/llms.txt");
  assert.equal(agentManifest.documentation.mcpStatusResource, "tavo://status");

  await assert.rejects(
    fs.access(path.join(root, "server.mjs")),
    /ENOENT/
  );
});

test("generators create functional pages, optional typed pages, MVC components, stores, and layouts", async () => {
  const root = await createTempProject();
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}\n', "utf8");

  await withCwd(root, async () => {
    await generatePage("dashboard/users", { loader: true, seo: true });
    await generatePage("dashboard/typed", { typedRoute: true });
    await generateComponent("stats-card", { props: true });
    await generateStore("session", { shape: "user,ready" });
    await generateLayout("dashboard");
  });

  const page = await fs.readFile(path.join(root, "src/pages/dashboard/users.tsx"), "utf8");
  assert.match(page, /import \{ Seo \} from "@tavojs\/core";/);
  assert.doesNotMatch(page, /@tavojs\/core\/(?:framework|seo)/);
  assert.match(page, /export async function load/);
  assert.match(page, /export default function UsersPage/);
  assert.match(page, /<Seo title="Users" description="Users page" \/>/);
  assert.match(
    await fs.readFile(path.join(root, "src/pages/dashboard/typed.tsx"), "utf8"),
    /defineRoutePage<"\/dashboard\/typed">/,
  );
  assert.match(await fs.readFile(path.join(root, "src/components/stats-card/index.tsx"), "utf8"), /type StatsCardProps/);
  const store = await fs.readFile(path.join(root, "src/store/session.ts"), "utf8");
  assert.match(store, /user: null/);
  assert.match(store, /ready: null/);
  assert.match(await fs.readFile(path.join(root, "src/pages/dashboard/_layout.tsx"), "utf8"), /props.children/);
});

test("schema generator creates multiple agent-oriented files", async () => {
  const root = await createTempProject();
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}\n', "utf8");

  await withCwd(root, async () => {
    await generateFromSpec([
      { kind: "page", name: "blog/[id]", loader: true, seo: true },
      { kind: "component", name: "user-card", props: true },
      { kind: "store", name: "session", shape: ["user", "ready"] },
      { kind: "404" },
      { kind: "error" },
      { kind: "action", name: "contact" }
    ]);
  });

  const blog = await fs.readFile(path.join(root, "src/pages/blog/[id].tsx"), "utf8");
  assert.match(blog, /type PageLoadContext/);
  assert.match(blog, /params\.id/);
  assert.match(await fs.readFile(path.join(root, "src/pages/404.tsx"), "utf8"), /Page not found/);
  assert.match(await fs.readFile(path.join(root, "src/pages/_error.tsx"), "utf8"), /Something went wrong/);
  const actionPage = await fs.readFile(path.join(root, "src/pages/contact.tsx"), "utf8");
  assert.match(actionPage, /export const action = defineAction/);
  assert.match(actionPage, /export default function ContactPage/);
});

test("feature recipes are dry-runnable and preflight all files transactionally", async () => {
  const root = await createTempProject();
  await fs.mkdir(path.join(root, "src/components/billing"), { recursive: true });
  await fs.writeFile(path.join(root, "src/components/billing/index.tsx"), "existing\n", "utf8");

  await assert.rejects(
    withCwd(root, () => generateFromSpec({ kind: "feature", name: "billing" })),
    /file already exists/
  );
  await assert.rejects(fs.access(path.join(root, "src/pages/billing/index.tsx")));
  assert.equal(await fs.readFile(path.join(root, "src/components/billing/index.tsx"), "utf8"), "existing\n");

  await withCwd(root, () => generateFromSpec({
    kind: "feature",
    name: "account",
    parts: ["page", "component", "store", "action", "layout"],
    loader: true,
    props: true,
    shape: ["user", "ready"]
  }, { dryRun: true }));
  await assert.rejects(fs.access(path.join(root, "src/pages/account/index.tsx")));

  await withCwd(root, () => generateFromSpec({
    kind: "feature",
    name: "account",
    parts: ["page", "component", "store", "action", "layout"]
  }));
  for (const file of [
    "src/pages/account/index.tsx",
    "src/pages/account/action.tsx",
    "src/pages/account/_layout.tsx",
    "src/components/account/index.tsx",
    "src/store/account.ts"
  ]) {
    await fs.access(path.join(root, file));
  }
});

test("page and layout generators emit strict-TypeScript-safe identifiers and props", async () => {
  const root = await createTempProject();
  await fs.writeFile(path.join(root, "package.json"), '{"type":"module"}\n', "utf8");

  await withCwd(root, async () => {
    await generatePage("blog/[id]", { loader: true });
    await generatePage("files/[...all]", { loader: true });
    await generatePage("deep/[[...slug]]", { loader: true });
    await generatePage("123-report");
    await generateLayout("dashboard");
  });

  const generatedFiles = [
    "src/pages/blog/[id].tsx",
    "src/pages/files/[...all].tsx",
    "src/pages/deep/[[...slug]].tsx",
    "src/pages/123-report.tsx",
    "src/pages/dashboard/_layout.tsx"
  ];
  assert.match(await fs.readFile(path.join(root, generatedFiles[0]), "utf8"), /function IdPage/);
  assert.match(await fs.readFile(path.join(root, generatedFiles[1]), "utf8"), /function AllPage/);
  assert.match(await fs.readFile(path.join(root, generatedFiles[2]), "utf8"), /function SlugPage/);
  assert.match(await fs.readFile(path.join(root, generatedFiles[3]), "utf8"), /function _123ReportPage/);
  assert.match(
    await fs.readFile(path.join(root, generatedFiles[4]), "utf8"),
    /function Layout\(props: PropsWithChildren\)/
  );
  await assertGeneratedFilesTypecheck(root, generatedFiles);
});

test("store generator rejects invalid schema shape keys", async () => {
  const root = await createTempProject();

  await assert.rejects(
    withCwd(root, async () => {
      await generateStore("session", { shape: "user,not-valid-key!" });
    }),
    /invalid store shape key/
  );
});

test("generators protect existing files unless force is enabled", async () => {
  const root = await createTempProject();
  await fs.mkdir(path.join(root, "src/pages"), { recursive: true });
  await fs.writeFile(path.join(root, "src/pages/about.tsx"), "existing\n", "utf8");

  await assert.rejects(
    withCwd(root, async () => {
      await generatePage("about");
    }),
    /file already exists/
  );

  await withCwd(root, async () => {
    await generatePage("about", { force: true });
  });
  assert.match(await fs.readFile(path.join(root, "src/pages/about.tsx"), "utf8"), /AboutPage/);
});

test("generators reject path traversal names", async () => {
  const root = await createTempProject();

  await assert.rejects(
    withCwd(root, async () => {
      await generatePage("../../outside");
    }),
    /path segments/
  );

  await assert.rejects(
    withCwd(root, async () => {
      await generateComponent("/absolute");
    }),
    /relative path/
  );
});
