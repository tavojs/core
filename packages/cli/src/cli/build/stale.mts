import path from "node:path";
import { BUILD_DIR } from "../constants.mjs";
import { fileExists, latestModifiedTime, statSafe } from "../utils/fs.mjs";

export async function isSsrPreviewBuildStale(rootDir: string): Promise<boolean> {
  const startFile = path.join(rootDir, BUILD_DIR, "server", "start.mjs");
  const startStat = await statSafe(startFile);
  if (!startStat) {
    return true;
  }

  const candidates = [
    path.join(rootDir, "src"),
    path.join(rootDir, "public"),
    path.join(rootDir, "index.html"),
    path.join(rootDir, "vite.config.ts"),
    path.join(rootDir, "vite.config.js"),
    path.join(rootDir, "vite.config.mjs"),
    path.join(rootDir, "package.json"),
    path.join(rootDir, "server.mjs"),
    path.join(rootDir, "tavo.config.ts")
  ];

  let latestSourceChange = 0;
  for (const candidate of candidates) {
    if (!(await fileExists(candidate))) {
      continue;
    }
    latestSourceChange = Math.max(latestSourceChange, await latestModifiedTime(candidate));
  }

  return latestSourceChange > startStat.mtimeMs;
}
