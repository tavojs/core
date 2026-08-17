import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { collectPageRoutes, collectTrailingSlashLinkDiagnostics, generateRouteArtifacts, paramsTypeFromRoutePath } from "../dist/cli/project/routes.mjs";
import { createTempProject, readJson, writeFixtureFile } from "./helpers.mjs";

test("collectPageRoutes supports index, route groups, layouts, dynamic, optional, and catch-all pages", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "src/pages/index.tsx");
  await writeFixtureFile(root, "src/pages/_layout.tsx");
  await writeFixtureFile(root, "src/pages/(marketing)/_layout.tsx");
  await writeFixtureFile(root, "src/pages/(marketing)/about.tsx");
  await writeFixtureFile(root, "src/pages/blog/[id].tsx");
  await writeFixtureFile(root, "src/pages/docs/[[section]].tsx");
  await writeFixtureFile(root, "src/pages/files/[...all].tsx");
  await writeFixtureFile(root, "src/pages/deep/[[...slug]].tsx");
  await writeFixtureFile(root, "src/pages/_error.tsx");
  await writeFixtureFile(root, "src/pages/404.tsx");

  const routes = await collectPageRoutes(root, "src/pages");
  assert.deepEqual(routes.map((route) => route.path), [
    "/",
    "/about",
    "/blog/:id",
    "/docs/:?section",
    "/files/*all",
    "/deep/*?slug"
  ]);

  const home = routes.find((route) => route.path === "/");
  assert.equal(home.files.length, 2);
  assert.equal(path.basename(home.files[0]), "_layout.tsx");

  const about = routes.find((route) => route.path === "/about");
  assert.deepEqual(
    about.files.map((file) => path.relative(root, file)),
    [
      "src/pages/_layout.tsx",
      "src/pages/(marketing)/_layout.tsx",
      "src/pages/(marketing)/about.tsx"
    ]
  );
});

test("generateRouteArtifacts writes manifest and typed route metadata", async () => {
  const root = await createTempProject();
  const home = await writeFixtureFile(root, "src/pages/index.tsx");
  const blog = await writeFixtureFile(root, "src/pages/blog/[id].tsx");
  const routes = [
    { path: "/", file: home, files: [home] },
    { path: "/blog/:id", file: blog, files: [blog] }
  ];

  await generateRouteArtifacts(root, routes);

  const manifest = await readJson(path.join(root, ".tavo/generated/route-manifest.json"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.routes.length, 2);
  assert.equal(manifest.routes[1].path, "/blog/:id");
  assert.equal(manifest.routes[1].file, "src/pages/blog/[id].tsx");

  const types = await fs.readFile(path.join(root, ".tavo/generated/routes.d.ts"), "utf8");
  assert.ok(types.includes('export type AppRoutePath = "/" | "/blog/:id";'));
  assert.ok(types.includes("TAVO_ROUTE_ARTIFACT_SCHEMA_VERSION: 1"));
  assert.ok(types.includes('"/blog/:id": { "id": string };'));

  await generateRouteArtifacts(root, routes);
  const regeneratedManifest = await readJson(path.join(root, ".tavo/generated/route-manifest.json"));
  const regeneratedTypes = await fs.readFile(path.join(root, ".tavo/generated/routes.d.ts"), "utf8");
  assert.deepEqual(regeneratedManifest.routes, manifest.routes);
  assert.equal(regeneratedTypes, types);
});

test("paramsTypeFromRoutePath reflects route parameter optionality", () => {
  assert.equal(paramsTypeFromRoutePath("/"), "Record<never, never>");
  assert.equal(paramsTypeFromRoutePath("/blog/:id"), '{ "id": string }');
  assert.equal(paramsTypeFromRoutePath("/docs/:?section"), '{ "section": string | undefined }');
  assert.equal(paramsTypeFromRoutePath("/files/*all"), '{ "all": string }');
  assert.equal(paramsTypeFromRoutePath("/deep/*?slug"), '{ "slug": string | undefined }');
});

test("trailing slash diagnostics ignore policy-neutral framework Links and flag raw anchors", async () => {
  const root = await createTempProject();
  const about = await writeFixtureFile(root, "src/pages/about.tsx");
  const blog = await writeFixtureFile(root, "src/pages/blog/[id].tsx");
  await fs.writeFile(
    path.join(root, "src/links.tsx"),
    [
      'import { Link } from "@tavojs/core";',
      'import { Link as UiLink } from "@tavojs/ui";',
      '<Link href="/about">Core</Link>;',
      '<UiLink href="/blog/hello?q=1#top">UI</UiLink>;',
      '<Button as={Link} href="/about">Composed</Button>;',
      '<a href="/about">Raw</a>;',
      '<Anchor href="/blog/hello?q=1#top">Uncanonicalized component</Anchor>;',
      '<a href="/assets/app.js">Asset</a>;',
    ].join("\n"),
  );
  const diagnostics = await collectTrailingSlashLinkDiagnostics(root, [
    { path: "/about", file: about, files: [about] },
    { path: "/blog/:id", file: blog, files: [blog] },
  ], "always");
  assert.equal(diagnostics.length, 2);
  assert.match(diagnostics.join("\n"), /\/about\//);
  assert.match(diagnostics.join("\n"), /\/blog\/hello\/\?q=1#top/);
  assert.doesNotMatch(diagnostics.join("\n"), /Core|Composed/);
  assert.doesNotMatch(diagnostics.join("\n"), /assets/);
});
