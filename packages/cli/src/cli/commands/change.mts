import fs from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { printJson } from "../inspect/helpers.mjs";
import { createProtocolEnvelope } from "../protocol/index.mjs";
import { executeChangePlan } from "./change/executor.mjs";
import { assertNoSymlinkEscape, assertSafeFile } from "./change/safety.mjs";
import { ChangeTransactionError, type ChangeReceipt } from "./change/types.mjs";

export { executeChangePlan } from "./change/executor.mjs";
export type { ChangeReceipt } from "./change/types.mjs";

type ChangeOptions = { dryRun?: boolean };

async function printChangeResult(raw: unknown, options?: ChangeOptions): Promise<void> {
  const startedAt = performance.now();
  try {
    const receipt = await executeChangePlan(raw, options);
    printJson(createProtocolEnvelope({
      command: "change",
      data: receipt,
      fingerprintSource: Object.keys(receipt.fileHashes),
      nextActions: [{
        command: receipt.verificationCommand,
        reason: "Verify the transaction output."
      }],
      startedAt
    }));
  } catch (error) {
    printChangeFailure(error, options, startedAt);
  }
}

function rejectedReceipt(options?: ChangeOptions): ChangeReceipt {
  return {
    schemaVersion: 1,
    dryRun: Boolean(options?.dryRun),
    transaction: "rejected",
    fileHashes: {},
    operations: [],
    verificationCommand: "tavo change --from-json <plan> --dry-run"
  };
}

function printChangeFailure(
  error: unknown,
  options?: ChangeOptions,
  startedAt = performance.now()
): void {
  process.exitCode = 1;
  const receipt = error instanceof ChangeTransactionError
    ? error.receipt
    : rejectedReceipt(options);
  printJson(createProtocolEnvelope({
    command: "change",
    data: receipt,
    diagnostics: [{
      code: "change-plan-rejected",
      level: "error",
      category: "spec",
      confidence: "high",
      safeToAutoFix: false,
      message: error instanceof Error ? error.message : String(error)
    }],
    ok: false,
    startedAt
  }));
}

export async function changeFromJsonFile(
  file: string,
  options?: ChangeOptions
): Promise<void> {
  const startedAt = performance.now();
  try {
    const planFile = assertSafeFile(process.cwd(), file);
    await assertNoSymlinkEscape(process.cwd(), planFile);
    const source = await fs.readFile(planFile, "utf8");
    await printChangeResult(JSON.parse(source), options);
  } catch (error) {
    printChangeFailure(error, options, startedAt);
  }
}

export async function changeFromStdin(options?: ChangeOptions): Promise<void> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  try {
    const source = Buffer.concat(chunks).toString("utf8");
    await printChangeResult(JSON.parse(source), options);
  } catch (error) {
    printChangeFailure(error, options);
  }
}
