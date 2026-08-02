const taskTemplates = [
  ["create-route", "Create a typed route with SEO metadata.", ["route-exists", "typecheck", "verify"]],
  ["modify-route", "Modify an existing route without changing its public path.", ["route-stable", "typecheck", "verify"]],
  ["create-component", "Create an accessible interactive MVC component.", ["create-tavo", "accessibility", "typecheck"]],
  ["modify-component", "Add an interaction to an existing MVC component.", ["no-react-hooks", "interaction", "typecheck"]],
  ["add-loader", "Add an abort-aware typed loader to an existing route.", ["loader-signal", "typed-data", "verify"]],
  ["add-action", "Add a validated mutation action and structured error handling.", ["validated-action", "origin-safe", "verify"]],
  ["modify-store", "Extend a global store and update its consumers.", ["store-shape", "consumer-types", "typecheck"]],
  ["style-ui", "Improve responsive styling and keyboard accessibility.", ["responsive", "keyboard", "verify"]],
  ["repair", "Repair the supplied Tavo diagnostic without unrelated edits.", ["diagnostic-cleared", "minimal-diff", "verify"]]
];

const fixtures = ["small", "medium", "large", "typescript", "mixed-js-ts"];

export const agentEvaluationFixtures = {
  small: { files: 8, language: "typescript", strict: true, description: "Minimal app with one layout, route, component, action, and store." },
  medium: { files: 40, language: "typescript", strict: true, description: "Multi-feature app with nested routes and shared components." },
  large: { files: 120, language: "typescript", strict: true, description: "Large route tree with multiple dependency layers." },
  typescript: { files: 25, language: "typescript", strict: true, description: "Strict generic loader, action, and store contracts." },
  "mixed-js-ts": { files: 25, language: "mixed", strict: false, description: "JavaScript and TypeScript modules with extension-aware imports." }
};

export const agentEvaluationTasks = taskTemplates.flatMap(([task, prompt, assertions]) =>
  fixtures.map((fixture, index) => ({
    schemaVersion: 1,
    id: `${task}-${fixture}`,
    task,
    fixture,
    target: task.includes("component") ? "AccountCard" : task === "modify-store" ? "session" : "/account",
    prompt: `${prompt} Preserve existing behavior and use the canonical Tavo APIs.`,
    allowedTools: ["agent-context", "inspect", "change", "verify"],
    assertions,
    maxContextBytes: 8192,
    repairCycles: 1,
    variant: index + 1
  }))
);
