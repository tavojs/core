import {
  MAX_CHANGE_OPERATIONS,
  MAX_CHANGE_TEXT_BYTES,
  type ChangeOperation,
  type ChangePlan
} from "./types.mjs";

const OPERATION_KINDS: ChangeOperation["kind"][] = [
  "generate",
  "create-file",
  "replace-range",
  "delete-file",
  "apply-fix"
];

const ALLOWED_KEYS: Record<ChangeOperation["kind"], string[]> = {
  "generate": ["id", "kind", "spec"],
  "create-file": ["id", "kind", "file", "content"],
  "replace-range": ["id", "kind", "file", "expectedSha256", "range", "text"],
  "delete-file": ["id", "kind", "file", "expectedSha256"],
  "apply-fix": [
    "id",
    "kind",
    "diagnosticCode",
    "file",
    "expectedSha256",
    "expectedMissing"
  ]
};

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function assertOperationShape(
  operation: Record<string, unknown>,
  index: number,
  ids: Set<string>
): ChangeOperation["kind"] {
  if (typeof operation.id !== "string" || !operation.id) {
    throw new Error(`Operation ${index} requires an id.`);
  }
  if (ids.has(operation.id)) {
    throw new Error(`Duplicate operation id: ${operation.id}.`);
  }
  ids.add(operation.id);
  if (!OPERATION_KINDS.includes(operation.kind as ChangeOperation["kind"])) {
    throw new Error(`Unsupported operation kind: ${String(operation.kind)}.`);
  }

  const kind = operation.kind as ChangeOperation["kind"];
  const unexpected = Object.keys(operation).find((key) => !ALLOWED_KEYS[kind].includes(key));
  if (unexpected) {
    throw new Error(`Operation ${operation.id} has unsupported property ${unexpected}.`);
  }
  return kind;
}

function assertFileOperation(
  operation: Record<string, unknown>,
  kind: Exclude<ChangeOperation["kind"], "generate">
): void {
  if (typeof operation.file !== "string") {
    throw new Error(`Operation ${operation.id} requires file.`);
  }
  if (kind === "create-file") {
    if (typeof operation.content !== "string") {
      throw new Error(`Operation ${operation.id} requires content.`);
    }
    if (Buffer.byteLength(operation.content) > MAX_CHANGE_TEXT_BYTES) {
      throw new Error(
        `Operation ${operation.id} content exceeds ${MAX_CHANGE_TEXT_BYTES} bytes.`
      );
    }
  }
  if (kind === "replace-range" || kind === "delete-file") {
    if (!isSha256(operation.expectedSha256)) {
      throw new Error(
        `Operation ${operation.id} requires a lowercase SHA-256 precondition.`
      );
    }
  }
  if (kind === "replace-range") {
    const hasRange = operation.range
      && typeof operation.range === "object"
      && !Array.isArray(operation.range);
    if (typeof operation.text !== "string" || !hasRange) {
      throw new Error(`Operation ${operation.id} requires range and text.`);
    }
    if (Buffer.byteLength(operation.text) > MAX_CHANGE_TEXT_BYTES) {
      throw new Error(
        `Operation ${operation.id} text exceeds ${MAX_CHANGE_TEXT_BYTES} bytes.`
      );
    }
  }
  if (kind === "apply-fix") assertApplyFix(operation);
}

function assertApplyFix(operation: Record<string, unknown>): void {
  if (typeof operation.diagnosticCode !== "string") {
    throw new Error(`Operation ${operation.id} requires diagnosticCode.`);
  }
  const validHash = isSha256(operation.expectedSha256);
  if (!validHash && operation.expectedMissing !== true) {
    throw new Error(
      `Operation ${operation.id} requires expectedSha256 or expectedMissing.`
    );
  }
  if (validHash && operation.expectedMissing === true) {
    throw new Error(
      `Operation ${operation.id} cannot combine expectedSha256 and expectedMissing.`
    );
  }
}

export function validatePlan(raw: unknown): ChangePlan {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Change plan must be an object.");
  }
  const plan = raw as { schemaVersion?: unknown; operations?: unknown };
  if (plan.schemaVersion !== 1) {
    throw new Error("Change plan schemaVersion must be 1.");
  }
  if (!Array.isArray(plan.operations) || plan.operations.length === 0) {
    throw new Error("Change plan operations must be a non-empty array.");
  }
  if (plan.operations.length > MAX_CHANGE_OPERATIONS) {
    throw new Error(
      `Change plans support at most ${MAX_CHANGE_OPERATIONS} operations.`
    );
  }

  const ids = new Set<string>();
  for (const [index, value] of plan.operations.entries()) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error(`Operation ${index} must be an object.`);
    }
    const operation = value as Record<string, unknown>;
    const kind = assertOperationShape(operation, index, ids);
    if (kind === "generate") {
      if (!("spec" in operation)) {
        throw new Error(`Operation ${operation.id} requires spec.`);
      }
    } else {
      assertFileOperation(operation, kind);
    }
  }
  return raw as ChangePlan;
}
