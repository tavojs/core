import { GENERATED_API_SIGNATURES } from "./generated-api.mjs";

export const AGENT_PROTOCOL_VERSION = 1 as const;
export const AGENT_PROTOCOL_STABILITY = "stable" as const;
export const AGENT_CONTEXT_MAX_BYTES = 8 * 1024;

export const AGENT_TASKS = [
  "create-route",
  "modify-route",
  "create-component",
  "modify-component",
  "add-loader",
  "add-action",
  "modify-store",
  "style-ui",
  "repair"
] as const;

export type AgentTask = typeof AGENT_TASKS[number];

export type AgentApiCard = {
  id: string;
  import: string;
  signature: string;
  useWhen: string;
  avoid: string;
  tasks: AgentTask[];
  stability: "stable" | "experimental";
};

export const AGENT_API_CARDS: AgentApiCard[] = [
  {
    id: "defineRoutePage",
    import: "@tavojs/core",
    signature: GENERATED_API_SIGNATURES.defineRoutePage!,
    useWhen: "Opting into an explicit, path-aware type contract for a file-based page.",
    avoid: "Do not add it when a plain default function and named route exports are sufficient.",
    tasks: ["create-route", "modify-route", "add-loader", "add-action", "repair"],
    stability: "stable"
  },
  {
    id: "createTavo",
    import: "@tavojs/core",
    signature: GENERATED_API_SIGNATURES.createTavo!,
    useWhen: "Building interactive reusable UI with model/controller/view ownership.",
    avoid: "Do not invent React hooks or import React.",
    tasks: ["create-component", "modify-component", "style-ui", "repair"],
    stability: "stable"
  },
  {
    id: "defineGlobalStore",
    import: "@tavojs/core",
    signature: GENERATED_API_SIGNATURES.defineGlobalStore!,
    useWhen: "Sharing application state across components and routes.",
    avoid: "Do not store request users, tokens, or per-request authorization in server globals.",
    tasks: ["modify-store", "create-component", "modify-component", "repair"],
    stability: "stable"
  },
  {
    id: "defineValidatedAction",
    import: "@tavojs/core",
    signature: GENERATED_API_SIGNATURES.defineValidatedAction!,
    useWhen: "Accepting form or JSON mutations with structured validation errors.",
    avoid: "Do not trust request input before schema validation.",
    tasks: ["add-action", "create-route", "modify-route", "repair"],
    stability: "experimental"
  },
  {
    id: "Seo",
    import: "@tavojs/core",
    signature: GENERATED_API_SIGNATURES.Seo!,
    useWhen: "Adding ordinary route title and description metadata.",
    avoid: "Do not build raw head HTML from user input.",
    tasks: ["create-route", "modify-route"],
    stability: "stable"
  }
];

export const AGENT_GENERATOR_RECIPES = [
  { id: "page", command: "tavo generate page <name> --seo", verify: "tavo verify --files <file> --json" },
  { id: "loader-page", command: "tavo generate page <name> --loader --seo", verify: "tavo verify --files <file> --smoke --json" },
  { id: "action", command: "tavo generate action <name>", verify: "tavo verify --files <file> --smoke --json" },
  { id: "component", command: "tavo generate component <name> --props", verify: "tavo verify --files <file> --json" },
  { id: "store", command: "tavo generate store <name> --shape key,count", verify: "tavo verify --files <file> --json" },
  { id: "feature", command: "tavo generate --from-json <spec> --dry-run", verify: "tavo verify --spec <spec> --json" }
] as const;

export function isAgentTask(value: unknown): value is AgentTask {
  return typeof value === "string" && (AGENT_TASKS as readonly string[]).includes(value);
}

export function apiCardsForTask(task?: AgentTask): AgentApiCard[] {
  return task ? AGENT_API_CARDS.filter((card) => card.tasks.includes(task)) : AGENT_API_CARDS.slice(0, 3);
}
