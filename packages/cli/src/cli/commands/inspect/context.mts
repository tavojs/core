import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { BUILD_DIR, GENERATED_DIR } from "../../constants.mjs";
import { enrichDiagnostic, inspectRouteFiles, isJson, printJson } from "../../inspect/helpers.mjs";
import { collectProjectDiagnostics } from "../../inspect/diagnostics.mjs";
import { collectProjectInventory } from "../../inspect/inventory.mjs";
import { collectPageRoutes } from "../../project/routes.mjs";
import type { CliFlags } from "../../types.mjs";
import {
  AGENT_API_CARDS,
  AGENT_CONTEXT_MAX_BYTES,
  AGENT_GENERATOR_RECIPES,
  AGENT_PROTOCOL_STABILITY,
  AGENT_PROTOCOL_VERSION,
  apiCardsForTask,
  isAgentTask,
  type AgentTask
} from "../../protocol/catalog.mjs";
import { createProtocolEnvelope } from "../../protocol/index.mjs";
import {
  getProjectInfoPayload,
  inspectInventoryTarget,
  readPackageJson,
  shellArgument
} from "./shared.mjs";

function selectedAgentTask(flags?: CliFlags): AgentTask | undefined {
  const value = flags?.task;
  if (value === undefined) return undefined;
  if (!isAgentTask(value)) {
    throw new Error(`tavo CLI: unsupported agent task "${String(value)}".`);
  }
  return value;
}

function recipesForTask(task: AgentTask | undefined) {
  return AGENT_GENERATOR_RECIPES.filter((recipe) => {
    if (!task) return ["page", "component", "store"].includes(recipe.id);
    if (task.includes("route") || task === "add-loader") {
      return ["page", "loader-page", "feature"].includes(recipe.id);
    }
    if (task === "add-action") return ["action", "feature"].includes(recipe.id);
    if (task.includes("component") || task === "style-ui") {
      return recipe.id === "component";
    }
    if (task === "modify-store") return recipe.id === "store";
    return true;
  });
}

export async function getAgentContextPayload(rootDir: string, flags?: CliFlags) {
  const info = await getProjectInfoPayload(rootDir);
  const routes = await collectPageRoutes(rootDir, info.pagesDir);
  const diagnostics = await collectProjectDiagnostics(rootDir);
  const inventory = await collectProjectInventory(rootDir);
  const pkg = await readPackageJson(rootDir);
  const task = selectedAgentTask(flags);
  const target = typeof flags?.target === "string" ? flags.target : undefined;
  const focus = await inspectInventoryTarget(rootDir, inventory, undefined, target);

  if (flags?.detail !== undefined && flags.detail !== "summary" && flags.detail !== "full") {
    throw new Error('tavo CLI: agent context detail must be "summary" or "full".');
  }
  const detail = flags?.detail === "full" ? "full" : "summary";
  const compact = {
    framework: "tavo",
    protocolVersion: AGENT_PROTOCOL_VERSION,
    protocolStability: AGENT_PROTOCOL_STABILITY,
    task: task ?? null,
    target: target ?? null,
    detail,
    project: {
      name: typeof pkg?.name === "string" ? pkg.name : path.basename(rootDir),
      packageManager: info.packageManager,
      pagesDir: info.pagesDir,
      routeCount: routes.length,
      componentCount: inventory.components.length,
      storeCount: inventory.stores.length,
      hasSsrEntry: Boolean(info.ssrEntry)
    },
    conventions: {
      page: "functional-module",
      optionalTypedPage: "defineRoutePage",
      component: "createTavo",
      store: "defineGlobalStore",
      bootstrap: "bootTavo",
      doNotEdit: [GENERATED_DIR, BUILD_DIR]
    },
    focus,
    api: apiCardsForTask(task),
    recipes: recipesForTask(task),
    commands: {
      inspect: "tavo inspect <route|component|store|file|api> <target> --json",
      change: "tavo change --from-json <plan> --dry-run",
      verify: focus?.file
        ? `tavo verify --files ${shellArgument(focus.file)} --json`
        : "tavo verify --json"
    },
    ...(detail === "full"
      ? { routes: inspectRouteFiles(rootDir, routes), inventory, scripts: pkg?.scripts ?? {} }
      : {})
  };
  const files = Array.from(new Set([
    ...inventory.pages.map((item) => item.file),
    ...inventory.layouts.map((item) => item.file),
    ...inventory.components.map((item) => item.file),
    ...inventory.stores.map((item) => item.file)
  ])).sort();
  const fingerprintSource = await Promise.all(files.map(async (file) => {
    const stat = await fs.stat(path.join(rootDir, file)).catch(() => null);
    return [file, stat?.size ?? -1, stat?.mtimeMs ?? -1];
  }));
  const contextDiagnostics = [...diagnostics];
  if (target && !focus && task && !task.startsWith("create-")) {
    contextDiagnostics.push(enrichDiagnostic({
      code: "agent-target-not-found",
      level: "error",
      message: `Task ${task} requires an existing target, but ${target} was not found.`,
      suggestedFix: "Run `tavo inventory --json` or correct --target.",
      docs: "docs/agent-codegen.md"
    }));
  }
  return { compact, diagnostics: contextDiagnostics, fingerprintSource };
}

function reduceContext(
  compact: Awaited<ReturnType<typeof getAgentContextPayload>>["compact"]
) {
  const focus = compact.focus as Record<string, unknown> | null;
  return {
    ...compact,
    focus: focus ? {
      path: focus.path,
      file: focus.file,
      params: focus.params,
      layouts: Array.isArray(focus.layouts) ? focus.layouts.slice(0, 8) : undefined,
      exports: Array.isArray(focus.exports) ? focus.exports.slice(0, 16) : undefined,
      hasLoader: focus.hasLoader,
      hasAction: focus.hasAction,
      sha256: focus.sha256
    } : null,
    api: compact.api.slice(0, 2).map((card) => ({
      id: card.id,
      import: card.import,
      signature: card.signature,
      useWhen: card.useWhen,
      avoid: card.avoid,
      stability: card.stability
    })),
    recipes: compact.recipes.slice(0, 2)
  };
}

export async function printAgentContext(flags?: CliFlags): Promise<void> {
  const startedAt = performance.now();
  let context: Awaited<ReturnType<typeof getAgentContextPayload>>;
  try {
    context = await getAgentContextPayload(process.cwd(), flags);
  } catch (error) {
    if (!isJson(flags)) throw error;
    process.exitCode = 1;
    printJson(createProtocolEnvelope({
      command: "agent-context",
      data: null,
      diagnostics: [{
        code: "agent-context-invalid",
        level: "error",
        category: "spec",
        confidence: "high",
        safeToAutoFix: false,
        message: error instanceof Error ? error.message : String(error)
      }],
      ok: false,
      startedAt
    }));
    return;
  }

  const { compact, diagnostics, fingerprintSource } = context;
  let relevantDiagnostics = diagnostics
    .filter((diagnostic) => (
      !compact.focus
      || !diagnostic.file
      || diagnostic.file === compact.focus.file
    ))
    .slice(0, 10);
  let payload = createProtocolEnvelope({
    command: "agent-context",
    data: compact,
    diagnostics: relevantDiagnostics,
    fingerprintSource,
    nextActions: [{
      command: compact.commands.inspect,
      reason: "Fetch only the entity details needed for the task."
    }],
    startedAt
  });

  if (compact.detail === "summary" && payload.metrics.bytes > AGENT_CONTEXT_MAX_BYTES) {
    relevantDiagnostics = relevantDiagnostics.slice(0, 3);
    payload = createProtocolEnvelope({
      command: "agent-context",
      data: reduceContext(compact),
      diagnostics: relevantDiagnostics,
      fingerprintSource,
      nextActions: [{
        command: compact.commands.inspect,
        reason: "Fetch omitted entity details on demand."
      }],
      startedAt
    }) as typeof payload;

    if (payload.metrics.bytes > AGENT_CONTEXT_MAX_BYTES) {
      process.exitCode = 1;
      payload = createProtocolEnvelope({
        command: "agent-context",
        data: {
          framework: "tavo",
          protocolVersion: AGENT_PROTOCOL_VERSION,
          task: compact.task,
          target: compact.target
        },
        diagnostics: [{
          code: "agent-context-budget-exceeded",
          level: "error",
          category: "project-shape",
          confidence: "high",
          safeToAutoFix: false,
          message: `Minimal context exceeded ${AGENT_CONTEXT_MAX_BYTES} bytes.`
        }],
        ok: false,
        fingerprintSource,
        startedAt
      }) as typeof payload;
    }
  }

  if (isJson(flags)) {
    if (!payload.ok) process.exitCode = 1;
    printJson(payload);
    return;
  }
  console.log("Tavo agent context");
  console.log("");
  console.log(`Project:     ${payload.data.project.name}`);
  console.log(`Pages dir:   ${payload.data.project.pagesDir}`);
  console.log(`Routes:      ${payload.data.project.routeCount}`);
  console.log(`Diagnostics: ${payload.diagnostics.length}`);
  console.log("Use `tavo agent-context --json` for machine-readable output.");
}

export async function printTargetInspection(
  kind: string | undefined,
  target: string | undefined,
  flags?: CliFlags
): Promise<void> {
  if (!kind || !target) {
    if (!isJson(flags)) throw new Error("tavo CLI: inspect requires a kind and target.");
    process.exitCode = 1;
    printJson(createProtocolEnvelope({
      command: "inspect",
      data: { kind: kind ?? null, target: target ?? null, entity: null },
      diagnostics: [{
        code: "inspect-target-required",
        level: "error",
        category: "spec",
        confidence: "high",
        safeToAutoFix: false,
        message: "Inspect requires a kind and target."
      }],
      ok: false
    }));
    return;
  }

  const startedAt = performance.now();
  const rootDir = process.cwd();
  const data = kind === "api"
    ? AGENT_API_CARDS.find((card) => card.id === target) ?? null
    : await inspectInventoryTarget(
      rootDir,
      await collectProjectInventory(rootDir),
      kind,
      target
    );
  const diagnostics = data ? [] : [{
    code: "inspect-target-not-found",
    level: "error",
    category: "project-shape",
    confidence: "high",
    safeToAutoFix: false,
    message: `No ${kind} matched ${target}.`
  }];
  const verifyTarget = data && "file" in data ? data.file : target;
  const payload = createProtocolEnvelope({
    command: "inspect",
    data: { kind, target, entity: data },
    diagnostics,
    fingerprintSource: data,
    nextActions: data ? [{
      command: `tavo verify --files ${shellArgument(verifyTarget)} --json`,
      reason: "Verify edits to this target."
    }] : [],
    startedAt
  });

  if (isJson(flags)) {
    if (!payload.ok) process.exitCode = 1;
    printJson(payload);
  } else if (data) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(`No ${kind} matched ${target}.`);
    process.exitCode = 1;
  }
}
