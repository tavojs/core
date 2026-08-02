import type { PageMiddleware, PageModuleRecord } from "../types.js";
export {
  normalizePageModuleRecord as normalizeModuleRecord,
} from "../manifest.js";

export function flattenMiddlewares(
  middleware: PageMiddleware | PageMiddleware[] | undefined
): PageMiddleware[] {
  if (!middleware) {
    return [];
  }
  return Array.isArray(middleware) ? middleware : [middleware];
}

export function hasCsrIncompatibleStaticOptions(modules: PageModuleRecord[]): boolean {
  return modules.some((module) =>
    module.prerender === true ||
    module.static === true ||
    module.revalidate !== undefined ||
    module.vary !== undefined ||
    typeof module.generateStaticParams === "function"
  );
}

export function hasDynamicHead(modules: PageModuleRecord[]): boolean {
  return modules.some((module) => typeof module.head === "function");
}
