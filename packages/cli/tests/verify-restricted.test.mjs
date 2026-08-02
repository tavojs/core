import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runCli } from "../dist/cli/index.mjs";
import {
  captureConsole,
  createTempProject,
  writeFixtureFile,
} from "./helpers.mjs";

test("verify --no-project-scripts does not execute a mutating typecheck script", async () => {
  const root = await createTempProject("tavo-restricted-verify-");
  const marker = path.join(root, "typecheck-mutated.txt");
  await writeFixtureFile(
    root,
    "package.json",
    JSON.stringify({
      type: "module",
      scripts: {
        typecheck:
          "node -e \"require('node:fs').writeFileSync('typecheck-mutated.txt','ran')\"",
      },
    }),
  );
  await writeFixtureFile(root, "src/pages/index.tsx");
  await writeFixtureFile(
    root,
    "node_modules/typescript/package.json",
    JSON.stringify({ name: "typescript", version: "0.0.0" }),
  );

  const restrictedOutput = await captureConsole(async () => {
    await runCli(["verify", "--no-project-scripts", "--json"], {
      version: "0.0.0",
      cwd: root,
    });
  });
  const restricted = JSON.parse(restrictedOutput.stdout);
  assert.equal(restricted.data.projectScripts, false);
  await assert.rejects(fs.access(marker));

  const normalOutput = await captureConsole(async () => {
    await runCli(["verify", "--json"], {
      version: "0.0.0",
      cwd: root,
    });
  });
  const normal = JSON.parse(normalOutput.stdout);
  assert.equal(normal.data.projectScripts, true);
  assert.equal(await fs.readFile(marker, "utf8"), "ran");
  process.exitCode = 0;
});
