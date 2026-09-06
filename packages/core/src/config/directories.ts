import fs from "node:fs";
import path from "node:path";

/** Vite may identify modules using either configured paths or resolved symlinks. */
export function resolveDirectoryPaths(directory: string): string[] {
  const configured = path.resolve(directory);
  try {
    return Array.from(new Set([configured, fs.realpathSync.native(configured)]));
  } catch {
    return [configured];
  }
}

export function isWithinDirectory(file: string, directory: string): boolean {
  const relative = path.relative(directory, file).replace(/\\/g, "/");
  return relative !== ".." && !relative.startsWith("../") && !path.isAbsolute(relative);
}
