import assert from "node:assert/strict";
import test from "node:test";
import { parseCliArgs } from "../dist/cli/args.mjs";
import { cliExecHint, formatSize, parseByteSize, toCamelCase, toPascalCase } from "../dist/cli/utils/format.mjs";
import { validateBuildBudgets } from "../dist/cli/build/report.mjs";
import { normalizeGeneratorName, normalizeModuleId, normalizePathname, toPosixPath } from "../dist/cli/utils/path.mjs";

test("parseCliArgs separates positionals, boolean flags, equals flags, and valued flags", () => {
  const parsed = parseCliArgs([
    "create",
    "app",
    "demo",
    "--force",
    "--package-manager",
    "pnpm",
    "--target=node",
    "--json"
  ]);

  assert.deepEqual(parsed.positionals, ["create", "app", "demo"]);
  assert.deepEqual(parsed.flags, {
    force: true,
    "package-manager": "pnpm",
    target: "node",
    json: true
  });
});

test("format and path helpers keep CLI output and generated names stable", () => {
  assert.equal(formatSize(0), "0 B");
  assert.equal(formatSize(1536), "1.5 kB");
  assert.equal(formatSize(1024 * 1024 * 2), "2.0 MB");
  assert.equal(parseByteSize("150kb"), 153600);
  assert.equal(parseByteSize("1.5 MiB"), 1572864);
  assert.equal(parseByteSize("invalid"), undefined);
  assert.equal(toPascalCase("admin/user-card"), "AdminUserCard");
  assert.equal(toPascalCase("[id]"), "Id");
  assert.equal(toPascalCase("[[...slug]]"), "Slug");
  assert.equal(toPascalCase("123-report"), "_123Report");
  assert.equal(toCamelCase("admin user-card"), "adminUserCard");
  assert.equal(cliExecHint("pnpm"), "pnpm exec");
  assert.equal(cliExecHint("npm"), "npx");
  assert.equal(normalizePathname("docs"), "/docs");
  assert.equal(toPosixPath("src\\pages\\index.tsx"), "src/pages/index.tsx");
  assert.equal(normalizeModuleId("src/pages/index.tsx?import"), "src/pages/index.tsx");
  assert.equal(normalizeGeneratorName("dashboard/users/"), "dashboard/users");
  assert.throws(() => normalizeGeneratorName("/dashboard/users/"), /relative path/);
});

test("build budgets report exact offending routes", () => {
  const violations = validateBuildBudgets({
    rows: [
      { symbol: "ƒ", route: "/", size: 20_000, firstLoadJs: 100_000 },
      { symbol: "ƒ", route: "/heavy", size: 60_000, firstLoadJs: 180_000 }
    ]
  }, {
    firstLoadJs: 150_000,
    routeJs: 50_000
  });

  assert.equal(violations.length, 2);
  assert.ok(violations.every((message) => message.startsWith("/heavy:")));
});
