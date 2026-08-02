import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const srcRoot = new URL("../../src", import.meta.url);
const forbiddenPublicExports = [
  "useEffect",
  "useLayoutEffect",
  "useMemo",
  "useRef",
  "useId",
  "useContext",
  "createContext",
  "useStore",
  "useExternalStore",
  "useRouter",
  "useLocation"
];

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      files.push(...collectSourceFiles(path));
      continue;
    }
    if (/\.(ts|tsx)$/.test(entry)) {
      files.push(path);
    }
  }
  return files;
}

test("framework source does not expose or import hook functionality", () => {
  const offenders: string[] = [];
  for (const file of collectSourceFiles(srcRoot.pathname)) {
    const source = readFileSync(file, "utf8");
    if (/hooks-runtime|components\/hooks|\.\/hooks/.test(source)) {
      offenders.push(`${file}: imports hook runtime`);
    }
    for (const name of forbiddenPublicExports) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const exportPattern = new RegExp(`export\\s+(?:\\{[^}]*\\b${escaped}\\b|function\\s+${escaped}\\b|const\\s+${escaped}\\b)`, "s");
      if (exportPattern.test(source)) {
        offenders.push(`${file}: exports ${name}`);
      }
    }
  }

  assert.deepEqual(offenders, []);
});
