import { h, type Child } from "../jsx.js";
import { Head } from "./head.js";
import { getActiveSeoRegistry } from "./seo-registry.js";
import type { SeoProps } from "./types.js";

/** Normalizes keyword input into the comma-separated format used by meta tags. */
function normalizeKeywords(value: SeoProps["keywords"]): string | undefined {
  if (Array.isArray(value)) {
    return value.filter(Boolean).join(", ");
  }
  return value;
}

/** Computes the robots directive string from explicit and boolean SEO flags. */
function resolveRobots(props: SeoProps): string | undefined {
  if (props.robots) {
    return props.robots;
  }
  const directives: string[] = [];
  if (props.noIndex) {
    directives.push("noindex");
  }
  if (props.noFollow) {
    directives.push("nofollow");
  }
  return directives.length > 0 ? directives.join(", ") : undefined;
}

/** Appends a standard meta tag only when the content is present. */
function pushMeta(nodes: Child[], name: string, content: string | undefined): void {
  if (!content) {
    return;
  }
  nodes.push(h("meta", { name, content, "data-tavo-head": `meta:name:${name}` }));
}

/** Appends an Open Graph meta tag when the value is present. */
function pushProperty(nodes: Child[], property: string, content: string | undefined): void {
  if (!content) {
    return;
  }
  nodes.push(h("meta", { property, content, "data-tavo-head": `meta:property:${property}` }));
}

/** Builds the head metadata nodes for a single SEO declaration block. */
export function renderSeoNodes(props: SeoProps): Child[] {
  const nodes: Child[] = [];
  const keywords = normalizeKeywords(props.keywords);
  const robots = resolveRobots(props);
  const openGraph = props.openGraph;
  const twitter = props.twitter;

  pushMeta(nodes, "description", props.description);
  pushMeta(nodes, "keywords", keywords);
  pushMeta(nodes, "author", props.author);
  pushMeta(nodes, "robots", robots);
  pushMeta(nodes, "theme-color", props.themeColor);

  if (props.canonical) {
    nodes.push(h("link", {
      rel: "canonical",
      href: props.canonical,
      "data-tavo-head": "link:canonical"
    }));
  }

  pushProperty(nodes, "og:title", openGraph?.title ?? props.title);
  pushProperty(nodes, "og:description", openGraph?.description ?? props.description);
  pushProperty(nodes, "og:type", openGraph?.type);
  pushProperty(nodes, "og:url", openGraph?.url ?? props.canonical);
  pushProperty(nodes, "og:image", openGraph?.image);
  pushProperty(nodes, "og:image:alt", openGraph?.imageAlt);
  pushProperty(nodes, "og:site_name", openGraph?.siteName);
  pushProperty(nodes, "og:locale", openGraph?.locale);

  pushMeta(nodes, "twitter:card", twitter?.card);
  pushMeta(nodes, "twitter:title", twitter?.title ?? props.title);
  pushMeta(nodes, "twitter:description", twitter?.description ?? props.description);
  pushMeta(nodes, "twitter:image", twitter?.image ?? openGraph?.image);
  pushMeta(nodes, "twitter:creator", twitter?.creator);
  pushMeta(nodes, "twitter:site", twitter?.site);

  return nodes;
}

/** Injects common SEO metadata into the document head for CSR and SSR apps. */
export function Seo(props: SeoProps): Child {
  const registry = getActiveSeoRegistry();
  if (registry) {
    const position = registry.add(props);
    return position
      ? h("template", { "data-tavo-seo-position": position })
      : null;
  }
  if (typeof document === "undefined") {
    return null;
  }
  const nodes = renderSeoNodes(props);
  return h(Head, {
    title: props.title,
    children: nodes
  });
}
