import fs from "node:fs/promises";
import path from "node:path";
import { generateFromSpec } from "../generate.mjs";
import { applyFix } from "../../inspect/fixes.mjs";
import { prepareChange, type PreparedChange } from "./preflight.mjs";
import {
  assertNoSymlinkEscape,
  assertSafeFile,
  offsetAt,
  readExisting,
  sha256
} from "./safety.mjs";
import {
  ChangeTransactionError,
  type ChangeOperation,
  type ChangeReceipt
} from "./types.mjs";

async function withMutedLogs<T>(callback: () => Promise<T>): Promise<T> {
  const original = console.log;
  console.log = () => undefined;
  try {
    return await callback();
  } finally {
    console.log = original;
  }
}

function snapshotHashes(prepared: PreparedChange): Record<string, string | null> {
  const entries = Array.from(
    prepared.targets,
    ([absolute, file]): readonly [string, string | null] => {
      const source = prepared.snapshots.get(absolute);
      return [file, source === null ? null : sha256(source!)];
    }
  );
  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return Object.fromEntries(entries);
}

async function currentHashes(prepared: PreparedChange): Promise<Record<string, string | null>> {
  const entries = await Promise.all(Array.from(
    prepared.targets,
    async ([absolute, file]) => {
      const source = await readExisting(absolute);
      return [file, source === null ? null : sha256(source)] as const;
    }
  ));
  entries.sort((left, right) => left[0].localeCompare(right[0]));
  return Object.fromEntries(entries);
}

function plannedOperations(prepared: PreparedChange): ChangeReceipt["operations"] {
  return prepared.plan.operations.map((operation) => ({
    id: operation.id,
    kind: operation.kind,
    status: "planned"
  }));
}

function assertHashUnchanged(
  operation: { file: string; expectedSha256: string },
  source: string | null
): string {
  if (source === null || sha256(source) !== operation.expectedSha256) {
    throw new Error(
      `Stale change plan for ${operation.file}: SHA-256 precondition changed during execution.`
    );
  }
  return source;
}

async function applyFileOperation(
  rootDir: string,
  operation: Exclude<ChangeOperation, { kind: "generate" }>,
  prepared: PreparedChange
): Promise<void> {
  const absolute = assertSafeFile(rootDir, operation.file);
  await assertNoSymlinkEscape(rootDir, absolute);
  if (operation.kind === "create-file") {
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, operation.content, { encoding: "utf8", flag: "wx" });
    return;
  }

  const current = await readExisting(absolute);
  if (operation.kind === "replace-range") {
    const source = assertHashUnchanged(operation, current);
    const start = offsetAt(source, operation.range.start);
    const end = offsetAt(source, operation.range.end);
    const nextSource = `${source.slice(0, start)}${operation.text}${source.slice(end)}`;
    await fs.writeFile(absolute, nextSource, "utf8");
    return;
  }
  if (operation.kind === "delete-file") {
    assertHashUnchanged(operation, current);
    await fs.unlink(absolute);
    return;
  }

  if (operation.expectedMissing === true) {
    if (current !== null) {
      throw new Error(
        `Stale change plan for ${operation.file}: expected the target to remain missing.`
      );
    }
  } else {
    assertHashUnchanged({
      file: operation.file,
      expectedSha256: operation.expectedSha256!
    }, current);
  }
  const result = await applyFix(rootDir, prepared.fixes.get(operation.id)!);
  if (!result.applied) {
    throw new Error(
      `Safe fix ${operation.diagnosticCode} was not applied: ${result.reason ?? "unknown"}.`
    );
  }
}

function appliedTargets(
  rootDir: string,
  prepared: PreparedChange,
  operations: ChangeReceipt["operations"]
): Set<string> {
  const touched = new Set<string>();
  for (const operation of operations.filter((item) => item.status === "applied")) {
    if (operation.kind === "generate") {
      for (const target of prepared.generatorTargets.get(operation.id) ?? []) {
        touched.add(target);
      }
      continue;
    }
    const sourceOperation = prepared.plan.operations.find(
      (item) => item.id === operation.id
    );
    if (sourceOperation && sourceOperation.kind !== "generate") {
      touched.add(assertSafeFile(rootDir, sourceOperation.file));
    }
  }
  return touched;
}

async function rollback(
  rootDir: string,
  prepared: PreparedChange,
  operations: ChangeReceipt["operations"]
): Promise<void> {
  for (const target of appliedTargets(rootDir, prepared, operations)) {
    const source = prepared.snapshots.get(target) ?? null;
    if (source === null) {
      await fs.unlink(target).catch(() => undefined);
    } else {
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, source, "utf8");
    }
  }
}

function receipt(
  prepared: PreparedChange,
  operations: ChangeReceipt["operations"],
  values: Pick<ChangeReceipt, "dryRun" | "transaction" | "fileHashes">
): ChangeReceipt {
  return {
    schemaVersion: 1,
    ...values,
    operations,
    verificationCommand: prepared.verificationCommand
  };
}

export async function executeChangePlan(
  raw: unknown,
  options?: { dryRun?: boolean }
): Promise<ChangeReceipt> {
  const rootDir = process.cwd();
  const prepared = await prepareChange(raw);
  const operations = plannedOperations(prepared);
  if (options?.dryRun) {
    return receipt(prepared, operations, {
      dryRun: true,
      transaction: "planned",
      fileHashes: snapshotHashes(prepared)
    });
  }

  try {
    for (const operation of prepared.plan.operations) {
      if (operation.kind === "generate") {
        await withMutedLogs(() => generateFromSpec(operation.spec));
      } else {
        await applyFileOperation(rootDir, operation, prepared);
      }
      operations.find((item) => item.id === operation.id)!.status = "applied";
    }
  } catch (error) {
    await rollback(rootDir, prepared, operations);
    throw new ChangeTransactionError(
      error instanceof Error ? error.message : String(error),
      receipt(prepared, operations, {
        dryRun: false,
        transaction: "rolled-back",
        fileHashes: snapshotHashes(prepared)
      })
    );
  }

  return receipt(prepared, operations, {
    dryRun: false,
    transaction: "committed",
    fileHashes: await currentHashes(prepared)
  });
}
