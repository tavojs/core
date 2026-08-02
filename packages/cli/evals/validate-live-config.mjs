import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const adapters = [process.env.ADAPTER_A, process.env.ADAPTER_B];
for (const [index, adapter] of adapters.entries()) {
  if (!adapter || path.isAbsolute(adapter) || adapter.split(/[\\/]/).includes("..")) {
    throw new Error(`TAVO_AGENT_ADAPTER_${index === 0 ? "A" : "B"} must be a repository-relative module path.`);
  }
  const absolute = path.resolve(root, adapter);
  if (!absolute.startsWith(`${root}${path.sep}`) || !fs.statSync(absolute).isFile()) {
    throw new Error(`Configured live adapter does not exist: ${adapter}.`);
  }
}
if (adapters[0] === adapters[1]) throw new Error("Live evaluation requires two distinct adapter modules.");
console.log("Two distinct live evaluation adapters are configured.");
