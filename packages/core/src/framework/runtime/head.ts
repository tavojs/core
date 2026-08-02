import type { Child } from "../../jsx.js";
import { h } from "../../jsx.js";
import { renderToString } from "../../render/static.js";
import { renderSeoNodes } from "../../components/seo.js";
import {
  createSeoRegistry,
  withSeoRegistry,
} from "../../components/seo-registry.js";
import type { PageHead, PageHeadExport } from "../types.js";

const HEAD_HTML_SEGMENTS = Symbol("tavo.head-html-segments");

type InternalPageHead = PageHead & {
  [HEAD_HTML_SEGMENTS]?: readonly {
    key?: string;
    html: string;
  }[];
};

type HeadHtmlSegment = {
  key?: string;
  html: string;
};

function dedupeManagedHeadSegments(
  segments: readonly HeadHtmlSegment[],
): HeadHtmlSegment[] {
  const lastManagedIndex = new Map<string, number>();
  segments.forEach((segment, index) => {
    if (segment.key) {
      lastManagedIndex.set(segment.key, index);
    }
  });
  return segments.filter(
    (segment, index) =>
      !segment.key || lastManagedIndex.get(segment.key) === index,
  );
}

function isPageHeadObject(value: PageHeadExport): value is PageHead {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (
    "title" in value ||
    "unsafeHeadHtml" in value ||
    "status" in value ||
    "htmlAttributes" in value ||
    "bodyAttributes" in value
  );
}

function isVNode(value: Child): value is Exclude<Child, unknown[]> & { type: unknown; props: { children?: Child[] } } {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      "type" in value &&
      "props" in value
  );
}

function extractTextContent(value: Child): string {
  if (value === undefined || value === null || value === false || value === true) {
    return "";
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  if (Array.isArray(value)) {
    return value.map(extractTextContent).join("");
  }
  if (!isVNode(value)) {
    return "";
  }
  return extractTextContent(value.props.children ?? []);
}

function extractTitleText(value: Child): string | undefined {
  if (Array.isArray(value)) {
    const titles = value
      .map(extractTitleText)
      .filter((part): part is string => part !== undefined);
    return titles.length > 0 ? titles.join("") : undefined;
  }
  if (!isVNode(value)) {
    return undefined;
  }
  if (value.type === "title") {
    return extractTextContent(value.props.children ?? []);
  }
  return extractTitleText(value.props.children ?? []);
}

function removeTitleNodes(value: Child): Child {
  if (Array.isArray(value)) {
    return value
      .map(removeTitleNodes)
      .filter((child) => child !== undefined && child !== null && child !== false);
  }
  if (!isVNode(value)) {
    return value;
  }
  if (value.type === "title") {
    return null;
  }
  return h(value.type as Parameters<typeof h>[0], value.props, removeTitleNodes(value.props.children ?? []));
}

export function normalizeHead(value: PageHeadExport | undefined): PageHead {
  if (value === undefined || value === null || value === false || value === true) {
    return {};
  }
  if (isPageHeadObject(value)) {
    return value;
  }
  const title = extractTitleText(value);
  const headNode = removeTitleNodes(value);
  const seoRegistry = createSeoRegistry({ capturePositions: true });
  const renderedHeadHtml = withSeoRegistry(
    seoRegistry,
    () => renderToString(headNode),
  );
  const seo = seoRegistry.value();
  const headHtmlSegments: HeadHtmlSegment[] = [];
  const seoSegmentsFor = (
    props: NonNullable<typeof seo>,
  ): Array<{ key: string; html: string }> => {
    const segments: Array<{ key: string; html: string }> = [];
    for (const node of renderSeoNodes(props)) {
      if (!isVNode(node)) {
        continue;
      }
      const key = (node.props as Record<string, unknown>)["data-tavo-head"];
      if (typeof key === "string") {
        segments.push({ key, html: renderToString(node) });
      }
    }
    return segments;
  };
  const lastChangePosition = new Map<string, string>();
  let previousSeoHtml = new Map<string, string>();
  for (const entry of seoRegistry.entries()) {
    if (!entry.position) {
      continue;
    }
    const currentSeoHtml = new Map(
      seoSegmentsFor(entry.value).map((segment) => [segment.key, segment.html]),
    );
    const keys = new Set([
      ...previousSeoHtml.keys(),
      ...currentSeoHtml.keys(),
    ]);
    for (const key of keys) {
      if (previousSeoHtml.get(key) !== currentSeoHtml.get(key)) {
        if (currentSeoHtml.has(key)) {
          lastChangePosition.set(key, entry.position);
        } else {
          lastChangePosition.delete(key);
        }
      }
    }
    previousSeoHtml = currentSeoHtml;
  }
  const positionedSeoSegments = new Map<string, HeadHtmlSegment[]>();
  const unpositionedSeoSegments: HeadHtmlSegment[] = [];
  for (const segment of seo ? seoSegmentsFor(seo) : []) {
    const position = lastChangePosition.get(segment.key);
    if (!position) {
      unpositionedSeoSegments.push(segment);
      continue;
    }
    const positioned = positionedSeoSegments.get(position) ?? [];
    positioned.push(segment);
    positionedSeoSegments.set(position, positioned);
  }
  const positionPattern =
    /<template data-tavo-seo-position="(\d+)"><\/template>/g;
  const positions = Array.from(renderedHeadHtml.matchAll(positionPattern));
  let cursor = 0;
  positions.forEach((position) => {
    const offset = position.index ?? cursor;
    const rawHtml = renderedHeadHtml.slice(cursor, offset);
    if (rawHtml) {
      headHtmlSegments.push({ html: rawHtml });
    }
    const positionId = position[1] ?? "";
    const positioned = positionedSeoSegments.get(positionId);
    if (positioned) {
      headHtmlSegments.push(...positioned);
    }
    cursor = offset + position[0].length;
  });
  const trailingHtml = renderedHeadHtml.slice(cursor);
  if (trailingHtml) {
    headHtmlSegments.push({ html: trailingHtml });
  }
  headHtmlSegments.push(...unpositionedSeoSegments);
  const mergedHeadHtmlSegments =
    dedupeManagedHeadSegments(headHtmlSegments);
  const unsafeHeadHtml = mergedHeadHtmlSegments
    .map((segment) => segment.html)
    .join("");
  return {
    ...(title || seo?.title ? { title: title ?? seo?.title } : {}),
    ...(unsafeHeadHtml ? { unsafeHeadHtml } : {}),
    [HEAD_HTML_SEGMENTS]: mergedHeadHtmlSegments,
  } as InternalPageHead;
}

export function mergeHead(base: PageHead, next: PageHead): PageHead {
  if (
    next.title === undefined &&
    next.unsafeHeadHtml === undefined &&
    next.status === undefined &&
    next.htmlAttributes === undefined &&
    next.bodyAttributes === undefined
  ) {
    return base;
  }
  const baseInternal = base as InternalPageHead;
  const nextInternal = next as InternalPageHead;
  const headHtmlSegments = [
    ...(baseInternal[HEAD_HTML_SEGMENTS]
      ?? (base.unsafeHeadHtml ? [{ html: base.unsafeHeadHtml }] : [])),
    ...(nextInternal[HEAD_HTML_SEGMENTS]
      ?? (next.unsafeHeadHtml ? [{ html: next.unsafeHeadHtml }] : [])),
  ];
  const mergedHeadHtmlSegments =
    dedupeManagedHeadSegments(headHtmlSegments);
  const unsafeHeadHtml = mergedHeadHtmlSegments
    .map((segment) => segment.html)
    .join("");
  return {
    title: next.title ?? base.title,
    status: next.status ?? base.status,
    ...(unsafeHeadHtml ? { unsafeHeadHtml } : {}),
    htmlAttributes: { ...(base.htmlAttributes ?? {}), ...(next.htmlAttributes ?? {}) },
    bodyAttributes: { ...(base.bodyAttributes ?? {}), ...(next.bodyAttributes ?? {}) },
    [HEAD_HTML_SEGMENTS]: mergedHeadHtmlSegments,
  } as InternalPageHead;
}
