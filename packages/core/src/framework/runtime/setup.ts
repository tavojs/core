import { TavoError } from "../../diagnostics.js";
import {
  DEFAULT_I18N_SERVICE_NAME,
  type AnyI18nService
} from "../../i18n/index.js";
import type { RouterParams } from "../../router/index.js";
import type { NormalizedPageRequest } from "../../ssr/request.js";
import { getService, hasService } from "../services.js";
import type { PageMiddleware, PageModuleRecord } from "../types.js";
import { isClientRuntime } from "./rendering.js";

const DEFAULT_MAX_RESOLVED_CACHE_ENTRIES = 1_024;

export function normalizeResolvedCacheLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_MAX_RESOLVED_CACHE_ENTRIES;
  if (!Number.isFinite(value) || value < 0) {
    throw new TavoError(
      "TAVO_PAGES_001",
      "tavo pages: maxResolvedCacheEntries must be a finite non-negative number.",
      {
        details: { value },
        hint: "Use 0 to disable reuse, or provide a finite positive entry limit."
      }
    );
  }
  return Math.floor(value);
}

export function getRegisteredDefaultI18nService(): AnyI18nService | undefined {
  return hasService(DEFAULT_I18N_SERVICE_NAME)
    ? getService<AnyI18nService>(DEFAULT_I18N_SERVICE_NAME)
    : undefined;
}

export async function runMiddlewares(
  middleware: PageMiddleware[],
  context: {
    to: string;
    from?: string;
    params: RouterParams;
    signal: AbortSignal;
  } & NormalizedPageRequest
): Promise<{ redirect: string; status: number } | null> {
  const currentRuntime = isClientRuntime() ? "client" : "server";
  for (const fn of middleware) {
    context.request.signal.throwIfAborted();
    const runtime = fn.__tavo_middleware_options__?.runtime ?? "both";
    if (runtime !== "both" && runtime !== currentRuntime) continue;
    const result = await fn(context);
    context.request.signal.throwIfAborted();
    if (result && typeof result.redirect === "string") {
      return { redirect: result.redirect, status: result.status ?? 302 };
    }
  }
  return null;
}

export function shouldRunLoader(load: PageModuleRecord["load"]): boolean {
  const loaderRuntime = load?.__tavo_loader_options__?.runtime ?? "both";
  if (loaderRuntime === "both") return true;
  return loaderRuntime === (isClientRuntime() ? "client" : "server");
}
