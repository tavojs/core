import { defineAction } from "./framework/define.js";
import type { ActionResult, PageAction, PageActionContext, PageActionOptions } from "./framework/types.js";

export type ValidationIssue = {
  message: string;
  path?: ReadonlyArray<PropertyKey>;
};

export type ValidationFailure = {
  ok: false;
  issues: ValidationIssue[];
};

export type ValidationSuccess<T> = {
  ok: true;
  value: T;
};

export type ValidationResult<T> = ValidationSuccess<T> | ValidationFailure;

export type StandardSchema<T> = {
  "~standard": {
    validate(value: unknown):
      | { value: T; issues?: undefined }
      | { value?: undefined; issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> }> }
      | Promise<
          | { value: T; issues?: undefined }
          | { value?: undefined; issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> }> }
        >;
  };
};

export type SafeParseSchema<T> = {
  safeParse?(value: unknown): unknown;
  safeParseAsync?(value: unknown): Promise<unknown>;
};

export type ParseSchema<T> = {
  parse?(value: unknown): T;
  parseAsync?(value: unknown): Promise<T>;
};

export type TavoSchema<T> = StandardSchema<T> | SafeParseSchema<T> | ParseSchema<T>;

function normalizePath(path: ReadonlyArray<PropertyKey | { key: PropertyKey }> | undefined): PropertyKey[] | undefined {
  return path?.map((entry) => typeof entry === "object" && entry !== null && "key" in entry ? entry.key : entry);
}

function normalizeIssues(value: unknown): ValidationIssue[] {
  const candidate = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const issues = Array.isArray(candidate.issues)
    ? candidate.issues
    : Array.isArray(candidate.errors)
      ? candidate.errors
      : [];
  if (issues.length === 0) {
    return [{ message: typeof candidate.message === "string" ? candidate.message : "Input validation failed." }];
  }
  return issues.map((issue) => {
    const entry = issue && typeof issue === "object" ? issue as Record<string, unknown> : {};
    return {
      message: typeof entry.message === "string" ? entry.message : "Invalid value.",
      path: Array.isArray(entry.path) ? normalizePath(entry.path as Array<PropertyKey | { key: PropertyKey }>) : undefined
    };
  });
}

/** Validates through Standard Schema or common safeParse/parse-compatible validators. */
export async function validateInput<T>(schema: TavoSchema<T>, input: unknown): Promise<ValidationResult<T>> {
  try {
    if ("~standard" in schema) {
      const result = await schema["~standard"].validate(input);
      if (result.issues) {
        return {
          ok: false,
          issues: result.issues.map((issue) => ({
            message: issue.message,
            path: normalizePath(issue.path)
          }))
        };
      }
      return { ok: true, value: result.value };
    }
    const safeSchema = schema as SafeParseSchema<T>;
    const safeResult = safeSchema.safeParseAsync
      ? await safeSchema.safeParseAsync(input)
      : safeSchema.safeParse?.(input);
    if (safeResult !== undefined) {
      const result = safeResult as { success?: boolean; data?: T; output?: T; error?: unknown; issues?: unknown };
      if (result.success === true) {
        return { ok: true, value: (result.data ?? result.output) as T };
      }
      return { ok: false, issues: normalizeIssues(result.error ?? result) };
    }
    const parseSchema = schema as ParseSchema<T>;
    const value = parseSchema.parseAsync
      ? await parseSchema.parseAsync(input)
      : parseSchema.parse?.(input);
    if (value === undefined && !parseSchema.parse && !parseSchema.parseAsync) {
      throw new TypeError("Unsupported validation schema.");
    }
    return { ok: true, value: value as T };
  } catch (error) {
    return { ok: false, issues: normalizeIssues(error) };
  }
}

async function readActionInput(request: Request): Promise<unknown> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    return request.json();
  }
  const form = await request.formData();
  const input: Record<string, FormDataEntryValue | FormDataEntryValue[]> = {};
  for (const [key, value] of form) {
    const existing = input[key];
    input[key] = existing === undefined ? value : Array.isArray(existing) ? [...existing, value] : [existing, value];
  }
  return input;
}

export type ValidatedActionContext<TInput> = PageActionContext & {
  input: TInput;
};

/** Defines a route action with portable schema validation and structured 400 failures. */
export function defineValidatedAction<TInput>(
  schema: TavoSchema<TInput>,
  handler: (context: ValidatedActionContext<TInput>) => Response | ActionResult | void | Promise<Response | ActionResult | void>,
  options?: PageActionOptions
): PageAction {
  return defineAction(async (context) => {
    const validation = await validateInput(schema, await readActionInput(context.request));
    if (!validation.ok) {
      return {
        status: 400,
        json: {
          error: "validation_failed",
          issues: validation.issues
        }
      };
    }
    return handler({ ...context, input: validation.value });
  }, options);
}
