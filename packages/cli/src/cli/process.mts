import { detectPackageManager, ensureProjectPackage } from "./project/config.mjs";

type ProcessRunOptions = {
  cwd?: string;
  packageManager?: string;
  extraArgs?: string[];
  env?: Record<string, string | undefined>;
};

export async function runPackageScript(script: string, options: ProcessRunOptions = {}): Promise<void> {
  const { spawn } = await import("node:child_process");
  const rootDir = options.cwd ?? process.cwd();
  await ensureProjectPackage(rootDir);
  const packageManager = options.packageManager ?? await detectPackageManager(rootDir);
  const args = packageManager === "yarn" ? ["run", script] : ["run", script];
  if (options.extraArgs?.length) {
    args.push(...options.extraArgs);
  }
  const child = spawn(packageManager, args, {
    cwd: rootDir,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${packageManager} run ${script} exited with code ${code}`));
    });
  });
}

function packageBinArgs(packageManager: string, bin: string, args: string[]): string[] {
  if (packageManager === "npm") {
    return ["exec", "--", bin, ...args];
  }
  if (packageManager === "pnpm") {
    return ["exec", bin, ...args];
  }
  if (packageManager === "bun") {
    return ["x", bin, ...args];
  }
  return [bin, ...args];
}

export async function runPackageBin(bin: string, options: ProcessRunOptions = {}): Promise<void> {
  const { spawn } = await import("node:child_process");
  const rootDir = options.cwd ?? process.cwd();
  await ensureProjectPackage(rootDir);
  const packageManager = options.packageManager ?? await detectPackageManager(rootDir);
  const args = packageBinArgs(packageManager, bin, options.extraArgs ?? []);
  const child = spawn(packageManager, args, {
    cwd: rootDir,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${packageManager} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

export async function runNodeFile(filePath: string, options: ProcessRunOptions = {}): Promise<void> {
  const { spawn } = await import("node:child_process");
  const child = spawn("node", [filePath, ...(options.extraArgs ?? [])], {
    cwd: options.cwd ?? process.cwd(),
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "inherit",
    shell: process.platform === "win32"
  });
  await new Promise<void>((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`node ${filePath} exited with code ${code}`));
    });
  });
}
