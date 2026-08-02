import { cliExecHint } from "../utils/format.mjs";
export { defaultStyleSource } from "./starter-style.mjs";
import {
  AGENT_API_CARDS,
  AGENT_GENERATOR_RECIPES,
  AGENT_PROTOCOL_VERSION,
  AGENT_PROTOCOL_STABILITY,
  AGENT_TASKS
} from "../protocol/catalog.mjs";


export function createAgentGuideSource(packageManager: string): string {
  const run = cliExecHint(packageManager);
  return [
    "# Tavo Agent Guide",
    "",
    "Use this file as the local contract for generated and agent-edited app code.",
    "",
    "## Commands",
    "",
    `- Start development: \`${run} tavo dev\``,
    `- Start SSR development: \`${run} tavo dev --ssr\``,
    `- Read task context: \`${run} tavo agent-context --json --task <task> --target <name>\``,
    `- Inspect one entity: \`${run} tavo inspect <route|component|store|file|api> <target> --json\``,
    `- Preview a safe transaction: \`${run} tavo change --from-json change.json --dry-run\``,
    `- Validate generation spec: \`${run} tavo generate --validate-spec tavo.generated.json\``,
    `- Validate quickly: \`${run} tavo check\``,
    `- Diagnose repairs: \`${run} tavo doctor --fix-dry-run --json\``,
    `- Verify changed files: \`${run} tavo verify --files <file,...> --smoke --json\``,
    `- Build production output: \`${run} tavo build\``,
    `- Preview SSR output: \`${run} tavo preview --ssr\``,
    "",
    "## App Conventions",
    "",
    "- Tavo uses TSX, but it is not React. Do not add React, React hooks, React Context, or React lifecycle patterns.",
    "- Pages live in `src/pages` and use file-based routing.",
    "- Use `@tavojs/core` for application APIs and `@tavojs/core/router` for route and navigation APIs.",
    "- Use only `server`, `config`, `plugin`, or experimental `dev` subpaths for those explicit boundaries.",
    "- Pages use a default function plus named exports such as `load`, `head`, and `prerender`.",
    "- Use `defineRoutePage(...)` only when an explicit path-aware type contract is useful.",
    "- Interactive reusable UI should use `createTavo(...)` from `@tavojs/core`.",
    "- In MVC components, keep state in the model, event behavior in the controller, and rendering in the view.",
    "- Route metadata should use `Seo` from `@tavojs/core` when title and description are enough.",
    "- Shared state lives in `src/store` and uses `defineGlobalStore(...)` from `@tavojs/core`.",
    "- Treat route loaders, actions, and server-rendered module top-level code as server-capable; " +
      "keep `window`, `document`, storage, and other browser-only APIs in client-owned code.",
    `- Supported context tasks: ${AGENT_TASKS.map((task) => `\`${task}\``).join(", ")}.`,
    "",
    "## Generated Files",
    "",
    "- Do not edit `.tavo/generated` or `.tavo/build` by hand.",
    "- Re-run `tavo check` or `tavo build` when route files change.",
    "- Treat generated route and build artifacts as outputs.",
    "- Never apply a change plan when its SHA-256 precondition is stale.",
    "",
    "## Documentation",
    "",
    "- Prefer the local Tavo MCP server when it is configured: search documentation first, " +
      "then read `tavo://status` to check snapshot compatibility.",
    "- Agent documentation index: `https://tavojs.dev/llms.txt`.",
    "- Full offline documentation: `https://tavojs.dev/llms-full.txt`.",
    "- Markdown mirrors use `https://tavojs.dev/docs/<path>.md`.",
    "",
    "## Schema Generation",
    "",
    "Use `tavo generate --validate-spec <file>` before `tavo generate --from-json <file>` for multi-file generation. Example:",
    "",
    "```json",
    JSON.stringify([
      { kind: "page", name: "dashboard", seo: true },
      { kind: "page", name: "blog/[id]", loader: true, seo: true },
      { kind: "component", name: "UserCard", props: true },
      { kind: "store", name: "session", shape: ["user", "ready"] }
    ], null, 2),
    "```",
    ""
  ].join("\n");
}

export function createAgentManifestSource(packageManager: string): string {
  const run = cliExecHint(packageManager);
  return `${JSON.stringify({
    framework: "tavo",
    schemaVersion: AGENT_PROTOCOL_VERSION,
    protocolStability: AGENT_PROTOCOL_STABILITY,
    commands: {
      dev: `${run} tavo dev`,
      devSsr: `${run} tavo dev --ssr`,
      agentContext: `${run} tavo agent-context --json --task <task> --target <name>`,
      inspect: `${run} tavo inspect <kind> <target> --json`,
      changeDryRun: `${run} tavo change --from-json change.json --dry-run`,
      change: `${run} tavo change --from-json change.json`,
      inventory: `${run} tavo inventory --json`,
      validateSpec: `${run} tavo generate --validate-spec tavo.generated.json`,
      check: `${run} tavo check`,
      doctorFixDryRun: `${run} tavo doctor --fix-dry-run --json`,
      verify: `${run} tavo verify --files <file,...> --json`,
      verifySmoke: `${run} tavo verify --smoke --json`,
      build: `${run} tavo build`,
      previewSsr: `${run} tavo preview --ssr`
    },
    conventions: {
      pagesDir: "src/pages",
      preferredPageApi: "functional-module",
      optionalTypedPageApi: "defineRoutePage",
      preferredComponentApi: "createTavo",
      generatedDirs: [".tavo/generated", ".tavo/build"],
      doNotEdit: [".tavo/generated", ".tavo/build"]
    },
    documentation: {
      index: "https://tavojs.dev/llms.txt",
      full: "https://tavojs.dev/llms-full.txt",
      markdownBase: "https://tavojs.dev/docs/",
      mcpStatusResource: "tavo://status",
      mcpDocumentationIndex: "tavo://docs/index"
    },
    tasks: AGENT_TASKS,
    apiCards: AGENT_API_CARDS,
    recipes: AGENT_GENERATOR_RECIPES,
    schemas: {
      protocol: "@tavojs/cli/schemas/protocol-v1.schema.json",
      context: "@tavojs/cli/schemas/context-v1.schema.json",
      changePlan: "@tavojs/cli/schemas/change-plan-v1.schema.json",
      changeReceipt: "@tavojs/cli/schemas/change-receipt-v1.schema.json",
      diagnostic: "@tavojs/cli/schemas/diagnostic-v1.schema.json"
    },
    generatorSpecs: [
      { kind: "page", name: "dashboard", seo: true },
      { kind: "page", name: "blog/[id]", loader: true, seo: true },
      { kind: "component", name: "UserCard", props: true },
      { kind: "store", name: "session", shape: ["user", "ready"] }
    ],
    nextCommands: [
      `${run} tavo agent-context --json --task <task> --target <name>`,
      `${run} tavo inspect <kind> <target> --json`,
      `${run} tavo generate --validate-spec tavo.generated.json`,
      `${run} tavo generate --from-json tavo.generated.json`,
      `${run} tavo verify --files <file,...> --smoke --json`
    ]
  }, null, 2)}\n`;
}
