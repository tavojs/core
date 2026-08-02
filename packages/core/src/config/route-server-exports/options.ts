import {
  findMatchingToken,
  isIdentifierChar,
  isIdentifierStart,
  skipMaskedString,
  skipWhitespace,
  type ActionProperty,
  type ObjectRange
} from "./lexical.js";

function findCallObjectArgument(
  code: string,
  callOpen: number,
  targetArgument: number
): ObjectRange | null {
  let parenDepth = 1;
  let braceDepth = 0;
  let bracketDepth = 0;
  let argument = 0;
  let argumentStarted = false;
  for (let index = callOpen + 1; index < code.length; index += 1) {
    const char = code[index]!;
    if (char === "\"" || char === "'" || char === "`") {
      if (argument === targetArgument && parenDepth === 1 && braceDepth === 0 && bracketDepth === 0) {
        argumentStarted = true;
      }
      index = skipMaskedString(code, index);
      continue;
    }
    if (/\s/.test(char)) continue;
    if (
      argument === targetArgument
      && parenDepth === 1
      && braceDepth === 0
      && bracketDepth === 0
      && !argumentStarted
    ) {
      argumentStarted = true;
      if (char !== "{") return null;
      const end = findMatchingToken(code, index, "{", "}");
      return end === -1 ? null : { start: index, end };
    }
    if (char === "(") parenDepth += 1;
    else if (char === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) return null;
    } else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === "," && parenDepth === 1 && braceDepth === 0 && bracketDepth === 0) {
      argument += 1;
      argumentStarted = false;
    }
  }
  return null;
}

function findPageOptionsObject(
  code: string,
  searchStart: number,
  targetArgument: number
): ObjectRange | null {
  let typeArgumentDepth = 0;
  for (let index = searchStart; index < code.length; index += 1) {
    const char = code[index];
    if (char === "\"" || char === "'" || char === "`") {
      index = skipMaskedString(code, index);
    } else if (char === "<") typeArgumentDepth += 1;
    else if (char === ">" && code[index - 1] !== "=") {
      typeArgumentDepth = Math.max(0, typeArgumentDepth - 1);
    } else if (char === "(" && typeArgumentDepth === 0) {
      return findCallObjectArgument(code, index, targetArgument);
    } else if (char === ";") return null;
  }
  return null;
}

export function collectPageOptionsObjects(code: string): ObjectRange[] {
  const ranges: ObjectRange[] = [];
  const pageCallPattern = /\bexport\s+default\s+defineRoutePage\b/g;
  for (const match of code.matchAll(pageCallPattern)) {
    const range = findPageOptionsObject(
      code,
      (match.index ?? 0) + (match[0]?.length ?? 0),
      1
    );
    if (range) ranges.push(range);
  }
  for (const match of code.matchAll(/\bexport\s+default\s*\{/g)) {
    const start = (match.index ?? 0) + (match[0]?.lastIndexOf("{") ?? 0);
    const end = findMatchingToken(code, start, "{", "}");
    if (end !== -1) ranges.push({ start, end });
  }
  const identifierPattern = /\bexport\s+default\s+([$_\p{ID_Start}][$_\p{ID_Continue}]*)\s*;?/gu;
  for (const match of code.matchAll(identifierPattern)) {
    const name = match[1];
    if (!name) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declarationPattern = new RegExp(
      `\\b(?:const|let|var)\\s+${escaped}\\s*=\\s*\\{`,
      "g"
    );
    let declaration: RegExpExecArray | null = null;
    for (const candidate of code.matchAll(declarationPattern)) {
      if ((candidate.index ?? code.length) < (match.index ?? 0)) {
        declaration = candidate as RegExpExecArray;
      }
    }
    if (!declaration) continue;
    const start = (declaration.index ?? 0) + (declaration[0]?.lastIndexOf("{") ?? 0);
    const end = findMatchingToken(code, start, "{", "}");
    if (end !== -1) ranges.push({ start, end });
  }
  return ranges;
}

function readQuotedPropertyKey(
  source: string,
  start: number,
  end: number
): { key: string; end: number } | null {
  const quote = source[start];
  if (quote !== "\"" && quote !== "'") return null;
  let escaped = false;
  let key = "";
  for (let index = start + 1; index < end; index += 1) {
    const char = source[index]!;
    if (escaped) {
      key += char;
      escaped = false;
    } else if (char === "\\") escaped = true;
    else if (char === quote) return { key, end: index + 1 };
    else key += char;
  }
  return null;
}

export function readTopLevelPropertyValue(
  code: string,
  start: number,
  end: number
): string {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  for (let index = start; index < end; index += 1) {
    const char = code[index]!;
    if (char === "\"" || char === "'" || char === "`") {
      index = skipMaskedString(code, index);
    } else if (char === "{") braceDepth += 1;
    else if (char === "}") {
      if (braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
        return code.slice(start, index).trim();
      }
      braceDepth = Math.max(0, braceDepth - 1);
    } else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === "," && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      return code.slice(start, index).trim();
    }
  }
  return code.slice(start, end).trim();
}

export function readActionProperty(
  source: string,
  masked: string,
  range: ObjectRange
): ActionProperty | null {
  let braceDepth = 1;
  let bracketDepth = 0;
  let parenDepth = 0;
  let expectsProperty = true;
  for (let index = range.start + 1; index < range.end; index += 1) {
    const char = masked[index]!;
    if (char === "\"" || char === "'" || char === "`") {
      if (expectsProperty && braceDepth === 1 && bracketDepth === 0 && parenDepth === 0) {
        const quoted = readQuotedPropertyKey(source, index, range.end);
        if (quoted) {
          const next = skipWhitespace(masked, quoted.end);
          expectsProperty = false;
          if (quoted.key === "action" && masked[next] === ":") {
            const valueStart = skipWhitespace(masked, next + 1);
            return { kind: "value", value: readTopLevelPropertyValue(masked, valueStart, range.end) };
          }
          index = quoted.end - 1;
          continue;
        }
      }
      index = skipMaskedString(masked, index);
      continue;
    }
    const top = braceDepth === 1 && bracketDepth === 0 && parenDepth === 0;
    if (top && char === ",") {
      expectsProperty = true;
      continue;
    }
    if (top && expectsProperty) {
      if (/\s/.test(char)) continue;
      if (masked.startsWith("...", index) || char === "[") return { kind: "dynamic" };
      if (isIdentifierStart(char)) {
        let keyEnd = index + 1;
        while (isIdentifierChar(masked[keyEnd])) keyEnd += 1;
        const key = masked.slice(index, keyEnd);
        const next = skipWhitespace(masked, keyEnd);
        expectsProperty = false;
        if ((key === "async" || key === "get" || key === "set") && isIdentifierStart(masked[next])) {
          let modifiedEnd = next + 1;
          while (isIdentifierChar(masked[modifiedEnd])) modifiedEnd += 1;
          const after = skipWhitespace(masked, modifiedEnd);
          if (masked.slice(next, modifiedEnd) === "action" && masked[after] === "(") {
            return { kind: "method" };
          }
        }
        if (key === "action") {
          if (masked[next] === ":") {
            const valueStart = skipWhitespace(masked, next + 1);
            return { kind: "value", value: readTopLevelPropertyValue(masked, valueStart, range.end) };
          }
          if (masked[next] === "(") return { kind: "method" };
          if (masked[next] === "," || masked[next] === "}" || masked[next] === "=") {
            return { kind: "shorthand" };
          }
        }
        index = keyEnd - 1;
        continue;
      }
      expectsProperty = false;
    }
    if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
  }
  return null;
}
