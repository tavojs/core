import fs from "node:fs/promises";

type SvgNode =
  | {
      kind: "element";
      tag: string;
      attrs: Record<string, string | true>;
      children: SvgNode[];
    }
  | {
      kind: "text";
      value: string;
    };

type SvgComponentPlugin = {
  name: string;
  enforce: "pre";
  load(id: string): Promise<string | null>;
};

function hasComponentQuery(id: string): boolean {
  const queryStart = id.indexOf("?");
  if (queryStart === -1) {
    return false;
  }
  const query = new URLSearchParams(id.slice(queryStart + 1));
  return query.has("component");
}

function stripQuery(id: string): string {
  const queryStart = id.indexOf("?");
  return queryStart === -1 ? id : id.slice(0, queryStart);
}

function decodeEntity(value: string): string {
  if (value === "amp") {
    return "&";
  }
  if (value === "lt") {
    return "<";
  }
  if (value === "gt") {
    return ">";
  }
  if (value === "quot") {
    return "\"";
  }
  if (value === "apos") {
    return "'";
  }
  if (value.startsWith("#x")) {
    const code = Number.parseInt(value.slice(2), 16);
    return Number.isFinite(code) ? String.fromCodePoint(code) : `&${value};`;
  }
  if (value.startsWith("#")) {
    const code = Number.parseInt(value.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : `&${value};`;
  }
  return `&${value};`;
}

function decodeEntities(value: string): string {
  return value.replace(/&([a-zA-Z][\w.-]*|#[0-9]+|#x[0-9a-fA-F]+);/g, (_match, entity: string) =>
    decodeEntity(entity)
  );
}

function normalizeAttributeName(name: string): string {
  return name === "class" ? "className" : name;
}

function isUnsafeAttribute(name: string, value: string | true): boolean {
  if (/^on/i.test(name)) {
    return true;
  }
  if (
    typeof value === "string" &&
    /^(href|xlink:href)$/i.test(name) &&
    /^\s*javascript:/i.test(value)
  ) {
    return true;
  }
  return false;
}

function parseAttributes(source: string): Record<string, string | true> {
  const attrs: Record<string, string | true> = {};
  let index = 0;

  while (index < source.length) {
    while (/\s/.test(source[index] ?? "")) {
      index += 1;
    }
    if (index >= source.length) {
      break;
    }

    const nameStart = index;
    while (index < source.length && !/[\s=]/.test(source[index])) {
      index += 1;
    }
    const rawName = source.slice(nameStart, index);
    if (!rawName) {
      break;
    }

    while (/\s/.test(source[index] ?? "")) {
      index += 1;
    }

    let value: string | true = true;
    if (source[index] === "=") {
      index += 1;
      while (/\s/.test(source[index] ?? "")) {
        index += 1;
      }
      const quote = source[index];
      if (quote === "\"" || quote === "'") {
        index += 1;
        const valueStart = index;
        while (index < source.length && source[index] !== quote) {
          index += 1;
        }
        value = decodeEntities(source.slice(valueStart, index));
        if (source[index] === quote) {
          index += 1;
        }
      } else {
        const valueStart = index;
        while (index < source.length && !/\s/.test(source[index])) {
          index += 1;
        }
        value = decodeEntities(source.slice(valueStart, index));
      }
    }

    const name = normalizeAttributeName(rawName);
    if (!isUnsafeAttribute(name, value)) {
      attrs[name] = value;
    }
  }

  return attrs;
}

function findTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (quote) {
      if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") {
      return index;
    }
  }
  throw new Error("tavo svg component: unterminated SVG tag.");
}

function appendText(stack: SvgNode[], text: string): void {
  const decoded = decodeEntities(text);
  if (decoded.trim() === "") {
    return;
  }
  const parent = stack[stack.length - 1];
  if (parent?.kind === "element") {
    parent.children.push({ kind: "text", value: decoded });
  }
}

export function parseSvg(source: string): SvgNode {
  const documentRoot: SvgNode = {
    kind: "element",
    tag: "#document",
    attrs: {},
    children: []
  };
  const stack: SvgNode[] = [documentRoot];
  let index = 0;

  while (index < source.length) {
    const tagStart = source.indexOf("<", index);
    if (tagStart === -1) {
      appendText(stack, source.slice(index));
      break;
    }

    appendText(stack, source.slice(index, tagStart));

    if (source.startsWith("<!--", tagStart)) {
      const commentEnd = source.indexOf("-->", tagStart + 4);
      index = commentEnd === -1 ? source.length : commentEnd + 3;
      continue;
    }

    if (source.startsWith("<![CDATA[", tagStart)) {
      const cdataEnd = source.indexOf("]]>", tagStart + 9);
      appendText(stack, source.slice(tagStart + 9, cdataEnd === -1 ? source.length : cdataEnd));
      index = cdataEnd === -1 ? source.length : cdataEnd + 3;
      continue;
    }

    if (source.startsWith("<?", tagStart)) {
      const instructionEnd = source.indexOf("?>", tagStart + 2);
      index = instructionEnd === -1 ? source.length : instructionEnd + 2;
      continue;
    }

    if (/^<!doctype/i.test(source.slice(tagStart, tagStart + 9))) {
      const doctypeEnd = findTagEnd(source, tagStart + 2);
      index = doctypeEnd + 1;
      continue;
    }

    const tagEnd = findTagEnd(source, tagStart + 1);
    const rawTag = source.slice(tagStart + 1, tagEnd).trim();
    index = tagEnd + 1;

    if (!rawTag || rawTag.startsWith("!")) {
      continue;
    }

    if (rawTag.startsWith("/")) {
      const closingTag = rawTag.slice(1).trim().toLowerCase();
      while (stack.length > 1) {
        const node = stack.pop();
        if (node?.kind === "element" && node.tag.toLowerCase() === closingTag) {
          break;
        }
      }
      continue;
    }

    const selfClosing = rawTag.endsWith("/");
    const content = selfClosing ? rawTag.slice(0, -1).trim() : rawTag;
    const spaceIndex = content.search(/\s/);
    const tag = spaceIndex === -1 ? content : content.slice(0, spaceIndex);
    if (!tag || tag.toLowerCase() === "script") {
      if (!selfClosing && tag.toLowerCase() === "script") {
        const match = new RegExp(`</${tag}\\s*>`, "i").exec(source.slice(index));
        index = match ? index + match.index + match[0].length : source.length;
      }
      continue;
    }

    const node: SvgNode = {
      kind: "element",
      tag,
      attrs: parseAttributes(spaceIndex === -1 ? "" : content.slice(spaceIndex + 1)),
      children: []
    };

    const parent = stack[stack.length - 1];
    if (parent?.kind === "element") {
      parent.children.push(node);
    }
    if (!selfClosing) {
      stack.push(node);
    }
  }

  const svg = documentRoot.children.find(
    (node) => node.kind === "element" && node.tag.toLowerCase() === "svg"
  );
  if (!svg) {
    throw new Error("tavo svg component: expected an <svg> root element.");
  }
  return svg;
}

function toObjectExpression(attrs: Record<string, string | true>, mergeProps: boolean): string {
  const entries = Object.entries(attrs).map(
    ([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`
  );
  if (mergeProps) {
    entries.push("...props");
  }
  return `{${entries.join(",")}}`;
}

function toHExpression(node: SvgNode, root = false): string {
  if (node.kind === "text") {
    return JSON.stringify(node.value);
  }

  const attrs = toObjectExpression(node.attrs, root);
  const children = node.children.map((child) => toHExpression(child)).join(",");
  return children
    ? `h(${JSON.stringify(node.tag)},${attrs},${children})`
    : `h(${JSON.stringify(node.tag)},${attrs})`;
}

export function transformSvgToTavoComponent(source: string): string {
  const root = parseSvg(source);
  return [
    'import { h } from "@tavojs/core";',
    "export default function SvgComponent(props = {}) {",
    `  return ${toHExpression(root, true)};`,
    "}",
    ""
  ].join("\n");
}

export function createSvgComponentPlugin(): SvgComponentPlugin {
  return {
    name: "tavo:svg-component",
    enforce: "pre",
    async load(id) {
      if (!id.endsWith(".svg?component") && !hasComponentQuery(id)) {
        return null;
      }
      const file = stripQuery(id);
      if (!file.endsWith(".svg")) {
        return null;
      }
      return transformSvgToTavoComponent(await fs.readFile(file, "utf8"));
    }
  };
}
