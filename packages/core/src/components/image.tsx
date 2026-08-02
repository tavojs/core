import { h, type Child } from "../jsx.js";
import { isSsrDocument } from "../runtime/ssr-document.js";
import type { ImageFormat, ImageProps } from "./types.js";

const DEFAULT_WIDTHS = [320, 640, 960, 1280, 1600];

function clampQuality(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 75;
  }
  return Math.max(1, Math.min(100, Math.round(value)));
}

function normalizeWidths(width?: number, widths?: number[]): number[] {
  const candidates = new Set<number>();

  for (const candidate of widths ?? DEFAULT_WIDTHS) {
    if (Number.isFinite(candidate) && candidate > 0) {
      candidates.add(Math.round(candidate));
    }
  }

  if (typeof width === "number" && Number.isFinite(width) && width > 0) {
    candidates.add(Math.round(width));
    candidates.add(Math.round(width * 2));
  }

  return Array.from(candidates)
    .filter((candidate) => candidate > 0 && candidate <= 3840)
    .sort((left, right) => left - right);
}

function buildOptimizerUrl(
  src: string,
  width: number,
  quality: number,
  format: ImageFormat
): string {
  const params = new URLSearchParams({
    src,
    w: String(width),
    q: String(quality),
    f: format
  });
  return `/_tavo/image?${params.toString()}`;
}

function shouldUseServerOptimizer(): boolean {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return true;
  }
  return isSsrDocument();
}

/** Returns one optimizer URL for a specific width candidate. */
export function getOptimizedImageUrl(
  src: string,
  width: number,
  options?: { quality?: number; format?: ImageFormat }
): string {
  return buildOptimizerUrl(
    src,
    width,
    clampQuality(options?.quality),
    options?.format ?? "webp"
  );
}

/** SEO-friendly image component that emits responsive SSR optimizer URLs. */
export function Image(props: ImageProps): Child {
  const {
    src,
    alt,
    width,
    height,
    widths,
    sizes,
    quality,
    format = "webp",
    priority = false,
    unoptimized = false,
    loading,
    decoding,
    fetchPriority,
    srcset: providedSrcSet,
    className,
    style,
    ...rest
  } = props;

  const normalizedQuality = clampQuality(quality);
  const candidateWidths = normalizeWidths(width, widths);
  const largestWidth = candidateWidths[candidateWidths.length - 1];
  const useOptimizer = !unoptimized && shouldUseServerOptimizer();
  const computedSrc =
    !useOptimizer || !largestWidth
      ? src
      : buildOptimizerUrl(src, largestWidth, normalizedQuality, format);
  const computedSrcSet =
    !useOptimizer || candidateWidths.length === 0
      ? providedSrcSet
      : candidateWidths
          .map((candidate) => {
            return `${buildOptimizerUrl(src, candidate, normalizedQuality, format)} ${candidate}w`;
          })
          .join(", ");

  return h("img", {
    ...rest,
    src: computedSrc,
    srcset: computedSrcSet,
    sizes: sizes ?? (candidateWidths.length > 0 ? "100vw" : undefined),
    alt,
    width,
    height,
    className,
    style,
    loading: loading ?? (priority ? "eager" : "lazy"),
    decoding: decoding ?? "async",
    fetchpriority: fetchPriority ?? (priority ? "high" : undefined)
  });
}
