export type GeneratorSpec =
  | { kind: "page"; name: string; loader?: boolean; seo?: boolean; typedRoute?: boolean; force?: boolean }
  | { kind: "component"; name: string; props?: boolean; force?: boolean }
  | { kind: "store"; name: string; shape?: string[] | string; force?: boolean }
  | { kind: "layout"; name?: string; force?: boolean }
  | { kind: "404"; force?: boolean }
  | { kind: "error"; force?: boolean }
  | { kind: "action"; name: string; force?: boolean }
  | {
      kind: "feature";
      name: string;
      parts?: Array<"page" | "component" | "store" | "action" | "layout">;
      loader?: boolean;
      seo?: boolean;
      typedRoute?: boolean;
      props?: boolean;
      shape?: string[] | string;
      force?: boolean;
    };

export type GeneratorSpecDiagnostic = {
  code: string;
  level: "error";
  message: string;
  path: string;
};

const supportedKinds = ["page", "component", "store", "layout", "404", "error", "action", "feature"];
const namedKinds = ["page", "component", "store", "action", "feature"];
const featureParts = ["page", "component", "store", "action", "layout"];

export function normalizeSpec(raw: unknown): GeneratorSpec[] {
  const specs = Array.isArray(raw) ? raw : [raw];
  return specs.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw new Error(`tavo CLI: generator spec at index ${index} must be an object.`);
    }
    const spec = item as Record<string, unknown>;
    const kind = spec.kind;
    if (typeof kind !== "string") {
      throw new Error(`tavo CLI: generator spec at index ${index} is missing a string kind.`);
    }
    if (!supportedKinds.includes(kind)) {
      throw new Error(`tavo CLI: unsupported generator spec kind "${kind}".`);
    }
    if (namedKinds.includes(kind) && typeof spec.name !== "string") {
      throw new Error(`tavo CLI: generator spec kind "${kind}" requires a string name.`);
    }
    return {
      kind,
      name: typeof spec.name === "string" ? spec.name : undefined,
      loader: Boolean(spec.loader),
      seo: Boolean(spec.seo),
      typedRoute: Boolean(spec.typedRoute),
      props: Boolean(spec.props),
      shape: Array.isArray(spec.shape) ? spec.shape.map(String) : typeof spec.shape === "string" ? spec.shape : undefined,
      parts: Array.isArray(spec.parts) ? spec.parts.map(String) : undefined,
      force: Boolean(spec.force)
    } as GeneratorSpec;
  });
}

export function validateGeneratorSpecInput(raw: unknown): GeneratorSpecDiagnostic[] {
  const diagnostics: GeneratorSpecDiagnostic[] = [];
  const specs = Array.isArray(raw) ? raw : [raw];
  specs.forEach((item, index) => {
    const basePath = Array.isArray(raw) ? `$[${index}]` : "$";
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      diagnostics.push({
        code: "invalid-spec-item",
        level: "error",
        message: "Generator spec item must be an object.",
        path: basePath
      });
      return;
    }
    const spec = item as Record<string, unknown>;
    const kind = spec.kind;
    if (typeof kind !== "string") {
      diagnostics.push({
        code: "missing-kind",
        level: "error",
        message: "Generator spec item must include a string kind.",
        path: `${basePath}.kind`
      });
      return;
    }
    if (!supportedKinds.includes(kind)) {
      diagnostics.push({
        code: "unsupported-kind",
        level: "error",
        message: `Unsupported generator spec kind "${kind}".`,
        path: `${basePath}.kind`
      });
    }
    if (namedKinds.includes(kind) && typeof spec.name !== "string") {
      diagnostics.push({
        code: "missing-name",
        level: "error",
        message: `Generator spec kind "${kind}" requires a string name.`,
        path: `${basePath}.name`
      });
    }
    if ("shape" in spec) {
      if (typeof spec.shape !== "string" && !Array.isArray(spec.shape)) {
        diagnostics.push({
          code: "invalid-shape",
          level: "error",
          message: "Store shape must be a comma-separated string or string array.",
          path: `${basePath}.shape`
        });
      } else if (Array.isArray(spec.shape)) {
        spec.shape.forEach((entry, shapeIndex) => {
          if (typeof entry !== "string" || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry)) {
            diagnostics.push({
              code: "invalid-shape-key",
              level: "error",
              message: "Store shape keys must be JavaScript identifiers.",
              path: `${basePath}.shape[${shapeIndex}]`
            });
          }
        });
      } else {
        for (const [shapeIndex, entry] of spec.shape.split(",").map((value) => value.trim()).filter(Boolean).entries()) {
          if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(entry)) {
            diagnostics.push({
              code: "invalid-shape-key",
              level: "error",
              message: "Store shape keys must be JavaScript identifiers.",
              path: `${basePath}.shape[${shapeIndex}]`
            });
          }
        }
      }
    }
    if (kind === "feature" && "parts" in spec) {
      if (!Array.isArray(spec.parts) || spec.parts.some((part) => typeof part !== "string" || !featureParts.includes(part))) {
        diagnostics.push({
          code: "invalid-feature-parts",
          level: "error",
          message: `Feature parts must be selected from: ${featureParts.join(", ")}.`,
          path: `${basePath}.parts`
        });
      }
    }
  });
  return diagnostics;
}
