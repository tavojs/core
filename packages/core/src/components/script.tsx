import { h, type Child } from "../jsx.js";
import { Head } from "./head.js";
import type { ScriptProps } from "./types.js";

/** Escapes inline script content so SSR output stays valid without breaking closing tags. */
function escapeInlineScript(value: string): string {
  return value
    .replace(/</g, "\\u003c")
    .replace(/-->/g, "--\\u003e")
    .replace(/<\/script/gi, "<\\/script");
}

/** Serializes the inline payload for normal scripts or JSON-LD blocks. */
function getInlineScriptContent(props: ScriptProps): string | null {
  if (props.json !== undefined) {
    return escapeInlineScript(JSON.stringify(props.json));
  }
  if (props.content !== undefined) {
    return escapeInlineScript(props.content);
  }
  return null;
}

/** Builds the head nodes for preload and the final script tag. */
function renderScriptNodes(props: ScriptProps): Child[] {
  const nodes: Child[] = [];
  if (props.preload && props.src) {
    nodes.push(
      h("link", {
        rel: "preload",
        as: "script",
        href: props.src,
        crossorigin: props.crossOrigin
      })
    );
  }

  const inlineContent = getInlineScriptContent(props);
  nodes.push(
    h(
      "script",
      {
        src: props.src,
        type:
          props.module
            ? "module"
            : props.type ?? (props.json !== undefined && !props.src ? "application/ld+json" : undefined),
        async: props.async,
        defer: props.defer,
        nomodule: props.noModule || undefined,
        id: props.id,
        nonce: props.nonce,
        integrity: props.integrity,
        crossorigin: props.crossOrigin,
        referrerpolicy: props.referrerPolicy,
        fetchpriority: props.fetchPriority
      },
      inlineContent
    )
  );

  return nodes;
}

/** Injects external or inline scripts into the document head for CSR and SSR flows. */
export function Script(props: ScriptProps): Child {
  const nodes = renderScriptNodes(props);
  if (typeof document === "undefined") {
    return nodes;
  }
  return h(Head, {
    children: nodes
  });
}
