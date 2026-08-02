import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Position } from "./types.mjs";

const FORBIDDEN_CHANGE_PREFIXES = [
  ".git/",
  "node_modules/",
  ".tavo/build/",
  ".tavo/generated/"
];

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function shellArgument(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function assertSafeFile(rootDir: string, file: string): string {
  if (!file || path.isAbsolute(file)) throw new Error(`Unsafe change target: ${file}.`);
  const normalized = file.replace(/\\/g, "/");
  const hasTraversal = normalized.split("/").some((part) => part === "..");
  const hasForbiddenPrefix = FORBIDDEN_CHANGE_PREFIXES.some((prefix) => (
    normalized.startsWith(prefix)
  ));
  if (hasTraversal || hasForbiddenPrefix) {
    throw new Error(`Unsafe change target: ${file}.`);
  }
  const absolute = path.resolve(rootDir, file);
  if (!absolute.startsWith(`${rootDir}${path.sep}`)) {
    throw new Error(`Unsafe change target: ${file}.`);
  }
  return absolute;
}

export async function assertNoSymlinkEscape(
  rootDir: string,
  target: string
): Promise<void> {
  const rootReal = await fs.realpath(rootDir);
  let existing = target;
  while (true) {
    try {
      const stat = await fs.lstat(existing);
      if (existing === target && stat.isSymbolicLink()) {
        throw new Error(
          `Change targets cannot be symbolic links: ${path.relative(rootDir, target)}.`
        );
      }
      break;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Change targets")) {
        throw error;
      }
      const parent = path.dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  const existingReal = await fs.realpath(existing);
  const isInsideRoot = existingReal === rootReal
    || existingReal.startsWith(`${rootReal}${path.sep}`);
  if (!isInsideRoot) {
    throw new Error(
      `Change target escapes the project through a symbolic link: ${path.relative(rootDir, target)}.`
    );
  }
}

export function offsetAt(source: string, position: Position): number {
  const isValidPosition = Number.isInteger(position.line)
    && Number.isInteger(position.column)
    && position.line >= 1
    && position.column >= 1;
  if (!isValidPosition) {
    throw new Error("Change ranges use one-based positive line and column values.");
  }
  const lines = source.split("\n");
  const line = lines[position.line - 1];
  if (position.line > lines.length || position.column > (line?.length ?? 0) + 1) {
    throw new Error(
      `Change range ${position.line}:${position.column} is outside the file.`
    );
  }
  let offset = 0;
  for (let index = 0; index < position.line - 1; index += 1) {
    offset += lines[index]!.length + 1;
  }
  return offset + position.column - 1;
}

export async function readExisting(target: string): Promise<string | null> {
  return fs.readFile(target, "utf8").catch(() => null);
}
