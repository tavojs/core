import { execFile } from "node:child_process";
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const syncMode = process.argv[2] === "--sync";
const destinationArgument = process.argv[syncMode ? 3 : 2];

if (!destinationArgument) {
  console.error(
    syncMode
      ? "Usage: npm run sync:public -- /absolute/path/to/public-repository"
      : "Usage: npm run export:public -- /absolute/path/to/empty-directory",
  );
  process.exit(1);
}

const destination = path.resolve(destinationArgument);
const relativeDestination = path.relative(repositoryRoot, destination);

if (relativeDestination === "" || (!relativeDestination.startsWith("..") && !path.isAbsolute(relativeDestination))) {
  console.error("The public export destination must be outside the private repository.");
  process.exit(1);
}

const publicEntries = [
  ".changeset",
  ".github/ISSUE_TEMPLATE",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ".github/dependabot.yml",
  ".github/workflows",
  ".gitignore",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "SECURITY.md",
  "docs",
  "package-lock.json",
  "package.json",
  "packages",
  "playwright.config.ts",
  "preview",
  "scripts",
  "tests",
];

const ignoredNames = new Set([
  ".agents",
  ".codex",
  ".DS_Store",
  ".tavo",
  "agent-live.yml",
  "dist",
  "global-changelog",
  "handover",
  "node_modules",
  "npm-debug.log",
  "test-results",
]);

const sensitiveNames = new Set([
  ".env",
  ".npmrc",
  "id_ed25519",
  "id_rsa",
]);

const sensitiveExtensions = new Set([
  ".key",
  ".p12",
  ".pem",
  ".pfx",
]);

const secretPatterns = [
  ["npm token", /\bnpm_[A-Za-z0-9]{20,}\b/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/],
  ["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{20,}\b/],
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "literal npm authentication value",
    /\b(?:NPM_TOKEN|NODE_AUTH_TOKEN)\s*=\s*(?!\$\{\{|\$\{|<)[^\s"']+/,
  ],
  ["private repository remote", /github\.com[:/]tavojs\/core-private(?:\.git)?/i],
];

async function includePath(sourcePath) {
  const name = path.basename(sourcePath);
  const sourceStat = await lstat(sourcePath);

  if (sourceStat.isSymbolicLink()) {
    throw new Error(`Refusing to export symbolic link: ${sourcePath}`);
  }

  if (ignoredNames.has(name) || name.endsWith(".tgz")) {
    return false;
  }

  const isEnvironmentFile = name.startsWith(".env.") && name !== ".env.example";
  const isSensitiveKey = sensitiveExtensions.has(path.extname(name).toLowerCase());

  if (sensitiveNames.has(name) || isEnvironmentFile || isSensitiveKey) {
    throw new Error(`Refusing to export sensitive file: ${sourcePath}`);
  }

  return true;
}

async function copyPublicEntries(sourceRoot, targetRoot, replaceExisting = false) {
  for (const entry of publicEntries) {
    const source = path.join(sourceRoot, entry);
    const sourceStat = await stat(source).catch(() => undefined);

    if (!sourceStat) {
      throw new Error(`Required public entry is missing: ${entry}`);
    }

    const target = path.join(targetRoot, entry);

    if (replaceExisting) {
      await rm(target, { force: true, recursive: true });
    }

    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target, {
      recursive: sourceStat.isDirectory(),
      filter: sourceRoot === repositoryRoot ? includePath : undefined,
    });
  }
}

async function listFiles(root, current = root) {
  const files = [];

  for (const entry of await readdir(current, { withFileTypes: true })) {
    const entryPath = path.join(current, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, entryPath)));
    } else if (entry.isFile()) {
      files.push(entryPath);
    } else {
      throw new Error(`Refusing unsupported export entry: ${entryPath}`);
    }
  }

  return files;
}

async function verifyStagedExport(stagingRoot) {
  for (const file of await listFiles(stagingRoot)) {
    const fileStat = await stat(file);

    if (fileStat.size > 2_000_000) {
      continue;
    }

    const contents = await readFile(file);

    if (contents.includes(0)) {
      continue;
    }

    const text = contents.toString("utf8");

    for (const [label, pattern] of secretPatterns) {
      if (pattern.test(text)) {
        throw new Error(`Refusing export: ${label} found in ${path.relative(stagingRoot, file)}`);
      }
    }
  }
}

function normalizeGitHubRemote(remote) {
  return remote
    .trim()
    .replace(/^git@github\.com:/, "https://github.com/")
    .replace(/^ssh:\/\/git@github\.com\//, "https://github.com/")
    .replace(/\.git$/, "")
    .toLowerCase();
}

async function verifyPublicWorkingTree() {
  if (!(await stat(path.join(destination, ".git")).catch(() => undefined))) {
    throw new Error(`Sync destination is not a Git working tree: ${destination}`);
  }

  const [{ stdout: status }, { stdout: remote }, { stdout: branch }] = await Promise.all([
    execFileAsync("git", ["-C", destination, "status", "--porcelain"]),
    execFileAsync("git", ["-C", destination, "remote", "get-url", "origin"]),
    execFileAsync("git", ["-C", destination, "branch", "--show-current"]),
  ]);

  if (status.trim()) {
    throw new Error("Refusing to sync into a public repository with uncommitted changes.");
  }

  if (normalizeGitHubRemote(remote) !== "https://github.com/tavojs/core") {
    throw new Error(`Refusing unexpected public repository remote: ${remote.trim()}`);
  }

  if (!branch.trim() || ["main", "master"].includes(branch.trim())) {
    throw new Error("Create and switch to a public sync branch before running this command.");
  }
}

const stagingRoot = await mkdtemp(path.join(tmpdir(), "tavo-public-export-"));

try {
  await copyPublicEntries(repositoryRoot, stagingRoot);
  await verifyStagedExport(stagingRoot);

  if (syncMode) {
    await verifyPublicWorkingTree();
    await copyPublicEntries(stagingRoot, destination, true);
    console.log(`Synced reviewed public source into ${destination}`);
  } else {
    await mkdir(destination, { recursive: true });

    if ((await readdir(destination)).length > 0) {
      throw new Error(`Refusing to overwrite non-empty directory: ${destination}`);
    }

    await copyPublicEntries(stagingRoot, destination);
    console.log(`Exported reviewed public source to ${destination}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await rm(stagingRoot, { force: true, recursive: true });
}
