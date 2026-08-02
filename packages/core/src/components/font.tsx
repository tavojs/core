import { h, type Child } from "../jsx.js";
import { Head } from "./head.js";
import type { FontProps } from "./types.js";

function escapeCssValue(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

function inferFontFormat(type?: string, src?: string): string | null {
  if (type === "font/woff2") {
    return "woff2";
  }
  if (type === "font/woff") {
    return "woff";
  }
  if (type === "font/ttf") {
    return "truetype";
  }
  if (type === "font/otf") {
    return "opentype";
  }
  if (!src) {
    return null;
  }
  if (src.endsWith(".woff2")) {
    return "woff2";
  }
  if (src.endsWith(".woff")) {
    return "woff";
  }
  if (src.endsWith(".ttf")) {
    return "truetype";
  }
  if (src.endsWith(".otf")) {
    return "opentype";
  }
  return null;
}

function renderLocalFontFace(props: FontProps): Child[] {
  if (!props.src || !props.family) {
    return [];
  }

  const format = inferFontFormat(props.type, props.src);
  const localSources = (props.local ?? []).map((entry) => `local('${escapeCssValue(entry)}')`);
  const remoteSource = format
    ? `url('${escapeCssValue(props.src)}') format('${format}')`
    : `url('${escapeCssValue(props.src)}')`;
  const srcParts = [...localSources, remoteSource];

  const rules = [
    "@font-face {",
    `font-family: '${escapeCssValue(props.family)}';`,
    `src: ${srcParts.join(", ")};`,
    props.weight !== undefined ? `font-weight: ${String(props.weight)};` : "",
    props.style !== undefined ? `font-style: ${props.style};` : "",
    props.display !== undefined ? `font-display: ${props.display};` : "",
    "}"
  ].filter(Boolean);

  const variableRule =
    props.variable && props.family
      ? `:root { ${props.variable}: '${escapeCssValue(props.family)}'${
          props.fallback ? `, ${props.fallback}` : ""
        }; }`
      : "";

  const nodes: Child[] = [];
  if (props.preload !== false) {
    nodes.push(
      h("link", {
        rel: "preload",
        as: "font",
        href: props.src,
        type: props.type ?? undefined,
        crossorigin: props.crossOrigin ?? "anonymous"
      })
    );
  }
  nodes.push(
    h("style", null, `${rules.join("")}${variableRule}`)
  );
  return nodes;
}

function renderExternalFontLinks(props: FontProps): Child[] {
  if (!props.href) {
    return [];
  }

  const nodes: Child[] = [];
  for (const href of props.preconnect ?? []) {
    nodes.push(
      h("link", {
        rel: "preconnect",
        href,
        crossorigin: props.crossOrigin ?? (href.includes("gstatic") ? "anonymous" : undefined)
      })
    );
  }

  if (props.preload) {
    nodes.push(
      h("link", {
        rel: "preload",
        as: "style",
        href: props.href
      })
    );
  }

  nodes.push(
    h("link", {
      rel: "stylesheet",
      href: props.href
    })
  );

  if (props.variable && props.family) {
    nodes.push(
      h(
        "style",
        null,
        `:root { ${props.variable}: '${escapeCssValue(props.family)}'${
          props.fallback ? `, ${props.fallback}` : ""
        }; }`
      )
    );
  }

  return nodes;
}

function renderFontNodes(props: FontProps): Child[] {
  return props.href ? renderExternalFontLinks(props) : renderLocalFontFace(props);
}

/** Loads external or self-hosted fonts into the document head for SSR and CSR usage. */
export function Font(props: FontProps): Child {
  const nodes = renderFontNodes(props);
  if (typeof document === "undefined") {
    return nodes;
  }
  return h(Head, {
    children: nodes
  });
}
