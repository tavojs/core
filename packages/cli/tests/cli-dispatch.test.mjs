import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { runCli } from "../dist/cli/index.mjs";
import {
  assertIncludes,
  captureConsole,
  createTempProject,
  tavoConfigFixture,
  writeFixtureFile,
} from "./helpers.mjs";

test("runCli prints version and help without touching the project", async () => {
  const versionOutput = await captureConsole(async () => {
    await runCli(["--version"], { version: "9.9.9" });
  });
  assert.equal(versionOutput.stdout, "9.9.9");

  const helpOutput = await captureConsole(async () => {
    await runCli(["--help"], { version: "9.9.9" });
  });
  assertIncludes(helpOutput.stdout, "tavo CLI v9.9.9");
  assertIncludes(helpOutput.stdout, "tavo build");
});

test("runCli dispatches route inspection against the supplied cwd", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(root, "src/pages/index.tsx");
  await writeFixtureFile(root, "src/pages/blog/[id].tsx");

  const output = await captureConsole(async () => {
    await runCli(["routes"], { version: "0.0.0", cwd: root });
  });

  assertIncludes(output.stdout, "Routes from src/pages:");
  assertIncludes(output.stdout, "/blog/:id");
  assert.equal(
    process.cwd().endsWith(root),
    false,
    "runCli should restore the previous cwd after dispatch",
  );
});

test("runCli prints JSON project and route inspection payloads", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(root, "src/pages/index.tsx");
  await writeFixtureFile(root, "src/pages/blog/[id].tsx");
  await writeFixtureFile(root, "src/pages/_layout.tsx");

  const infoOutput = await captureConsole(async () => {
    await runCli(["info", "--json"], { version: "0.0.0", cwd: root });
  });
  const info = JSON.parse(infoOutput.stdout);
  assert.equal(info.data.pagesDir, "src/pages");
  assert.equal(info.data.routesCount, 2);
  assert.deepEqual(info.data.validationCommands, ["tavo check", "tavo build"]);

  const routesOutput = await captureConsole(async () => {
    await runCli(["routes", "--json"], { version: "0.0.0", cwd: root });
  });
  const routes = JSON.parse(routesOutput.stdout);
  const blog = routes.data.routes.find((route) => route.path === "/blog/:id");
  assert.equal(blog.file, "src/pages/blog/[id].tsx");
  assert.deepEqual(blog.params, [
    { name: "id", optional: false, catchAll: false },
  ]);
  assert.deepEqual(blog.layouts, ["src/pages/_layout.tsx"]);
});

test("runCli evaluates project config with production environment through the shared core loader", async () => {
  const root = await createTempProject();
  const envName = `TAVO_CLI_CONFIG_${crypto.randomBytes(6).toString("hex")}`;
  try {
    await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
    await writeFixtureFile(
      root,
      ".env.production",
      `${envName}=app/pages\n`,
    );
    await writeFixtureFile(
      root,
      "tavo.config.ts",
      tavoConfigFixture(`{ pagesDir: process.env.${envName} }`),
    );
    await writeFixtureFile(root, "app/pages/index.tsx");

    const output = await captureConsole(async () => {
      await runCli(["info", "--json"], { version: "0.0.0", cwd: root });
    });

    assert.equal(JSON.parse(output.stdout).data.pagesDir, "app/pages");
  } finally {
    delete process.env[envName];
  }
});

test("runCli inspects plugins and includes plugin preflight in verify", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(root, "src/pages/index.tsx");
  await writeFixtureFile(
    root,
    "tavo.config.ts",
    `export default {
    plugins: [
      { id: "@example/one", version: "1.0.0", apiVersion: 1 },
      { id: "@example/one", version: "1.0.0", apiVersion: 1 }
    ]
  };\n`,
  );
  await writeFixtureFile(
    root,
    "node_modules/@tavojs/core/package.json",
    JSON.stringify({
      name: "@tavojs/core",
      type: "module",
      exports: {
        "./dev": "./dev.mjs",
      },
    }),
  );
  await writeFixtureFile(
    root,
    "node_modules/@tavojs/core/dev.mjs",
    `
    export async function loadTavoConfig() {
      return {
        plugins: [
          { id: "@example/one", version: "1.0.0", apiVersion: 1 },
          { id: "@example/one", version: "1.0.0", apiVersion: 1 }
        ]
      };
    }

    export function inspectPluginGraph(config) {
      const plugins = config?.map((plugin, index) => ({
        id: plugin.id,
        instanceId: index === 0 ? "default" : "duplicate"
      })) ?? [];
      const duplicate = plugins.length > 1;
      return {
        valid: !duplicate,
        diagnostics: duplicate ? [{
          code: "TAVO_PLUGIN_002",
          severity: "error",
          message: "Duplicate plugin ownership."
        }] : [],
        plugins,
        capabilities: [],
        mounts: [],
        middleware: [],
        head: [],
        endpoints: [],
        permissions: [{
          owner: "@example/one#default",
          name: "unsafeHeadHtml",
          required: true,
          reason: "Injects a trusted bootstrap script."
        }],
        exposure: [{
          owner: "@example/one#default",
          target: "server",
          from: "/",
          to: "/",
          reason: "Publishes a public endpoint."
        }]
      };
    }
  `,
  );

  process.exitCode = 0;
  const inspectOutput = await captureConsole(async () => {
    await runCli(["inspect", "plugins", "--json"], { cwd: root });
  });
  const inspected = JSON.parse(inspectOutput.stdout);
  assert.equal(inspected.command, "inspect-plugins");
  assert.equal(inspected.ok, false);
  assert.equal(
    inspected.data.plugins.length,
    2,
    JSON.stringify(inspected.diagnostics),
  );
  assert.equal(inspected.data.permissions[0].name, "unsafeHeadHtml");
  assert.equal(inspected.data.exposure[0].to, "/");
  assert.equal(inspected.diagnostics[0].code, "TAVO_PLUGIN_002");
  assert.equal(process.exitCode, 1);

  process.exitCode = 0;
  const humanInspection = await captureConsole(async () => {
    await runCli(["inspect", "plugins"], { cwd: root });
  });
  assert.match(humanInspection.stdout, /unsafeHeadHtml \(required\)/);
  assert.match(humanInspection.stdout, /Injects a trusted bootstrap script/);
  assert.match(humanInspection.stdout, /server \/ -> \//);

  process.exitCode = 0;
  const verifyOutput = await captureConsole(async () => {
    await runCli(["verify", "--json"], { cwd: root });
  });
  const verified = JSON.parse(verifyOutput.stdout);
  assert.equal(verified.data.plugins.valid, false);
  assert.ok(
    verified.diagnostics.some(
      (diagnostic) => diagnostic.code === "TAVO_PLUGIN_002",
    ),
  );
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test("runCli doctor and check expose structured diagnostics", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(
    root,
    "src/pages/bad/[id.tsx",
    "export default function Bad() { return <main />; }\n",
  );
  const doctorOutput = await captureConsole(async () => {
    await runCli(["doctor", "--json"], { version: "0.0.0", cwd: root });
  });
  const doctor = JSON.parse(doctorOutput.stdout);
  assert.equal(doctor.ok, false);
  assert.ok(
    doctor.diagnostics.some(
      (diagnostic) => diagnostic.code === "invalid-route-segment",
    ),
  );
  const fixOutput = await captureConsole(async () => {
    await runCli(["doctor", "--fix-dry-run", "--json"], {
      version: "0.0.0",
      cwd: root,
    });
  });
  const fixes = JSON.parse(fixOutput.stdout);
  assert.ok(fixes.data.fixes.some((fix) => fix.code === "missing-bootstrap"));
  assert.ok(fixes.data.fixes.some((fix) => fix.kind === "create-file"));

  process.exitCode = 0;
  const checkOutput = await captureConsole(async () => {
    await runCli(["check", "--json"], { version: "0.0.0", cwd: root });
  });
  const check = JSON.parse(checkOutput.stdout);
  assert.equal(check.ok, false);
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test("runCli doctor applies low-risk fixes only", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(
    root,
    "tavo.config.ts",
    tavoConfigFixture(
      '{ pagesDir: "src/pages", cssEntries: ["src/styles.css"] }',
    ),
  );
  await writeFixtureFile(
    root,
    "src/pages/blog/[id].tsx",
    'import { defineRoutePage } from "@tavojs/core/router";\n\nasync function load({ params }: PageLoadContext) { return { id: params.id }; }\n\nexport default defineRoutePage("/wrong", { load, default: () => <main /> });\n',
  );

  const output = await captureConsole(async () => {
    await runCli(["doctor", "--fix", "--json"], {
      version: "0.0.0",
      cwd: root,
    });
  });
  const result = JSON.parse(output.stdout);
  assert.ok(
    result.data.appliedFixes.some((fix) => fix.code === "missing-bootstrap"),
  );
  assert.ok(
    result.data.appliedFixes.some((fix) => fix.code === "missing-css-entry"),
  );
  assert.ok(
    result.data.appliedFixes.some(
      (fix) => fix.code === "missing-page-load-context-import",
    ),
  );
  assert.ok(
    result.data.appliedFixes.some(
      (fix) => fix.code === "route-pattern-mismatch",
    ),
  );
  assert.match(
    await fs.readFile(path.join(root, "src/main.tsx"), "utf8"),
    /bootTavo/,
  );
  assert.match(
    await fs.readFile(path.join(root, "src/styles.css"), "utf8"),
    /box-sizing/,
  );
  const page = await fs.readFile(
    path.join(root, "src/pages/blog/[id].tsx"),
    "utf8",
  );
  assert.match(page, /type PageLoadContext/);
  assert.match(page, /defineRoutePage\("\/blog\/\[id\]"/);
});

test("runCli prints consolidated agent context", async () => {
  const root = await createTempProject();
  await writeFixtureFile(
    root,
    "package.json",
    '{"type":"module","scripts":{"typecheck":"tsc --noEmit"}}\n',
  );
  await writeFixtureFile(root, "src/pages/index.tsx");

  const output = await captureConsole(async () => {
    await runCli(["agent-context", "--json"], { version: "0.0.0", cwd: root });
  });
  const context = JSON.parse(output.stdout);
  assert.equal(context.schemaVersion, 1);
  assert.equal(context.command, "agent-context");
  assert.equal(context.data.framework, "tavo");
  assert.equal(context.data.conventions.page, "functional-module");
  assert.equal(context.data.conventions.optionalTypedPage, "defineRoutePage");
  assert.equal(context.data.project.routeCount, 1);
  assert.ok(context.metrics.bytes < 8 * 1024);
});

test("agent context and inspection select only task-relevant entities", async () => {
  const root = await createTempProject();
  await writeFixtureFile(
    root,
    "package.json",
    '{"name":"focused-app","type":"module"}\n',
  );
  await writeFixtureFile(
    root,
    "src/pages/index.tsx",
    "export default function Home() { return <main />; }\n",
  );
  await writeFixtureFile(
    root,
    "src/pages/blog/[id].tsx",
    'import { defineRoutePage } from "@tavojs/core/router";\nexport default defineRoutePage("/blog/[id]", { default: () => <main /> });\n',
  );

  const contextOutput = await captureConsole(async () => {
    await runCli(
      [
        "agent-context",
        "--json",
        "--task",
        "modify-route",
        "--target",
        "/blog/:id",
      ],
      { cwd: root },
    );
  });
  const context = JSON.parse(contextOutput.stdout);
  assert.equal(context.data.focus.file, "src/pages/blog/[id].tsx");
  assert.equal(context.data.inventory, undefined);
  assert.ok(context.data.api.some((card) => card.id === "defineRoutePage"));
  assert.ok(Buffer.byteLength(contextOutput.stdout) < 8 * 1024);

  const inspectOutput = await captureConsole(async () => {
    await runCli(["inspect", "route", "/blog/:id", "--json"], { cwd: root });
  });
  const inspected = JSON.parse(inspectOutput.stdout);
  assert.equal(inspected.data.entity.file, "src/pages/blog/[id].tsx");
  assert.match(inspected.data.entity.sha256, /^[a-f0-9]{64}$/);

  await writeFixtureFile(
    root,
    "src/pages/blog/[id].tsx",
    "export default function Changed() { return <article />; }\n",
  );
  const changedOutput = await captureConsole(async () => {
    await runCli(["inspect", "route", "/blog/:id", "--json"], { cwd: root });
  });
  assert.notEqual(
    JSON.parse(changedOutput.stdout).data.entity.sha256,
    inspected.data.entity.sha256,
  );
});

test("source analysis refuses persistent cache paths that escape through symlinks", async () => {
  const root = await createTempProject();
  const outside = await createTempProject("tavo-cache-outside-");
  await fs.unlink(path.join(outside, "tavo.config.ts"));
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(
    root,
    "src/pages/index.tsx",
    "export default function Home(){ return <main />; }\n",
  );
  await fs.symlink(outside, path.join(root, ".tavo"));

  const output = await captureConsole(async () => {
    await runCli(
      ["agent-context", "--json", "--task", "modify-route", "--target", "/"],
      { cwd: root },
    );
  });
  assert.equal(JSON.parse(output.stdout).ok, true);
  assert.deepEqual(await fs.readdir(outside), []);
});

test("transactional change plans enforce hashes and emit verifiable receipts", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  const source = 'export const value = "old";\n';
  await writeFixtureFile(root, "src/value.ts", source);
  const hash = crypto.createHash("sha256").update(source).digest("hex");
  await writeFixtureFile(
    root,
    "change.json",
    JSON.stringify({
      schemaVersion: 1,
      operations: [
        {
          id: "replace",
          kind: "replace-range",
          file: "src/value.ts",
          expectedSha256: hash,
          range: {
            start: { line: 1, column: 23 },
            end: { line: 1, column: 26 },
          },
          text: "new",
        },
        {
          id: "create",
          kind: "create-file",
          file: "src/extra.ts",
          content: "export {};\n",
        },
      ],
    }),
  );

  const dryOutput = await captureConsole(async () => {
    await runCli(["change", "--from-json", "change.json", "--dry-run"], {
      cwd: root,
    });
  });
  const dry = JSON.parse(dryOutput.stdout);
  assert.equal(dry.data.transaction, "planned");
  assert.equal(
    await fs.readFile(path.join(root, "src/value.ts"), "utf8"),
    source,
  );

  const output = await captureConsole(async () => {
    await runCli(["change", "--from-json", "change.json"], { cwd: root });
  });
  const receipt = JSON.parse(output.stdout);
  assert.equal(receipt.data.transaction, "committed");
  assert.deepEqual(Object.keys(receipt.data.fileHashes), [
    "src/extra.ts",
    "src/value.ts",
  ]);
  assert.match(receipt.data.fileHashes["src/value.ts"], /^[a-f0-9]{64}$/);
  assert.match(
    await fs.readFile(path.join(root, "src/value.ts"), "utf8"),
    /"new"/,
  );

  await writeFixtureFile(root, "receipt.json", JSON.stringify(receipt));
  const verifyOutput = await captureConsole(async () => {
    await runCli(["verify", "--receipt", "receipt.json", "--json"], {
      cwd: root,
    });
  });
  assert.deepEqual(JSON.parse(verifyOutput.stdout).data.files, [
    "src/extra.ts",
    "src/value.ts",
  ]);

  const outside = await createTempProject("tavo-receipt-outside-");
  await writeFixtureFile(outside, "receipt.json", JSON.stringify(receipt));
  await fs.symlink(
    path.join(outside, "receipt.json"),
    path.join(root, "linked-receipt.json"),
  );
  process.exitCode = 0;
  const escapedReceiptOutput = await captureConsole(async () => {
    await runCli(["verify", "--receipt", "linked-receipt.json", "--json"], {
      cwd: root,
    });
  });
  const escapedReceipt = JSON.parse(escapedReceiptOutput.stdout);
  assert.equal(escapedReceipt.ok, false);
  assert.equal(escapedReceipt.diagnostics[0].code, "verify-receipt-invalid");
  assert.equal(process.exitCode, 1);

  process.exitCode = 0;
  const staleOutput = await captureConsole(async () => {
    await runCli(["change", "--from-json", "change.json"], { cwd: root });
  });
  assert.equal(
    JSON.parse(staleOutput.stdout).diagnostics[0].code,
    "change-plan-rejected",
  );
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
});

test("transactional change plans reject traversal and symlink escapes", async () => {
  const root = await createTempProject();
  const outside = await createTempProject("tavo-change-outside-");
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await fs.symlink(outside, path.join(root, "linked"));
  for (const [name, file] of [
    ["traversal", "../outside.ts"],
    ["symlink", "linked/outside.ts"],
  ]) {
    await writeFixtureFile(
      root,
      `${name}.json`,
      JSON.stringify({
        schemaVersion: 1,
        operations: [
          { id: name, kind: "create-file", file, content: "unsafe\n" },
        ],
      }),
    );
    process.exitCode = 0;
    const output = await captureConsole(async () => {
      await runCli(["change", "--from-json", `${name}.json`], { cwd: root });
    });
    assert.equal(JSON.parse(output.stdout).ok, false);
    assert.equal(process.exitCode, 1);
  }
  process.exitCode = 0;
  await assert.rejects(fs.access(path.join(outside, "outside.ts")));
});

test("transactional change plans roll back earlier writes after an execution failure", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(root, "blocked", "not a directory\n");
  await writeFixtureFile(
    root,
    "rollback.json",
    JSON.stringify({
      schemaVersion: 1,
      operations: [
        {
          id: "first",
          kind: "create-file",
          file: "src/first.ts",
          content: "export {};\n",
        },
        {
          id: "failure",
          kind: "create-file",
          file: "blocked/file.ts",
          content: "export {};\n",
        },
      ],
    }),
  );

  process.exitCode = 0;
  const output = await captureConsole(async () => {
    await runCli(["change", "--from-json", "rollback.json"], { cwd: root });
  });
  const result = JSON.parse(output.stdout);
  assert.equal(result.data.transaction, "rolled-back");
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;
  await assert.rejects(fs.access(path.join(root, "src/first.ts")));
});

test("transactional change plans apply identified low-risk diagnostics", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  const source =
    'import { defineRoutePage } from "@tavojs/core/router";\nexport default defineRoutePage("/wrong", { default: () => <main /> });\n';
  await writeFixtureFile(root, "src/pages/about.tsx", source);
  const expectedSha256 = crypto
    .createHash("sha256")
    .update(source)
    .digest("hex");
  await writeFixtureFile(
    root,
    "fix.json",
    JSON.stringify({
      schemaVersion: 1,
      operations: [
        {
          id: "fix-route",
          kind: "apply-fix",
          diagnosticCode: "route-pattern-mismatch",
          file: "src/pages/about.tsx",
          expectedSha256,
        },
      ],
    }),
  );

  const output = await captureConsole(async () => {
    await runCli(["change", "--from-json", "fix.json"], { cwd: root });
  });
  assert.equal(JSON.parse(output.stdout).data.transaction, "committed");
  assert.match(
    await fs.readFile(path.join(root, "src/pages/about.tsx"), "utf8"),
    /defineRoutePage\("\/about"/,
  );

  await writeFixtureFile(
    root,
    "create-fix.json",
    JSON.stringify({
      schemaVersion: 1,
      operations: [
        {
          id: "create-bootstrap",
          kind: "apply-fix",
          diagnosticCode: "missing-bootstrap",
          file: "src/main.tsx",
          expectedMissing: true,
        },
      ],
    }),
  );
  const createOutput = await captureConsole(async () => {
    await runCli(["change", "--from-json", "create-fix.json"], { cwd: root });
  });
  assert.equal(JSON.parse(createOutput.stdout).data.transaction, "committed");
  assert.match(
    await fs.readFile(path.join(root, "src/main.tsx"), "utf8"),
    /bootTavo/,
  );
});

test("runCli generates from JSON specs", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(
    root,
    "spec.json",
    JSON.stringify([
      { kind: "page", name: "blog/[id]", loader: true, seo: true },
      { kind: "component", name: "UserCard", props: true },
      { kind: "store", name: "session", shape: ["user", "ready"] },
    ]),
  );

  await captureConsole(async () => {
    await runCli(["generate", "--from-json", "spec.json"], {
      version: "0.0.0",
      cwd: root,
    });
  });

  assert.match(
    await fs.readFile(path.join(root, "src/pages/blog/[id].tsx"), "utf8"),
    /export default function IdPage/,
  );
  assert.match(
    await fs.readFile(
      path.join(root, "src/components/UserCard/index.tsx"),
      "utf8",
    ),
    /type UserCardProps/,
  );
  assert.match(
    await fs.readFile(path.join(root, "src/store/session.ts"), "utf8"),
    /ready: null/,
  );
});

test("runCli validates generator specs and verifies projects", async () => {
  const root = await createTempProject();
  await writeFixtureFile(root, "package.json", '{"type":"module"}\n');
  await writeFixtureFile(root, "src/pages/index.tsx");
  await writeFixtureFile(
    root,
    "valid.json",
    JSON.stringify([{ kind: "page", name: "dashboard", seo: true }]),
  );
  await writeFixtureFile(
    root,
    "invalid.json",
    JSON.stringify([
      { kind: "store", name: "session", shape: ["ok", "not-valid!"] },
    ]),
  );

  const validOutput = await captureConsole(async () => {
    await runCli(["generate", "--validate-spec", "valid.json"], {
      version: "0.0.0",
      cwd: root,
    });
  });
  assert.equal(JSON.parse(validOutput.stdout).ok, true);

  process.exitCode = 0;
  const invalidOutput = await captureConsole(async () => {
    await runCli(["generate", "--validate-spec", "invalid.json"], {
      version: "0.0.0",
      cwd: root,
    });
  });
  const invalid = JSON.parse(invalidOutput.stdout);
  assert.equal(invalid.ok, false);
  assert.equal(invalid.diagnostics[0].path, "$[0].shape[1]");
  assert.equal(process.exitCode, 1);
  process.exitCode = 0;

  const verifyOutput = await captureConsole(async () => {
    await runCli(["verify", "--spec", "valid.json", "--json"], {
      version: "0.0.0",
      cwd: root,
    });
  });
  const verify = JSON.parse(verifyOutput.stdout);
  assert.equal(verify.data.phase, verify.ok ? "complete" : "diagnostics");
  assert.ok(Array.isArray(verify.data.nextCommands));
  process.exitCode = 0;
});

test("runCli create app writes the expected starter files", async () => {
  const root = await createTempProject();
  await captureConsole(async () => {
    await runCli(["create", "app", "demo", "--package-manager", "npm"], {
      version: "0.0.0",
      cwd: root,
      promptProjectName: async () => {
        throw new Error("A supplied project name should not trigger a prompt.");
      },
    });
  });

  const appRoot = path.join(root, "demo");
  assert.match(
    await fs.readFile(path.join(appRoot, "src/pages/index.tsx"), "utf8"),
    /State that moves/,
  );

});

test("runCli prompts for a project name when create app omits it", async () => {
  const root = await createTempProject();
  let promptCalls = 0;

  await captureConsole(async () => {
    await runCli(["create", "app", "--package-manager", "npm"], {
      version: "0.0.0",
      cwd: root,
      promptProjectName: async () => {
        promptCalls += 1;
        return "prompted-app";
      },
    });
  });

  assert.equal(promptCalls, 1);
  const packageJson = JSON.parse(
    await fs.readFile(path.join(root, "prompted-app", "package.json"), "utf8"),
  );
  assert.equal(packageJson.name, "prompted-app");
  assert.equal(packageJson.packageManager, "npm");
});

test("runCli handles project-name prompt cancellation without an error", async () => {
  const root = await createTempProject();
  const output = await captureConsole(async () => {
    await runCli(["create", "app"], {
      version: "0.0.0",
      cwd: root,
      promptProjectName: async () => null,
    });
  });

  assert.equal(output.stdout, "Project creation cancelled.");
  assert.equal(output.stderr, "");
  assert.deepEqual(await fs.readdir(root), ["tavo.config.ts"]);
});
