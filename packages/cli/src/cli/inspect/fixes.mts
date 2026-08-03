import fs from "node:fs/promises";
import path from "node:path";
import { collectPageRoutes, generateRouteArtifacts } from "../project/routes.mjs";
import { readPagesDirFromConfig } from "../project/config.mjs";
import { fileExists } from "../utils/fs.mjs";
import { readFileSafe } from "./helpers.mjs";
import type { FixOperation, ProjectDiagnostic } from "./types.mjs";

export function printFixDryRun(diagnostics: ProjectDiagnostic[]): void {
  if (diagnostics.length === 0) {
    console.log("Tavo.js doctor: no fixes suggested.");
    return;
  }
  console.log("Tavo.js doctor fix dry-run:");
  for (const diagnostic of diagnostics) {
    if (!diagnostic.suggestedFix) {
      continue;
    }
    const location = diagnostic.file ? `${diagnostic.file}${diagnostic.line ? `:${diagnostic.line}` : ""}` : "project";
    console.log(`  ${diagnostic.code} (${location})`);
    console.log(`    ${diagnostic.suggestedFix}`);
  }
}

export function createBootstrapSource(): string {
  return [
    'import { bootTavo } from "@tavojs/core";',
    'import "./styles.css";',
    "",
    "void bootTavo().catch((error) => {",
    "  console.error(\"[tavo bootstrap error]\", error);",
    "});",
    ""
  ].join("\n");
}

export function createEmptyCssSource(): string {
  return [
    ":root {",
    "  color-scheme: light;",
    "}",
    "",
    "* { box-sizing: border-box; }",
    "",
    "body {",
    "  margin: 0;",
    "  min-width: 320px;",
    "}",
    ""
  ].join("\n");
}

export async function applyFix(rootDir: string, fix: FixOperation): Promise<{ applied: boolean; reason?: string }> {
  if (fix.risk !== "low") {
    return { applied: false, reason: "manual-risk" };
  }
  if (fix.kind === "create-file") {
    const target = path.join(rootDir, fix.file);
    if (await fileExists(target)) {
      return { applied: false, reason: "file-exists" };
    }
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, fix.content, "utf8");
    return { applied: true };
  }
  if (fix.kind === "replace-text" || fix.kind === "update-import") {
    const target = path.join(rootDir, fix.file);
    const source = await readFileSafe(target);
    if (!source) {
      return { applied: false, reason: "file-missing" };
    }
    if (!source.includes(fix.before)) {
      return { applied: false, reason: "text-not-found" };
    }
    await fs.writeFile(target, source.replace(fix.before, fix.after), "utf8");
    return { applied: true };
  }
  if (fix.kind === "run-command" && fix.command === "tavo build:routes") {
    const pagesDir = await readPagesDirFromConfig(rootDir);
    const routes = await collectPageRoutes(rootDir, pagesDir);
    await generateRouteArtifacts(rootDir, routes);
    return { applied: true };
  }
  return { applied: false, reason: "unsupported-fix" };
}
