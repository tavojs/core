import fs from "node:fs";
import path from "node:path";
import type { I18nMessages, I18nTextTree, I18nTextValue } from "../i18n/index.js";

type VitePlugin = {
  name: string;
  apply?: "build" | "serve";
  enforce?: "pre" | "post";
  configResolved?(config: { root: string; command: string }): void;
  resolveId?(id: string): string | null;
  load?(id: string): string | null;
  transform?(code: string, id: string): string | null;
  generateBundle?(this: { emitFile(file: { type: "asset"; fileName: string; source: string }): string }, options: unknown, bundle: Record<string, RollupOutput>): void;
};

type RollupChunk = {
  type: "chunk";
  fileName: string;
  moduleIds: string[];
  code: string;
};

type RollupAsset = {
  type: "asset";
  fileName: string;
  source?: string | Uint8Array;
};

type RollupOutput = RollupChunk | RollupAsset;

type CatalogAnalysis = {
  catalogFile: string;
  catalogLiteral: string;
  messages: I18nMessages;
  keysByFile: Map<string, Set<string>>;
  usedKeys: Set<string>;
  dynamicKeyFiles: string[];
};

const virtualSharedId = "\0tavo:i18n-shared-messages";
const sourceExtensions = new Set([".js", ".jsx", ".ts", ".tsx"]);

function toPosixPath(value: string): string {
  return value.replace(/\\/g, "/");
}

function isSourceFile(file: string): boolean {
  return sourceExtensions.has(path.extname(file));
}

function readFilesRecursive(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) {
    return out;
  }
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".tavo" || entry.name === "dist") {
      continue;
    }
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      readFilesRecursive(absolute, out);
    } else if (entry.isFile() && isSourceFile(absolute)) {
      out.push(absolute);
    }
  }
  return out;
}

function findMatchingParen(source: string, openIndex: number): number {
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function extractDefineMessagesLiteral(source: string): string | null {
  const callIndex = source.indexOf("defineMessages");
  if (callIndex === -1) {
    return null;
  }
  const openIndex = source.indexOf("(", callIndex);
  if (openIndex === -1) {
    return null;
  }
  const closeIndex = findMatchingParen(source, openIndex);
  if (closeIndex === -1) {
    return null;
  }
  return source.slice(openIndex + 1, closeIndex).trim();
}

function evaluateMessagesLiteral(literal: string): I18nMessages | null {
  try {
    const value = Function(`"use strict"; return (${literal});`)() as unknown;
    return value && typeof value === "object" ? value as I18nMessages : null;
  } catch {
    return null;
  }
}

function collectKeys(source: string): Set<string> {
  const keys = new Set<string>();
  const patterns = [
    /\bi18n\s*\.\s*t\s*\(\s*["']([^"']+)["']/g,
    /(?<![\w$])t\s*\(\s*["']([^"']+)["']/g
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) {
        keys.add(match[1]);
      }
    }
  }
  return keys;
}

function hasDynamicTranslationCall(source: string): boolean {
  return /\bi18n\s*\.\s*t\s*\(\s*(?!["'])/.test(source) || /(?<![\w$])t\s*\(\s*(?!["'])/.test(source);
}

function readTextPath(messages: I18nTextTree | undefined, key: string): I18nTextValue | undefined {
  let current: I18nTextValue | undefined = messages;
  for (const part of key.split(".").filter(Boolean)) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as I18nTextTree)[part];
  }
  return current;
}

function writeTextPath(target: Record<string, I18nTextValue>, key: string, value: I18nTextValue): void {
  const parts = key.split(".").filter(Boolean);
  let current: Record<string, I18nTextValue> = target;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (index === parts.length - 1) {
      current[part] = value;
      return;
    }
    const next = current[part];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      current[part] = {};
    }
    current = current[part] as Record<string, I18nTextValue>;
  }
}

function pickMessages(messages: I18nMessages, keys: Iterable<string>): I18nMessages {
  const out: I18nMessages = {};
  for (const locale of Object.keys(messages)) {
    const localeMessages = messages[locale];
    const picked: Record<string, I18nTextValue> = {};
    for (const key of keys) {
      const value = readTextPath(localeMessages, key);
      if (value !== undefined) {
        writeTextPath(picked, key, value);
      }
    }
    out[locale] = picked;
  }
  return out;
}

function createEmptyLocaleMessages(messages: I18nMessages): I18nMessages {
  const out: I18nMessages = {};
  for (const locale of Object.keys(messages)) {
    out[locale] = {};
  }
  return out;
}

function isEmptyMessages(messages: I18nMessages): boolean {
  return Object.values(messages).every((tree) => Object.keys(tree).length === 0);
}

function importPath(fromFile: string, toFile: string): string {
  let relative = toPosixPath(path.posix.relative(path.posix.dirname(toPosixPath(fromFile)), toPosixPath(toFile)));
  if (!relative.startsWith(".")) {
    relative = `./${relative}`;
  }
  return relative;
}

function analyzeProject(root: string): CatalogAnalysis | null {
  const files = readFilesRecursive(path.join(root, "src"));
  let catalogFile: string | null = null;
  let catalogLiteral: string | null = null;
  let messages: I18nMessages | null = null;
  const keysByFile = new Map<string, Set<string>>();
  const usedKeys = new Set<string>();
  const dynamicKeyFiles: string[] = [];

  for (const file of files) {
    const source = fs.readFileSync(file, "utf8");
    const keys = collectKeys(source);
    if (keys.size > 0) {
      keysByFile.set(path.resolve(file), keys);
      for (const key of keys) {
        usedKeys.add(key);
      }
    }
    if (hasDynamicTranslationCall(source)) {
      dynamicKeyFiles.push(path.resolve(file));
    }
    if (!catalogFile) {
      const literal = extractDefineMessagesLiteral(source);
      if (literal) {
        const parsed = evaluateMessagesLiteral(literal);
        if (parsed) {
          catalogFile = path.resolve(file);
          catalogLiteral = literal;
          messages = parsed;
        }
      }
    }
  }

  return catalogFile && catalogLiteral && messages
    ? { catalogFile, catalogLiteral, messages, keysByFile, usedKeys, dynamicKeyFiles }
    : null;
}

function createChunkModuleSource(messages: I18nMessages): string {
  return [
    `const messages = ${JSON.stringify(messages)};`,
    "const target = globalThis;",
    "if (typeof target.__tavo_apply_i18n_message_chunk__ === \"function\") {",
    "  target.__tavo_apply_i18n_message_chunk__(messages);",
    "} else {",
    "  (target.__tavo_i18n_message_chunks__ ||= []).push(messages);",
    "}",
    ""
  ].join("\n");
}

/** Splits defineMessages catalogs into shared and generated production chunk slices. */
export function createI18nSplitPlugin(): VitePlugin {
  let root = process.cwd();
  let analysis: CatalogAnalysis | null = null;
  let sharedMessages: I18nMessages = {};

  return {
    name: "tavo:i18n-split",
    apply: "build",
    enforce: "post",
    configResolved(config) {
      root = path.resolve(config.root);
      analysis = analyzeProject(root);
      sharedMessages = analysis ? createEmptyLocaleMessages(analysis.messages) : {};
    },
    resolveId(id) {
      return id === "tavo:i18n-shared-messages" ? virtualSharedId : null;
    },
    load(id) {
      if (id !== virtualSharedId) {
        return null;
      }
      return `export const messages = ${JSON.stringify(sharedMessages)};\n`;
    },
    transform(code, id) {
      if (!analysis || path.resolve(id.split("?")[0]) !== analysis.catalogFile) {
        return null;
      }
      return code.replace(
        analysis.catalogLiteral,
        '__tavo_i18n_shared_messages__'
      ).replace(
        /(^|\n)/,
        '$1import { messages as __tavo_i18n_shared_messages__ } from "tavo:i18n-shared-messages";\n'
      );
    },
    generateBundle(_options, bundle) {
      if (!analysis) {
        return;
      }
      for (const file of analysis.dynamicKeyFiles) {
        console.warn(
          `[tavo i18n] Dynamic translation keys in ${toPosixPath(path.relative(root, file))} ` +
            "cannot be assigned to optimized message chunks. Use literal i18n.t(\"...\") keys for build-time splitting."
        );
      }
      let index = 0;
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") {
          continue;
        }
        const keys = new Set<string>();
        for (const moduleId of output.moduleIds) {
          const moduleKeys = analysis.keysByFile.get(path.resolve(moduleId.split("?")[0]));
          if (!moduleKeys) {
            continue;
          }
          for (const key of moduleKeys) {
            keys.add(key);
          }
        }
        if (keys.size === 0) {
          continue;
        }
        const messages = pickMessages(analysis.messages, keys);
        if (isEmptyMessages(messages)) {
          continue;
        }
        const fileName = `assets/tavo-i18n-${index.toString(36)}.js`;
        index += 1;
        this.emitFile({
          type: "asset",
          fileName,
          source: createChunkModuleSource(messages)
        });
        output.code = `import ${JSON.stringify(importPath(output.fileName, fileName))};\n${output.code}`;
      }
    }
  };
}
