import fs from "node:fs/promises";
import path from "node:path";
import type { ParsedCliArgs } from "./types.mjs";

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) {
      positionals.push(value);
      continue;
    }

    const flagBody = value.slice(2);
    const equalsIndex = flagBody.indexOf("=");
    if (equalsIndex >= 0) {
      const key = flagBody.slice(0, equalsIndex);
      flags[key] = flagBody.slice(equalsIndex + 1);
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      flags[flagBody] = next;
      index += 1;
      continue;
    }

    flags[flagBody] = true;
  }

  return { positionals, flags };
}

export async function getCliVersion(importMetaUrl: string): Promise<string> {
  const packageFile = path.resolve(path.dirname(new URL(importMetaUrl).pathname), "../package.json");
  const source = await fs.readFile(packageFile, "utf8");
  return JSON.parse(source).version ?? "0.0.0";
}
