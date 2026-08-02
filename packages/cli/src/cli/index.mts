import path from "node:path";
import fs from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parseCliArgs } from "./args.mjs";
import { BUILD_DIR } from "./constants.mjs";
import {
  buildWithRouteReport,
  isSsrPreviewBuildStale,
} from "./commands/build.mjs";
import { changeFromJsonFile, changeFromStdin } from "./commands/change.mjs";
import {
  createApp,
  generateComponent,
  generateFromJsonFile,
  generateFromStdin,
  generateLayout,
  generateNotFoundPage,
  generateErrorPage,
  generateActionPage,
  printGeneratorSpecValidation,
  generatePage,
  generateStore,
} from "./commands/generate.mjs";
import {
  checkProject,
  printAgentContext,
  printDoctor,
  printInventory,
  printPluginInspection,
  printProjectInfo,
  printRoutes,
  printTargetInspection,
  verifyProject,
} from "./commands/inspect.mjs";
import { monitorServer } from "./commands/monitor.mjs";
import { printHelp } from "./help.mjs";
import { promptForProjectName } from "./prompt.mjs";
import { runNodeFile, runPackageBin } from "./process.mjs";
import { fileExists } from "./utils/fs.mjs";

type CliRunOptions = {
  version?: string;
  cwd?: string;
  promptProjectName?: () => Promise<string | null>;
};

function resolveHostFlag(
  flags: Record<string, string | boolean>,
): string | undefined {
  if (flags.network === true) {
    return "0.0.0.0";
  }
  if (typeof flags.host === "string" && flags.host.length > 0) {
    return flags.host;
  }
  if (flags.host === true) {
    return "0.0.0.0";
  }
  return undefined;
}

function createServerRunOptions(flags: Record<string, string | boolean>) {
  const host = resolveHostFlag(flags);
  if (!host) {
    return {};
  }
  return {
    env: { HOST: host },
    extraArgs: ["--", "--host", host],
  };
}

async function fileExistsAt(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function findPackageRoot(
  rootDir: string,
  packageName: string,
): Promise<string | null> {
  let current = path.resolve(rootDir);
  while (true) {
    const candidate = path.join(
      current,
      "node_modules",
      ...packageName.split("/"),
    );
    if (await fileExistsAt(path.join(candidate, "package.json"))) {
      return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

async function resolvePackageImport(
  rootDir: string,
  packageName: string,
  exportName: string,
): Promise<string | null> {
  const packageRoot = await findPackageRoot(rootDir, packageName);
  if (!packageRoot) {
    return null;
  }

  const packageJson = JSON.parse(
    await fs.readFile(path.join(packageRoot, "package.json"), "utf8"),
  ) as {
    exports?: Record<string, string | { import?: string }>;
  };
  const entry = packageJson.exports?.[exportName];
  const importPath = typeof entry === "string" ? entry : entry?.import;
  return importPath ? path.join(packageRoot, importPath) : null;
}

async function startSsrDevServer(
  rootDir: string,
  flags: Record<string, string | boolean>,
): Promise<void> {
  const ssrModulePath = await resolvePackageImport(
    rootDir,
    "@tavojs/core",
    "./dev",
  );
  if (!ssrModulePath) {
    throw new Error(
      "tavo CLI: @tavojs/core/dev is required to run the SSR dev server.",
    );
  }

  const ssrModule = (await import(pathToFileURL(ssrModulePath).href)) as {
    startViteAutoPagesDevServer?: (options?: {
      port?: number;
      host?: string;
      root?: string;
    }) => Promise<{ url: string; close(): Promise<void> }>;
  };
  if (typeof ssrModule.startViteAutoPagesDevServer !== "function") {
    throw new Error(
      "tavo CLI: @tavojs/core/dev does not export startViteAutoPagesDevServer.",
    );
  }

  const server = await ssrModule.startViteAutoPagesDevServer({
    port: Number(process.env.PORT || 4174),
    host: resolveHostFlag(flags),
    root: rootDir,
  });
  console.log(`[tavo dev:ssr] running at ${server.url}`);
}

export async function runCli(
  argv: string[],
  {
    version = "0.0.0",
    cwd = process.cwd(),
    promptProjectName = promptForProjectName,
  }: CliRunOptions = {},
): Promise<void> {
  const previousCwd = process.cwd();
  if (cwd !== previousCwd) {
    process.chdir(cwd);
  }

  try {
    const { positionals, flags } = parseCliArgs(argv);
    const [command, target, arg] = positionals;

    if (flags.version) {
      console.log(version);
      return;
    }

    if (flags.help || command === "help" || !command) {
      printHelp(version);
      process.exitCode = flags.help || command === "help" ? 0 : 1;
      return;
    }

    if (command === "create" && target === "app") {
      const projectName = arg ?? (await promptProjectName());
      if (!projectName) {
        console.log("Project creation cancelled.");
        return;
      }
      await createApp(projectName, {
        force: Boolean(flags.force),
        packageManager:
          typeof flags["package-manager"] === "string"
            ? flags["package-manager"]
            : undefined,
      });
      return;
    }

    if (command === "dev") {
      const serverOptions = createServerRunOptions(flags);
      if (flags.ssr) {
        await startSsrDevServer(process.cwd(), flags);
        return;
      }
      await runPackageBin("vite", {
        env: serverOptions.env,
        extraArgs: serverOptions.extraArgs?.slice(1),
      });
      return;
    }

    if (command === "build") {
      await buildWithRouteReport(flags);
      return;
    }

    if (command === "preview") {
      if (flags.ssr) {
        if (await isSsrPreviewBuildStale(process.cwd())) {
          console.log(
            "[tavo preview:ssr] build missing or stale, running `tavo build` first...",
          );
          await buildWithRouteReport(flags);
        }
        const startFile = path.join(
          process.cwd(),
          BUILD_DIR,
          "server",
          "start.mjs",
        );
        if (!(await fileExists(startFile))) {
          throw new Error(
            "tavo CLI: SSR preview build not found. Run `tavo build` first.",
          );
        }
        await runNodeFile(startFile, {
          env: createServerRunOptions(flags).env,
        });
        return;
      }
      const serverOptions = createServerRunOptions(flags);
      await runPackageBin("vite", {
        env: serverOptions.env,
        extraArgs: ["preview", ...(serverOptions.extraArgs?.slice(1) ?? [])],
      });
      return;
    }

    if (command === "monitor") {
      await monitorServer(flags);
      return;
    }

    if (command === "routes") {
      await printRoutes(flags);
      return;
    }

    if (command === "info") {
      await printProjectInfo(flags);
      return;
    }

    if (command === "inventory") {
      await printInventory(flags);
      return;
    }

    if (command === "doctor") {
      await printDoctor(flags);
      return;
    }

    if (command === "agent-context") {
      await printAgentContext(flags);
      return;
    }

    if (command === "inspect") {
      if (target === "plugins" && arg === undefined) {
        await printPluginInspection(flags);
        return;
      }
      await printTargetInspection(target, arg, flags);
      return;
    }

    if (command === "check") {
      await checkProject(flags);
      return;
    }

    if (command === "verify") {
      await verifyProject(flags);
      return;
    }

    if (command === "change" && typeof flags["from-json"] === "string") {
      await changeFromJsonFile(flags["from-json"], {
        dryRun: Boolean(flags["dry-run"]),
      });
      return;
    }

    if (command === "change" && flags["from-stdin"]) {
      await changeFromStdin({ dryRun: Boolean(flags["dry-run"]) });
      return;
    }

    if (command === "generate" && typeof flags["from-json"] === "string") {
      await generateFromJsonFile(flags["from-json"], {
        force: Boolean(flags.force),
        dryRun: Boolean(flags["dry-run"]),
      });
      return;
    }

    if (command === "generate" && typeof flags["validate-spec"] === "string") {
      await printGeneratorSpecValidation(flags["validate-spec"]);
      return;
    }

    if (command === "generate" && flags["from-stdin"]) {
      await generateFromStdin({
        force: Boolean(flags.force),
        dryRun: Boolean(flags["dry-run"]),
      });
      return;
    }

    if (command === "generate" && target === "page" && arg) {
      await generatePage(arg, {
        force: Boolean(flags.force),
        loader: Boolean(flags.loader),
        seo: Boolean(flags.seo),
        typedRoute: Boolean(flags["typed-route"]),
      });
      return;
    }

    if (command === "generate" && target === "component" && arg) {
      await generateComponent(arg, {
        force: Boolean(flags.force),
        props: Boolean(flags.props),
      });
      return;
    }

    if (command === "generate" && target === "store" && arg) {
      await generateStore(arg, {
        force: Boolean(flags.force),
        shape: typeof flags.shape === "string" ? flags.shape : undefined,
      });
      return;
    }

    if (command === "generate" && target === "layout" && arg !== undefined) {
      await generateLayout(arg, { force: Boolean(flags.force) });
      return;
    }

    if (command === "generate" && target === "404") {
      await generateNotFoundPage({ force: Boolean(flags.force) });
      return;
    }

    if (command === "generate" && target === "error") {
      await generateErrorPage({ force: Boolean(flags.force) });
      return;
    }

    if (command === "generate" && target === "action" && arg) {
      await generateActionPage(arg, { force: Boolean(flags.force) });
      return;
    }

    printHelp(version);
    throw new Error(`tavo CLI: unknown command "${positionals.join(" ")}".`);
  } finally {
    if (cwd !== previousCwd) {
      process.chdir(previousCwd);
    }
  }
}
