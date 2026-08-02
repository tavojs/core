import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runCli } from "../dist/cli/index.mjs";
import { captureConsole, createTempProject, writeFixtureFile } from "./helpers.mjs";

test("cli diagnostics include command context for unknown commands", async () => {
  const root = await createTempProject();

  await assert.rejects(
    runCli(["frobnicate", "widgets"], { cwd: root }),
    /unknown command "frobnicate widgets"/
  );
});

test("cli diagnostics preserve existing generated files unless force is explicit", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "src/pages/about.tsx", "existing\n");

  await assert.rejects(
    runCli(["generate", "page", "about"], { cwd: root }),
    /file already exists: .*about\.tsx/
  );
  assert.equal(await fs.readFile(path.join(root, "src/pages/about.tsx"), "utf8"), "existing\n");

  await runCli(["generate", "page", "about", "--force"], { cwd: root });
  assert.match(await fs.readFile(path.join(root, "src/pages/about.tsx"), "utf8"), /AboutPage/);
});

test("inventory reports agent-usable pages, components, stores, and actions", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(root, "src/pages/index.tsx", [
    'import { defineRoutePage } from "@tavojs/core/router";',
    "export const action = async () => new Response(null);",
    "function HomePage() { return <main>Home</main>; }",
    'export default defineRoutePage("/", { default: HomePage, action });',
    ""
  ].join("\n"));
  await writeFixtureFile(root, "src/components/card/index.tsx", [
    'import { createTavo } from "@tavojs/core";',
    "export const Card = createTavo({ view: () => <section /> });",
    ""
  ].join("\n"));
  await writeFixtureFile(root, "src/store/session.ts", [
    'import { defineGlobalStore } from "@tavojs/core";',
    'export const sessionStore = defineGlobalStore("session", () => ({ ready: false }));',
    ""
  ].join("\n"));

  const { stdout } = await captureConsole(async () => {
    await runCli(["inventory", "--json"], { cwd: root });
  });
  const payload = JSON.parse(stdout);
  assert.equal(payload.data.pages.length, 1);
  assert.equal(payload.data.pages[0].path, "/");
  assert.equal(payload.data.pages[0].hasAction, true);
  assert.equal(payload.data.components[0].exports[0], "Card");
  assert.equal(payload.data.stores[0].exports[0], "sessionStore");
  assert.deepEqual(payload.data.actions, [{ route: "/", file: "src/pages/index.tsx", exportName: "action" }]);
});

test("agent context includes inventory and recipes", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(root, "src/pages/index.tsx", [
    'import { defineRoutePage } from "@tavojs/core/router";',
    "function HomePage() { return <main>Home</main>; }",
    'export default defineRoutePage("/", { default: HomePage });',
    ""
  ].join("\n"));

  const { stdout } = await captureConsole(async () => {
    await runCli(["agent-context", "--json", "--detail", "full"], { cwd: root });
  });
  const payload = JSON.parse(stdout);
  assert.equal(payload.data.inventory.pages[0].path, "/");
  assert.ok(payload.data.recipes.some((recipe) => recipe.id === "page"));
});

test("doctor diagnostics expose category, confidence, source range, and safe fix metadata", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(root, "src/pages/about.tsx", [
    'import { defineRoutePage } from "@tavojs/core/router";',
    "function AboutPage() { return <main>About</main>; }",
    'export default defineRoutePage("/wrong", { default: AboutPage });',
    ""
  ].join("\n"));

  const { stdout } = await captureConsole(async () => {
    await runCli(["doctor", "--json"], { cwd: root });
  });
  const payload = JSON.parse(stdout);
  const mismatch = payload.diagnostics.find((diagnostic) => diagnostic.code === "route-pattern-mismatch");
  assert.equal(mismatch.category, "routing");
  assert.equal(mismatch.confidence, "high");
  assert.equal(mismatch.safeToAutoFix, true);
  assert.equal(mismatch.sourceRange.startLine, 3);
});

test("verify smoke reports parse and route export failures", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(root, "src/pages/broken.tsx", [
    "export const value = ;",
    ""
  ].join("\n"));

  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const { stdout } = await captureConsole(async () => {
    await runCli(["verify", "--smoke", "--json"], { cwd: root });
  });
  process.exitCode = previousExitCode;
  const payload = JSON.parse(stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.data.smoke, true);
  assert.ok(payload.diagnostics.some((diagnostic) => diagnostic.code === "route-parse-error"));
  assert.ok(payload.diagnostics.some((diagnostic) => diagnostic.code === "route-missing-default-export"));
});

test("targeted verification includes dependent route surfaces", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(root, "src/components/Card.tsx", "export function Card() { return <section />; }\n");
  await writeFixtureFile(root, "src/pages/index.tsx", 'import { Card } from "../components/Card";\nexport const broken = ;\nexport default Card;\n');

  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  const { stdout } = await captureConsole(async () => {
    await runCli(["verify", "--files", "src/components/Card.tsx", "--smoke", "--json"], { cwd: root });
  });
  process.exitCode = previousExitCode;
  const payload = JSON.parse(stdout);
  assert.deepEqual(payload.data.files, ["src/components/Card.tsx"]);
  assert.ok(payload.data.dependencyFiles.includes("src/pages/index.tsx"));
  assert.ok(payload.diagnostics.some((diagnostic) => diagnostic.code === "route-parse-error"));
});
