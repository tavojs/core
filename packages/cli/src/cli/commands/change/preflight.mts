import path from "node:path";
import { planGeneratorSpec } from "../generate.mjs";
import { collectProjectDiagnostics } from "../../inspect/diagnostics.mjs";
import type { FixOperation } from "../../inspect/types.mjs";
import {
  assertNoSymlinkEscape,
  assertSafeFile,
  offsetAt,
  readExisting,
  sha256,
  shellArgument
} from "./safety.mjs";
import { MAX_CHANGE_OPERATIONS, type ChangePlan } from "./types.mjs";
import { validatePlan } from "./validation.mjs";

export type PreparedChange = {
  plan: ChangePlan;
  targets: Map<string, string>;
  generatorTargets: Map<string, string[]>;
  fixes: Map<string, FixOperation>;
  snapshots: Map<string, string | null>;
  verificationCommand: string;
};

function registerTarget(
  targets: Map<string, string>,
  absolute: string,
  relative: string
): void {
  if (targets.has(absolute)) {
    throw new Error(`More than one operation targets ${relative}.`);
  }
  targets.set(absolute, relative.replace(/\\/g, "/"));
}

async function prepareGenerator(
  rootDir: string,
  prepared: Pick<PreparedChange, "targets" | "generatorTargets">,
  operation: Extract<ChangePlan["operations"][number], { kind: "generate" }>
): Promise<void> {
  const generatorPlan = await planGeneratorSpec(operation.spec);
  if (prepared.targets.size + generatorPlan.targets.length > MAX_CHANGE_OPERATIONS) {
    throw new Error(
      `Expanded change plans support at most ${MAX_CHANGE_OPERATIONS} file targets.`
    );
  }
  prepared.generatorTargets.set(operation.id, generatorPlan.targets);
  for (const absolute of generatorPlan.targets) {
    await assertNoSymlinkEscape(rootDir, absolute);
    registerTarget(prepared.targets, absolute, path.relative(rootDir, absolute));
  }
}

async function prepareFileOperation(
  rootDir: string,
  prepared: Pick<PreparedChange, "targets" | "fixes">,
  operation: Exclude<ChangePlan["operations"][number], { kind: "generate" }>,
  diagnostics: Awaited<ReturnType<typeof collectProjectDiagnostics>>
): Promise<void> {
  const absolute = assertSafeFile(rootDir, operation.file);
  await assertNoSymlinkEscape(rootDir, absolute);
  registerTarget(prepared.targets, absolute, operation.file);
  const existing = await readExisting(absolute);

  if (operation.kind === "create-file") {
    if (existing !== null) {
      throw new Error(`Change target already exists: ${operation.file}.`);
    }
    return;
  }
  if (operation.kind === "apply-fix" && operation.expectedMissing === true) {
    if (existing !== null) {
      throw new Error(
        `Stale change plan for ${operation.file}: expected the target to be missing.`
      );
    }
  } else {
    if (existing === null) {
      throw new Error(`Change target does not exist: ${operation.file}.`);
    }
    if (sha256(existing) !== operation.expectedSha256) {
      throw new Error(
        `Stale change plan for ${operation.file}: SHA-256 precondition failed.`
      );
    }
  }

  if (operation.kind === "replace-range") {
    const start = offsetAt(existing!, operation.range.start);
    const end = offsetAt(existing!, operation.range.end);
    if (end < start) {
      throw new Error(`Invalid replacement range for ${operation.file}.`);
    }
  }
  if (operation.kind === "apply-fix") {
    const diagnostic = diagnostics.find((item) => (
      item.code === operation.diagnosticCode
      && item.file === operation.file
      && item.fix?.risk === "low"
    ));
    if (!diagnostic?.fix) {
      throw new Error(
        `No safe fix ${operation.diagnosticCode} exists for ${operation.file}.`
      );
    }
    if (operation.expectedMissing === true && diagnostic.fix.kind !== "create-file") {
      throw new Error(
        `Safe fix ${operation.diagnosticCode} does not create a missing file.`
      );
    }
    prepared.fixes.set(operation.id, diagnostic.fix);
  }
}

export async function prepareChange(raw: unknown): Promise<PreparedChange> {
  const rootDir = process.cwd();
  const plan = validatePlan(raw);
  const targets = new Map<string, string>();
  const generatorTargets = new Map<string, string[]>();
  const fixes = new Map<string, FixOperation>();
  const diagnostics = await collectProjectDiagnostics(rootDir);
  const partial = { targets, generatorTargets, fixes };

  for (const operation of plan.operations) {
    if (operation.kind === "generate") {
      await prepareGenerator(rootDir, partial, operation);
    } else {
      await prepareFileOperation(rootDir, partial, operation, diagnostics);
    }
  }

  const snapshots = new Map<string, string | null>();
  for (const target of targets.keys()) {
    snapshots.set(target, await readExisting(target));
  }
  const verificationFiles = Array.from(targets.values()).sort();
  return {
    plan,
    targets,
    generatorTargets,
    fixes,
    snapshots,
    verificationCommand: `tavo verify --files ${shellArgument(verificationFiles.join(","))} --json`
  };
}
