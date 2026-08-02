export type Position = { line: number; column: number };

export type ChangeOperation =
  | { id: string; kind: "generate"; spec: unknown }
  | { id: string; kind: "create-file"; file: string; content: string }
  | {
    id: string;
    kind: "replace-range";
    file: string;
    expectedSha256: string;
    range: { start: Position; end: Position };
    text: string;
  }
  | { id: string; kind: "delete-file"; file: string; expectedSha256: string }
  | {
    id: string;
    kind: "apply-fix";
    diagnosticCode: string;
    file: string;
    expectedSha256?: string;
    expectedMissing?: true;
  };

export type ChangePlan = {
  schemaVersion: 1;
  operations: ChangeOperation[];
};

export type ChangeReceipt = {
  schemaVersion: 1;
  dryRun: boolean;
  transaction: "planned" | "committed" | "rolled-back" | "rejected";
  fileHashes: Record<string, string | null>;
  operations: Array<{
    id: string;
    kind: string;
    status: "planned" | "applied";
  }>;
  verificationCommand: string;
};

export class ChangeTransactionError extends Error {
  constructor(message: string, readonly receipt: ChangeReceipt) {
    super(message);
    this.name = "ChangeTransactionError";
  }
}

export const MAX_CHANGE_OPERATIONS = 100;
export const MAX_CHANGE_TEXT_BYTES = 1024 * 1024;
