import fs from "node:fs/promises";
import path from "node:path";
import { PAGE_FILE_EXT } from "../constants.mjs";
import type { FileWriteOptions } from "../types.mjs";

export async function readFilesRecursive(rootDir: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(current: string): Promise<void> {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
        continue;
      }
      if (!PAGE_FILE_EXT.test(entry.name)) {
        continue;
      }
      out.push(fullPath);
    }
  }

  await walk(rootDir);
  return out;
}

export async function fileExists(pathname: string): Promise<boolean> {
  try {
    await fs.access(pathname);
    return true;
  } catch {
    return false;
  }
}

export async function statSafe(pathname: string): Promise<import("node:fs").Stats | null> {
  try {
    return await fs.stat(pathname);
  } catch {
    return null;
  }
}

export async function latestModifiedTime(pathname: string): Promise<number> {
  const stat = await statSafe(pathname);
  if (!stat) {
    return 0;
  }
  if (!stat.isDirectory()) {
    return stat.mtimeMs;
  }

  let latest = stat.mtimeMs;
  const entries = await fs.readdir(pathname, { withFileTypes: true });
  for (const entry of entries) {
    latest = Math.max(latest, await latestModifiedTime(path.join(pathname, entry.name)));
  }
  return latest;
}

export async function ensureDir(target: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
}

export async function writeIfMissing(target: string, content: string): Promise<void> {
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, content, "utf8");
  }
}

export async function writeFileSafe(target: string, content: string, options: FileWriteOptions = {}): Promise<void> {
  if (!options.force && (await fileExists(target))) {
    throw new Error(`tavo CLI: file already exists: ${target}`);
  }
  await ensureDir(path.dirname(target));
  await fs.writeFile(target, content, "utf8");
}
