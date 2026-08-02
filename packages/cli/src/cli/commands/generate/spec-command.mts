import fs from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import {
  normalizeSpec,
  validateGeneratorSpecInput,
  type GeneratorSpecDiagnostic
} from "../../generate/spec.mjs";
import {
  resolveNamedFolderTarget,
  resolvePageTarget
} from "../../generate/targets.mjs";
import { printJson } from "../../inspect/helpers.mjs";
import { readPagesDirFromConfig } from "../../project/config.mjs";
import { createProtocolEnvelope } from "../../protocol/index.mjs";
import type { GeneratorOptions } from "../../types.mjs";
import { normalizeGeneratorName } from "../../utils/path.mjs";
import {
  generateActionPage,
  generateComponent,
  generateErrorPage,
  generateLayout,
  generateNotFoundPage,
  generatePage,
  generateStore
} from "./resources.mjs";

type NormalizedSpecs = ReturnType<typeof normalizeSpec>;
type NormalizedSpec = NormalizedSpecs[number];

export function validateGeneratorSpec(raw: unknown): GeneratorSpecDiagnostic[] {
  return validateGeneratorSpecInput(raw);
}

export async function validateGeneratorSpecFile(
  filePath: string
): Promise<GeneratorSpecDiagnostic[]> {
  try {
    const source = await fs.readFile(path.resolve(process.cwd(), filePath), "utf8");
    return validateGeneratorSpecInput(JSON.parse(source));
  } catch (error) {
    return [{
      code: "invalid-spec-json",
      level: "error",
      message: error instanceof Error ? error.message : String(error),
      path: "$"
    }];
  }
}

export async function printGeneratorSpecValidation(
  filePath: string
): Promise<GeneratorSpecDiagnostic[]> {
  const startedAt = performance.now();
  const diagnostics = await validateGeneratorSpecFile(filePath);
  const fingerprintSource = await fs
    .readFile(path.resolve(process.cwd(), filePath), "utf8")
    .catch(() => filePath);
  printJson(createProtocolEnvelope({
    command: "generate-validate",
    data: { file: filePath },
    diagnostics,
    ok: diagnostics.length === 0,
    fingerprintSource,
    startedAt
  }));
  if (diagnostics.length > 0) process.exitCode = 1;
  return diagnostics;
}

function expandFeatureSpec(spec: NormalizedSpec): NormalizedSpecs {
  if (spec.kind !== "feature") return [spec];
  const parts = spec.parts ?? ["page", "component", "store", "action"];
  return parts.map((part) => {
    if (part === "page") {
      return {
        kind: "page",
        name: `${spec.name}/index`,
        loader: spec.loader,
        seo: spec.seo,
        typedRoute: spec.typedRoute,
        force: spec.force
      } as const;
    }
    if (part === "component") {
      return {
        kind: "component",
        name: spec.name,
        props: spec.props,
        force: spec.force
      } as const;
    }
    if (part === "store") {
      return {
        kind: "store",
        name: spec.name,
        shape: spec.shape,
        force: spec.force
      } as const;
    }
    if (part === "layout") {
      return { kind: "layout", name: spec.name, force: spec.force } as const;
    }
    return {
      kind: "action",
      name: `${spec.name}/action`,
      force: spec.force
    } as const;
  }) as NormalizedSpecs;
}

function expandFeatureSpecs(specs: NormalizedSpecs): NormalizedSpecs {
  return specs.flatMap(expandFeatureSpec) as NormalizedSpecs;
}

async function generatorTarget(spec: NormalizedSpec): Promise<string> {
  const rootDir = process.cwd();
  const pagesDir = path.resolve(rootDir, await readPagesDirFromConfig(rootDir));
  if (spec.kind === "page" || spec.kind === "action") {
    return resolvePageTarget(pagesDir, spec.name).target;
  }
  if (spec.kind === "component") {
    return resolveNamedFolderTarget(
      path.resolve(rootDir, "src/components"),
      spec.name,
      "index.tsx"
    ).target;
  }
  if (spec.kind === "store") {
    return path.join(rootDir, "src/store", `${normalizeGeneratorName(spec.name)}.ts`);
  }
  if (spec.kind === "layout") {
    const normalized = normalizeGeneratorName(spec.name ?? "");
    return path.join(
      pagesDir,
      ...(normalized ? normalized.split("/") : []),
      "_layout.tsx"
    );
  }
  if (spec.kind === "404") return path.join(pagesDir, "404.tsx");
  if (spec.kind === "error") return path.join(pagesDir, "_error.tsx");
  throw new Error("tavo CLI: feature specs must be expanded before planning.");
}

export type GeneratorPlan = {
  specs: NormalizedSpecs;
  targets: string[];
  files: Array<{
    kind: string;
    target: string;
    operation: "create" | "replace";
  }>;
};

export async function planGeneratorSpec(
  raw: unknown,
  options: GeneratorOptions = {}
): Promise<GeneratorPlan> {
  const diagnostics = validateGeneratorSpecInput(raw);
  if (diagnostics.length > 0) {
    const message = diagnostics
      .map((diagnostic) => `${diagnostic.path} ${diagnostic.message}`)
      .join("; ");
    throw new Error(`tavo CLI: invalid generator spec: ${message}`);
  }
  const specs = expandFeatureSpecs(normalizeSpec(raw));
  const targets = await Promise.all(specs.map(generatorTarget));
  const duplicate = targets.find((target, index) => targets.indexOf(target) !== index);
  if (duplicate) {
    throw new Error(
      `tavo CLI: generator spec writes the same target more than once: ${duplicate}`
    );
  }

  const snapshots = new Map<string, string | null>();
  for (let index = 0; index < specs.length; index += 1) {
    const target = targets[index]!;
    const existing = await fs.readFile(target, "utf8").catch(() => null);
    const force = Boolean(options.force || specs[index]!.force);
    if (existing !== null && !force) {
      throw new Error(`tavo CLI: file already exists: ${target}`);
    }
    snapshots.set(target, existing);
  }
  return {
    specs,
    targets,
    files: specs.map((spec, index) => ({
      kind: spec.kind,
      target: targets[index]!,
      operation: snapshots.get(targets[index]!) === null ? "create" : "replace"
    }))
  };
}

async function applyGeneratorSpec(spec: NormalizedSpec, force: boolean): Promise<void> {
  if (spec.kind === "page") {
    await generatePage(spec.name, {
      force,
      loader: Boolean(spec.loader),
      seo: Boolean(spec.seo),
      typedRoute: Boolean(spec.typedRoute)
    });
  } else if (spec.kind === "component") {
    await generateComponent(spec.name, { force, props: Boolean(spec.props) });
  } else if (spec.kind === "store") {
    const shape = Array.isArray(spec.shape) ? spec.shape.join(",") : spec.shape;
    await generateStore(spec.name, { force, shape });
  } else if (spec.kind === "layout") {
    await generateLayout(spec.name ?? "", { force });
  } else if (spec.kind === "404") {
    await generateNotFoundPage({ force });
  } else if (spec.kind === "error") {
    await generateErrorPage({ force });
  } else if (spec.kind === "action") {
    await generateActionPage(spec.name, { force });
  }
}

async function rollbackFiles(snapshots: Map<string, string | null>): Promise<void> {
  for (const [target, source] of snapshots) {
    if (source === null) {
      await fs.unlink(target).catch(() => undefined);
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, source, "utf8");
    }
  }
}

export async function generateFromSpec(
  raw: unknown,
  options: GeneratorOptions = {}
): Promise<void> {
  const startedAt = performance.now();
  const plan = await planGeneratorSpec(raw, options);
  const snapshots = new Map<string, string | null>();
  for (const target of plan.targets) {
    snapshots.set(target, await fs.readFile(target, "utf8").catch(() => null));
  }
  if (options.dryRun) {
    const files = plan.files.map((file) => ({
      ...file,
      target: path.relative(process.cwd(), file.target).replace(/\\/g, "/")
    }));
    printJson(createProtocolEnvelope({
      command: "generate",
      data: { dryRun: true, files },
      fingerprintSource: plan.files.map((file) => file.target),
      nextActions: [{
        command: "tavo generate --from-json <file>",
        reason: "Apply the validated generation plan."
      }],
      startedAt
    }));
    return;
  }

  try {
    for (const spec of plan.specs) {
      await applyGeneratorSpec(spec, Boolean(options.force || spec.force));
    }
  } catch (error) {
    await rollbackFiles(snapshots);
    throw error;
  }
}

export async function generateFromJsonFile(
  filePath: string,
  options: GeneratorOptions = {}
): Promise<void> {
  const source = await fs.readFile(path.resolve(process.cwd(), filePath), "utf8");
  await generateFromSpec(JSON.parse(source), options);
}

export async function generateFromStdin(
  options: GeneratorOptions = {}
): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const source = Buffer.concat(chunks).toString("utf8");
  await generateFromSpec(JSON.parse(source), options);
}
