import type { SourceRange } from "../project/analyzer.mjs";

export type ProjectDiagnostic = {
  code: string;
  level: "error" | "warning";
  category?: "project-shape" | "routing" | "agent-convention" | "server-boundary" | "runtime-smoke" | "typecheck" | "spec";
  confidence?: "high" | "medium" | "low";
  safeToAutoFix?: boolean;
  message: string;
  file?: string;
  line?: number;
  sourceRange?: SourceRange;
  suggestedFix?: string;
  docs?: string;
  commands?: string[];
  fix?: FixOperation;
};

export type FixOperation =
  | {
      kind: "create-file";
      file: string;
      content: string;
      risk: "low" | "manual";
    }
  | {
      kind: "replace-text";
      file: string;
      before: string;
      after: string;
      risk: "low" | "manual";
    }
  | {
      kind: "update-import";
      file: string;
      before: string;
      after: string;
      risk: "low" | "manual";
    }
  | {
      kind: "run-command";
      command: string;
      risk: "low" | "manual";
    }
  | {
      kind: "manual";
      risk: "manual";
    };

export type RouteInspection = {
  path: string;
  file: string;
  files: string[];
  params: Array<{ name: string; optional: boolean; catchAll: boolean }>;
  layouts: string[];
};

export type InventoryFile = {
  name: string;
  file: string;
  exports: string[];
  imports: Array<{ module: string; names: string[]; defaultName?: string; namespaceName?: string }>;
};

export type ProjectInventory = {
  pages: Array<RouteInspection & { exports: string[]; hasLoader: boolean; hasAction: boolean; importPath: string }>;
  layouts: InventoryFile[];
  components: InventoryFile[];
  stores: InventoryFile[];
  actions: Array<{ route: string; file: string; exportName: "action" }>;
  cssEntries: string[];
  publicExports: Record<string, string[]>;
};
