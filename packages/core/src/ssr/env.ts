import fs from "node:fs";
import path from "node:path";
import { parse } from "dotenv";

export type LoadServerEnvOptions = {
  mode?: string;
  root?: string;
};

function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) {
    return {};
  }
  return parse(fs.readFileSync(file));
}

/** Loads server-only .env files into process.env without exposing them to client code. */
export function loadServerEnv(options: LoadServerEnvOptions = {}): Record<string, string> {
  const processRef = (globalThis as unknown as {
    process?: { cwd?: () => string; env?: Record<string, string | undefined> };
  }).process;
  if (!processRef?.env) {
    return {};
  }

  const root = path.resolve(options.root ?? processRef.cwd?.() ?? ".");
  const mode = options.mode?.trim();
  const candidates = [
    ".env",
    ".env.local",
    ...(mode ? [`.env.${mode}`, `.env.${mode}.local`] : [])
  ];
  const shellEnv = { ...processRef.env };
  const loaded: Record<string, string> = {};

  for (const candidate of candidates) {
    const parsed = readEnvFile(path.join(root, candidate));
    for (const [key, value] of Object.entries(parsed)) {
      loaded[key] = value;
      if (shellEnv[key] === undefined) {
        processRef.env[key] = value;
      }
    }
  }

  return loaded;
}
