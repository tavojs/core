import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { analyzeSource, type SourceAnalysis } from "../project/analyzer.mjs";
import { readFileSafe } from "./helpers.mjs";

const memoryCache = new Map<string, SourceAnalysis>();

function cacheFileFor(source: string): string {
  const hash = crypto.createHash("sha256").update(source).digest("hex");
  return path.join(process.cwd(), ".tavo", "cache", "analysis-v1", `${hash}.json`);
}

function isSourceAnalysis(value: unknown): value is SourceAnalysis {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<SourceAnalysis>;
  return (candidate.parser === "typescript" || candidate.parser === "fallback")
    && Array.isArray(candidate.parseDiagnostics)
    && Array.isArray(candidate.imports)
    && Array.isArray(candidate.exports)
    && typeof candidate.hasDefaultExport === "boolean";
}

async function isCachePathSafe(cacheFile: string): Promise<boolean> {
  try {
    const root = await fs.realpath(process.cwd());
    let existing = cacheFile;
    while (true) {
      try {
        const stat = await fs.lstat(existing);
        if (existing === cacheFile && stat.isSymbolicLink()) return false;
        break;
      } catch {
        const parent = path.dirname(existing);
        if (parent === existing) return false;
        existing = parent;
      }
    }
    const real = await fs.realpath(existing);
    return real === root || real.startsWith(`${root}${path.sep}`);
  } catch {
    return false;
  }
}

export async function analyzeProjectFile(file: string): Promise<{ source: string; analysis: SourceAnalysis } | null> {
  const source = await readFileSafe(file);
  if (!source) {
    return null;
  }
  const cacheFile = cacheFileFor(source);
  const persistentCacheSafe = await isCachePathSafe(cacheFile);
  const memory = memoryCache.get(cacheFile);
  if (memory) {
    return { source, analysis: memory };
  }
  try {
    if (!persistentCacheSafe) throw new Error("Unsafe cache path");
    const cached = JSON.parse(await fs.readFile(cacheFile, "utf8")) as unknown;
    if (isSourceAnalysis(cached)) {
      memoryCache.set(cacheFile, cached);
      return { source, analysis: cached };
    }
  } catch {
    // Cache misses and corrupt cache entries fall back to a fresh analysis.
  }
  const analysis = await analyzeSource(file, source);
  memoryCache.set(cacheFile, analysis);
  try {
    if (!persistentCacheSafe) throw new Error("Unsafe cache path");
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(cacheFile, `${JSON.stringify(analysis)}\n`, "utf8");
  } catch {
    // Inspection remains read-compatible when the project directory is not writable.
  }
  return {
    source,
    analysis
  };
}
