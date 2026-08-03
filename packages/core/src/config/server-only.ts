import path from "node:path";
import { TavoError } from "../diagnostics.js";
import {
  importTargetsServerDirectory,
  isInsideServerDirectory,
  isSourceFile,
  normalizePathname,
  stripQuery
} from "./server-only/paths.js";

const serverOnlyImports = new Set(["@tavojs/core/server-only"]);
const staticImportPattern =
  /(?:^|[\n;])\s*(?:import\s+(?:[^'"]*?\s+from\s*)?|export\s+(?:[^'"]*?\s+from\s*))["']([^"']+)["']/g;

function hasServerOnlyMarker(code: string): boolean {
  staticImportPattern.lastIndex = 0;
  for (const match of code.matchAll(staticImportPattern)) {
    if (serverOnlyImports.has(match[1] ?? "")) {
      return true;
    }
  }
  return false;
}

function findStaticServerImport(code: string, importer: string, root: string): string | null {
  staticImportPattern.lastIndex = 0;
  for (const match of code.matchAll(staticImportPattern)) {
    const specifier = match[1] ?? "";
    if (serverOnlyImports.has(specifier) || importTargetsServerDirectory(importer, specifier, root)) {
      return specifier;
    }
  }
  return null;
}

function isIdentifierChar(value: string | undefined): boolean {
  return value !== undefined && /[$_\p{ID_Continue}]/u.test(value);
}

function readDynamicImportSpecifier(code: string, importIndex: number): string | null {
  if (isIdentifierChar(code[importIndex - 1]) || isIdentifierChar(code[importIndex + "import".length])) {
    return null;
  }

  let index = importIndex + "import".length;
  while (/\s/.test(code[index] ?? "")) {
    index += 1;
  }
  if (code[index] !== "(") {
    return null;
  }
  index += 1;
  while (/\s/.test(code[index] ?? "")) {
    index += 1;
  }

  const quote = code[index];
  if (quote !== "\"" && quote !== "'") {
    return null;
  }
  index += 1;

  let specifier = "";
  let escaped = false;
  for (; index < code.length; index += 1) {
    const char = code[index]!;
    if (escaped) {
      specifier += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === quote) {
      return specifier;
    }
    specifier += char;
  }

  return null;
}

function findDynamicServerImport(code: string, importer: string, root: string): string | null {
  let quote: "\"" | "'" | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < code.length; index += 1) {
    const char = code[index]!;
    const next = code[index + 1];

    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (code.startsWith("import", index)) {
      const specifier = readDynamicImportSpecifier(code, index);
      if (
        specifier &&
        (serverOnlyImports.has(specifier) || importTargetsServerDirectory(importer, specifier, root))
      ) {
        return specifier;
      }
    }
  }

  return null;
}

const sensitiveEnvironmentName = /(?:SECRET|TOKEN|PASSWORD|PASSWD|PRIVATE|DATABASE|CREDENTIAL|API[_-]?KEY|AUTH[_-]?KEY)/i;

function maskCommentsAndStrings(code: string): string {
  let out = "";
  let quote: "\"" | "'" | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let templateExpressionDepth = 0;
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index]!;
    const next = code[index + 1];
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        out += "\n";
      } else {
        out += " ";
      }
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        out += "  ";
        blockComment = false;
        index += 1;
      } else {
        out += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        out += " ";
        continue;
      }
      if (char === "\\") {
        escaped = true;
        out += " ";
        continue;
      }
      if (quote === "`" && char === "$" && next === "{") {
        quote = null;
        templateExpressionDepth = 1;
        out += "  ";
        index += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
      }
      out += char === "\n" ? "\n" : " ";
      continue;
    }
    if (templateExpressionDepth > 0 && char === "{") {
      templateExpressionDepth += 1;
      out += char;
      continue;
    }
    if (templateExpressionDepth > 0 && char === "}") {
      templateExpressionDepth -= 1;
      out += " ";
      if (templateExpressionDepth === 0) {
        quote = "`";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      out += "  ";
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      out += "  ";
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      out += " ";
      continue;
    }
    out += char;
  }
  return out;
}

function findSensitiveEnvironmentReference(code: string): { expression: string; name: string } | null {
  const masked = maskCommentsAndStrings(code);
  const patterns = [
    { expression: "process.env", pattern: /\bprocess\s*\.\s*env\s*\.\s*([A-Z][A-Z0-9_]*)/g },
    { expression: "import.meta.env", pattern: /\bimport\s*\.\s*meta\s*\.\s*env\s*\.\s*([A-Z][A-Z0-9_]*)/g }
  ];
  for (const candidate of patterns) {
    for (const match of masked.matchAll(candidate.pattern)) {
      const name = match[1] ?? "";
      if (sensitiveEnvironmentName.test(name)) {
        return { expression: candidate.expression, name };
      }
    }
  }
  return null;
}

type ModuleGraphContext = {
  getModuleInfo?(id: string): { importers?: string[] } | null;
};

function describeImportChain(context: ModuleGraphContext, file: string, root: string): string {
  if (!context.getModuleInfo) {
    return `Import chain: client graph -> ${normalizePathname(path.relative(root, file))}`;
  }
  const chain = [file];
  const seen = new Set(chain);
  let current = file;
  for (let depth = 0; depth < 8; depth += 1) {
    const importer = context.getModuleInfo(current)?.importers?.find((candidate) => !seen.has(candidate));
    if (!importer) {
      break;
    }
    chain.unshift(importer);
    seen.add(importer);
    current = importer;
  }
  return `Import chain: ${chain.map((entry) => normalizePathname(path.relative(root, stripQuery(entry)))).join(" -> ")}`;
}

export function createServerOnlyGuardPlugin() {
  let root = process.cwd();

  return {
    name: "tavo:server-only-guard",
    enforce: "pre" as const,
    configResolved(config: { root?: string }) {
      root = path.resolve(config.root ?? process.cwd());
    },
    transform(this: ModuleGraphContext, code: string, id: string, options?: { ssr?: boolean }) {
      if (options?.ssr) {
        return null;
      }

      const file = stripQuery(id);
      if (!isSourceFile(file)) {
        return null;
      }

      if (isInsideServerDirectory(file, root) || hasServerOnlyMarker(code)) {
        throw new TavoError(
          "TAVO_CONFIG_001",
          [
            "Tavo.js server-only module reached the client bundle.",
            `Module: ${file}`,
            describeImportChain(this, file, root),
            "Move secrets, sessions, database clients, and private API clients behind server-only actions, loaders, or middleware.",
            'For shared route files, use defineMiddleware(handler, { runtime: "server" }) ' +
            "and dynamically import server code inside the handler."
          ].join("\n"),
          { details: { module: file } }
        );
      }

      const serverImport = findStaticServerImport(code, file, root);
      if (serverImport) {
        throw new TavoError(
          "TAVO_CONFIG_001",
          [
            "Tavo.js blocked a static server-only import from client-bound code.",
            `Module: ${file}`,
            `Import: ${serverImport}`,
            describeImportChain(this, file, root),
            "Move the import into a server-only action, loader, or middleware, or place public/shared code outside src/server."
          ].join("\n"),
          { details: { module: file, import: serverImport } }
        );
      }

      const dynamicServerImport = findDynamicServerImport(code, file, root);
      if (dynamicServerImport) {
        throw new TavoError(
          "TAVO_CONFIG_001",
          [
            "Tavo.js blocked a dynamic server-only import from client-bound code.",
            `Module: ${file}`,
            `Import: ${dynamicServerImport}`,
            describeImportChain(this, file, root),
            "Move the import into a server-only action, server loader, or server middleware, " +
            "or place public/shared code outside src/server."
          ].join("\n"),
          { details: { module: file, import: dynamicServerImport } }
        );
      }

      const sensitiveEnvironment = findSensitiveEnvironmentReference(code);
      if (sensitiveEnvironment) {
        throw new TavoError(
          "TAVO_CONFIG_002",
          [
            `Tavo.js blocked likely secret environment variable ${sensitiveEnvironment.name} from client-bound code.`,
            `Module: ${file}`,
            `Expression: ${sensitiveEnvironment.expression}.${sensitiveEnvironment.name}`,
            describeImportChain(this, file, root),
            "Read the value inside a server action, server loader, server middleware, or server-only module."
          ].join("\n"),
          { details: { module: file, environmentVariable: sensitiveEnvironment.name } }
        );
      }

      return null;
    }
  };
}
