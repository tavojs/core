import {
  findInitializerEnd,
  findMatchingToken,
  isIdentifierChar,
  maskCommentsAndStringContents,
  skipWhitespace,
  type Replacement
} from "./lexical.js";
import { collectPageOptionsObjects, readActionProperty } from "./options.js";

function decodeIdentifierEscapes(code: string): string {
  return code
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (match, value: string) => {
      const codePoint = Number.parseInt(value, 16);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    })
    .replace(/\\u([0-9a-fA-F]{4})/g, (_match, value: string) => (
      String.fromCharCode(Number.parseInt(value, 16))
    ));
}

function hasUnsafeNamedActionExport(source: string, masked: string): boolean {
  const decoded = decodeIdentifierEscapes(masked);
  if (/\bexport\s+(?:(?:async\s+)?function|(?:const|let|var))\s+action\b/.test(decoded)) {
    return true;
  }
  if (/\bexport\s*\*\s*as\s+action\b/.test(decoded)) return true;
  for (const match of decoded.matchAll(/\bexport\s*\{([^}]*)\}/g)) {
    const offset = (match.index ?? 0) + (match[0]?.indexOf("{") ?? 0) + 1;
    const body = source.slice(offset, offset + (match[1]?.length ?? 0));
    for (const entry of decodeIdentifierEscapes(body).split(",")) {
      const normalized = entry.trim().replace(/\s+/g, " ");
      if (
        normalized === "action"
        || /\bas action$/.test(normalized)
        || /\bas ["']action["']$/.test(normalized)
      ) return true;
    }
  }
  return false;
}

export function assertClientRouteActionsWereRemoved(code: string, file: string): void {
  const masked = maskCommentsAndStringContents(code);
  const decoded = decodeIdentifierEscapes(masked);
  const stripped = /\bexport\s+const\s+action\s*=\s*undefined\s*;/.test(decoded);
  const residualDefineAction = /\bdefineAction\s*\(/.test(decoded);
  const unsafeNamedExport = hasUnsafeNamedActionExport(code, masked) && !stripped;
  const unsafePageProperty = collectPageOptionsObjects(masked).some((range) => {
    const property = readActionProperty(code, masked, range);
    if (!property) return false;
    if (property.kind === "value" && property.value === "undefined") return false;
    if (property.kind === "dynamic" || !stripped) return true;
    return property.kind === "method"
      || (property.kind === "value" && property.value !== "action");
  });
  const dynamicPageComposition =
    /\bexport\s+default\s+defineRoutePage\b/.test(decoded)
    && collectPageOptionsObjects(masked).length === 0;
  const objectAssignedPage = /\bexport\s+default\s+Object\.assign\s*\(/.test(decoded);
  if (
    !residualDefineAction
    && !unsafeNamedExport
    && !unsafePageProperty
    && !dynamicPageComposition
    && !objectAssignedPage
  ) return;
  throw new Error([
    "Tavo could not safely remove a route action from the client bundle.",
    `Module: ${file}`,
    "Declare it as `export const action = defineAction(...)` and reference that " +
      "binding from `defineRoutePage(...)`.",
    "Keep action-only secrets and imports inside that initializer or in src/server modules."
  ].join("\n"));
}

function readClientRuntimeBranch(code: string, ifIndex: number): Replacement | null {
  if (isIdentifierChar(code[ifIndex - 1]) || isIdentifierChar(code[ifIndex + 2])) return null;
  const conditionOpen = skipWhitespace(code, ifIndex + 2);
  if (code[conditionOpen] !== "(") return null;
  const conditionClose = findMatchingToken(code, conditionOpen, "(", ")");
  if (conditionClose === -1) return null;
  const condition = code.slice(conditionOpen + 1, conditionClose).replace(/\s+/g, "");
  const consequentOpen = skipWhitespace(code, conditionClose + 1);
  if (code[consequentOpen] !== "{") return null;
  const consequentClose = findMatchingToken(code, consequentOpen, "{", "}");
  if (consequentClose === -1) return null;
  let end = consequentClose + 1;
  let alternate: { open: number; close: number } | null = null;
  const elseIndex = skipWhitespace(code, end);
  if (
    code.startsWith("else", elseIndex)
    && !isIdentifierChar(code[elseIndex - 1])
    && !isIdentifierChar(code[elseIndex + 4])
  ) {
    const open = skipWhitespace(code, elseIndex + 4);
    if (code[open] !== "{") return null;
    const close = findMatchingToken(code, open, "{", "}");
    if (close === -1) return null;
    alternate = { open, close };
    end = close + 1;
  }
  let selected: string | null = null;
  if (condition === "isClientRuntime()" || condition === "!isServerRuntime()") {
    selected = code.slice(consequentOpen + 1, consequentClose);
  } else if (condition === "isServerRuntime()" || condition === "!isClientRuntime()") {
    selected = alternate ? code.slice(alternate.open + 1, alternate.close) : "";
  }
  return selected === null ? null : { start: ifIndex, end, text: selected };
}

export function collectClientRuntimeBranchReplacements(code: string): Replacement[] {
  const replacements: Replacement[] = [];
  let quote: "\"" | "'" | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index]!;
    const next = code[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
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
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === quote) quote = null;
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
    } else if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
    } else if (char === "\"" || char === "'" || char === "`") quote = char;
    else if (code.startsWith("if", index)) {
      const replacement = readClientRuntimeBranch(code, index);
      if (replacement) {
        replacements.push(replacement);
        index = replacement.end - 1;
      }
    }
  }
  return replacements.sort((a, b) => b.start - a.start);
}

function findExportConstInitializers(
  code: string,
  name: string
): Array<Replacement & { initializer: string }> {
  const pattern = new RegExp(
    `(^|[\\n;])\\s*export\\s+const\\s+${name}\\s*(?::\\s*[^=;\\n]+)?=`,
    "g"
  );
  return Array.from(code.matchAll(pattern), (match) => {
    const fullMatch = match[0] ?? "";
    const start = (match.index ?? 0) + (match[1]?.length ?? 0);
    const initializerStart = (match.index ?? 0) + fullMatch.length;
    const end = findInitializerEnd(code, initializerStart);
    return {
      start,
      end,
      text: `export const ${name} = undefined;`,
      initializer: code.slice(initializerStart, end)
    };
  });
}

function collectHelperNames(code: string, helper: string): Set<string> {
  const names = new Set([helper]);
  const masked = maskCommentsAndStringContents(code);
  const importAlias = new RegExp(
    `\\b${helper}\\s+as\\s+([$_\\p{ID_Start}][$_\\p{ID_Continue}]*)`,
    "gu"
  );
  const localAlias = new RegExp(
    `\\b(?:const|let|var)\\s+([$_\\p{ID_Start}][$_\\p{ID_Continue}]*)` +
      `\\s*=\\s*${helper}\\b`,
    "gu"
  );
  for (const match of masked.matchAll(importAlias)) if (match[1]) names.add(match[1]);
  for (const match of masked.matchAll(localAlias)) if (match[1]) names.add(match[1]);
  return names;
}

function callsAnyHelper(initializer: string, names: Set<string>): boolean {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\s*\\(`).test(initializer)) return true;
  }
  return false;
}

export function collectServerOnlyRouteExportReplacements(code: string): Replacement[] {
  const replacements: Replacement[] = [];
  const loaderNames = collectHelperNames(code, "defineServerLoader");
  const middlewareNames = collectHelperNames(code, "defineServerMiddleware");
  replacements.push(...findExportConstInitializers(code, "action").map(
    ({ initializer: _initializer, ...replacement }) => replacement
  ));
  for (const match of findExportConstInitializers(code, "load")) {
    const serverRuntime = /\bdefineLoader\s*\(/.test(match.initializer)
      && /\bruntime\s*:\s*["']server["']/.test(match.initializer);
    if (callsAnyHelper(match.initializer, loaderNames) || serverRuntime) {
      const { initializer: _initializer, ...replacement } = match;
      replacements.push(replacement);
    }
  }
  for (const match of findExportConstInitializers(code, "middleware")) {
    const serverRuntime = /\bdefineMiddleware\s*\(/.test(match.initializer)
      && /\bruntime\s*:\s*["']server["']/.test(match.initializer);
    if (callsAnyHelper(match.initializer, middlewareNames) || serverRuntime) {
      const { initializer: _initializer, ...replacement } = match;
      replacements.push(replacement);
    }
  }
  return replacements.sort((a, b) => b.start - a.start);
}

export function applyReplacements(code: string, replacements: Replacement[]): string {
  let next = code;
  for (const replacement of replacements) {
    next = next.slice(0, replacement.start) + replacement.text + next.slice(replacement.end);
  }
  return next;
}

export function assertClientRouteServerHelpersWereRemoved(code: string, file: string): void {
  const masked = decodeIdentifierEscapes(maskCommentsAndStringContents(code));
  const residualHelper = /\b(?:defineServerLoader|defineServerMiddleware)\s*\(/.test(masked);
  const residualRuntime = /\bdefine(?:Loader|Middleware)\s*\([\s\S]*?\bruntime\s*:\s*["']server["']/.test(code);
  const residualLoader = /\bdefineServerLoader\b/.test(masked)
    && findExportConstInitializers(code, "load").some(
      ({ initializer }) => !/^\s*undefined\s*;?\s*$/.test(initializer)
    );
  const residualMiddleware = /\bdefineServerMiddleware\b/.test(masked)
    && findExportConstInitializers(code, "middleware").some(
      ({ initializer }) => !/^\s*undefined\s*;?\s*$/.test(initializer)
    );
  if (!residualHelper && !residualRuntime && !residualLoader && !residualMiddleware) return;
  throw new Error([
    "Tavo could not safely remove a server-only route export from the client bundle.",
    `Module: ${file}`,
    "Export server loaders and middleware directly as typed or untyped const declarations.",
    "Keep server-only secrets and imports inside those initializers or in src/server modules."
  ].join("\n"));
}

export function overlapsAny(replacement: Replacement, ranges: Replacement[]): boolean {
  return ranges.some((range) => (
    replacement.start < range.end && replacement.end > range.start
  ));
}
