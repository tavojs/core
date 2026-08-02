import path from "node:path";

export type Replacement = { start: number; end: number; text: string };
export type ObjectRange = { start: number; end: number };
export type ActionProperty =
  | { kind: "shorthand" }
  | { kind: "value"; value: string }
  | { kind: "method" }
  | { kind: "dynamic" };

export function stripQuery(id: string): string {
  return id.split("?", 1)[0] ?? id;
}

export function isPagesModule(file: string, root: string): boolean {
  const relative = path.relative(root, file).replace(/\\/g, "/");
  return relative.startsWith("src/pages/") && /\.[cm]?[jt]sx?$/.test(file);
}

export function findInitializerEnd(code: string, start: number): number {
  let braceDepth = 0;
  let bracketDepth = 0;
  let parenDepth = 0;
  let quote: "\"" | "'" | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < code.length; index += 1) {
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
    else if (char === "{") braceDepth += 1;
    else if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    else if (char === "[") bracketDepth += 1;
    else if (char === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (char === "(") parenDepth += 1;
    else if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (char === ";" && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      return index + 1;
    } else if (char === "\n" && braceDepth === 0 && bracketDepth === 0 && parenDepth === 0) {
      const remainder = code.slice(index + 1);
      if (/^\s*(?:export\b|import\b|(?:async\s+)?function\b|class\b|const\b|let\b|var\b)/.test(remainder)) {
        return index;
      }
    }
  }
  return code.length;
}

export function findMatchingToken(
  code: string,
  start: number,
  open: string,
  close: string
): number {
  let depth = 0;
  let quote: "\"" | "'" | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = start; index < code.length; index += 1) {
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
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function skipWhitespace(code: string, start: number): number {
  let index = start;
  while (/\s/.test(code[index] ?? "")) index += 1;
  return index;
}

export function isIdentifierChar(value: string | undefined): boolean {
  return value !== undefined && /[$_\p{ID_Continue}]/u.test(value);
}

export function isIdentifierStart(value: string | undefined): boolean {
  return value !== undefined && /[$_\p{ID_Start}]/u.test(value);
}

export function maskCommentsAndStringContents(code: string): string {
  const masked = code.split("");
  let quote: "\"" | "'" | "`" | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < code.length; index += 1) {
    const char = code[index]!;
    const next = code[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      else masked[index] = " ";
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        masked[index] = " ";
        masked[index + 1] = " ";
        blockComment = false;
        index += 1;
      } else if (char !== "\n") masked[index] = " ";
      continue;
    }
    if (quote) {
      if (escaped) {
        if (char !== "\n") masked[index] = " ";
        escaped = false;
      } else if (char === "\\") {
        masked[index] = " ";
        escaped = true;
      } else if (char === quote) quote = null;
      else if (char !== "\n") masked[index] = " ";
      continue;
    }
    if (char === "/" && next === "/") {
      masked[index] = " ";
      masked[index + 1] = " ";
      lineComment = true;
      index += 1;
    } else if (char === "/" && next === "*") {
      masked[index] = " ";
      masked[index + 1] = " ";
      blockComment = true;
      index += 1;
    } else if (char === "\"" || char === "'" || char === "`") quote = char;
  }
  return masked.join("");
}

export function skipMaskedString(code: string, start: number): number {
  const quote = code[start];
  if (quote !== "\"" && quote !== "'" && quote !== "`") return start;
  const end = code.indexOf(quote, start + 1);
  return end === -1 ? code.length : end;
}
