import type { CsrActionsOptions } from "../framework/types.js";
import type { RouterNavigateOptions } from "../router/index.js";
import { isSsrDocument } from "../runtime/ssr-document.js";
import type { ResolveTavoActionUrlOptions } from "./types.js";

type Navigate = (to: string, options?: RouterNavigateOptions) => void;

let activeCsrActions: CsrActionsOptions | null = null;
let activeNavigate: Navigate | null = null;
let activeCanonicalize: ((to: string) => string) | null = null;
let formInterceptorDocument: Document | null = null;
let warnedMissingCsrActions = false;

function readFormMethod(form: HTMLFormElement): string {
  return (form.getAttribute("method") || form.method || "GET").toUpperCase();
}

function readFormTarget(form: HTMLFormElement): string {
  return form.getAttribute("target") || form.target || "";
}

function resolveFormActionContext(form: HTMLFormElement): {
  pathname: string;
  search: string;
  explicitExternal: boolean;
} | null {
  if (typeof window === "undefined") {
    return null;
  }
  const rawAction = form.getAttribute("action");
  const action = rawAction && rawAction.trim()
    ? rawAction
    : `${window.location.pathname}${window.location.search}`;
  try {
    const url = new URL(action, window.location.href);
    return {
      pathname: url.pathname || "/",
      search: url.search,
      explicitExternal: Boolean(rawAction && rawAction.trim() && url.origin !== window.location.origin),
    };
  } catch {
    return null;
  }
}

function resolveCsrActionUrl(
  form: HTMLFormElement | undefined,
  options: CsrActionsOptions,
  context: { pathname: string; search: string },
): string {
  const actionContext = {
    pathname: context.pathname,
    search: context.search,
    form,
  };
  if (options.resolveUrl) {
    return options.resolveUrl(actionContext);
  }
  const pathWithSearch = `${context.pathname}${context.search}`;
  if (options.baseUrl) {
    return new URL(pathWithSearch, options.baseUrl).toString();
  }
  return pathWithSearch;
}

function resolveActionTarget(to: string, search?: string): { pathname: string; search: string } {
  const fallback = to || "/";
  if (typeof window === "undefined") {
    const url = new URL(fallback, "http://localhost");
    return {
      pathname: url.pathname || "/",
      search: search ?? url.search,
    };
  }
  const url = new URL(fallback, window.location.href);
  return {
    pathname: url.pathname || "/",
    search: search ?? url.search,
  };
}

/** Resolves a route action target through the active CSR action mapping, when enabled. */
export function resolveTavoActionUrl(to: string, options?: ResolveTavoActionUrlOptions): string {
  const canonical = activeCanonicalize?.(to) ?? to;
  const target = resolveActionTarget(canonical, options?.search);
  if (typeof window === "undefined" || typeof document === "undefined") {
    return `${target.pathname}${target.search}`;
  }
  const csrActions = activeCsrActions;
  if (!csrActions?.enabled) {
    return `${target.pathname}${target.search}`;
  }
  return resolveCsrActionUrl(options?.form, csrActions, target);
}

function resolveCsrActionHeaders(
  form: HTMLFormElement,
  options: CsrActionsOptions,
  pathname: string
): HeadersInit | undefined {
  if (typeof options.headers === "function") {
    return options.headers({ pathname, form });
  }
  return options.headers;
}

function shouldInterceptFormSubmit(event: SubmitEvent, form: HTMLFormElement): boolean {
  if (event.defaultPrevented) {
    return false;
  }
  const options = activeCsrActions;
  if (!options?.enabled || form.hasAttribute("data-tavo-native")) {
    return false;
  }
  if (readFormMethod(form) === "GET") {
    return false;
  }
  const target = readFormTarget(form);
  if (target && target !== "_self") {
    return false;
  }
  const actionContext = resolveFormActionContext(form);
  return Boolean(actionContext && !actionContext.explicitExternal);
}

function shouldWarnMissingCsrActions(event: SubmitEvent, form: HTMLFormElement): boolean {
  if (event.defaultPrevented || warnedMissingCsrActions || activeCsrActions?.enabled) {
    return false;
  }
  if (typeof document === "undefined" || isSsrDocument() || form.hasAttribute("data-tavo-native")) {
    return false;
  }
  if (readFormMethod(form) === "GET") {
    return false;
  }
  const target = readFormTarget(form);
  return !target || target === "_self";
}

async function submitCsrActionForm(form: HTMLFormElement): Promise<void> {
  const options = activeCsrActions;
  const actionContext = options ? resolveFormActionContext(form) : null;
  if (!options || !actionContext) {
    return;
  }
  const response = await fetch(resolveCsrActionUrl(form, options, actionContext), {
    method: readFormMethod(form),
    headers: resolveCsrActionHeaders(form, options, actionContext.pathname),
    body: new FormData(form),
    credentials: options.credentials ?? "include",
  });
  const redirect = response.redirected ? response.url : response.headers.get("Location");
  if (redirect && typeof window !== "undefined") {
    handleCsrActionRedirect(redirect);
  }
}

function handleCsrActionRedirect(redirect: string): void {
  const url = new URL(redirect, window.location.href);
  if (
    url.origin === window.location.origin &&
    !(url.pathname === window.location.pathname && url.search === window.location.search && url.hash)
  ) {
    activeNavigate?.(`${url.pathname}${url.search}${url.hash}`, { replace: true });
    return;
  }
  window.location.href = redirect;
}

export function configureCsrActions(
  csrActions: CsrActionsOptions | undefined,
  navigate: Navigate,
  canonicalize?: (to: string) => string,
): void {
  activeCsrActions = csrActions ?? null;
  activeNavigate = navigate;
  activeCanonicalize = canonicalize ?? null;
}

export function resetCsrActions(): void {
  activeCsrActions = null;
  activeNavigate = null;
  activeCanonicalize = null;
  warnedMissingCsrActions = false;
}

/** Attaches delegated form handling for static CSR action submissions. */
export function ensureFormInterceptor(): void {
  if (typeof document === "undefined" || formInterceptorDocument === document) {
    return;
  }
  formInterceptorDocument = document;

  document.addEventListener("submit", (event) => {
    const submitEvent = event as SubmitEvent;
    const target = submitEvent.target as Element | null;
    const form = target?.closest("form") as HTMLFormElement | null;
    if (!form) {
      return;
    }
    if (shouldWarnMissingCsrActions(submitEvent, form)) {
      warnedMissingCsrActions = true;
      if (typeof console !== "undefined") {
        console.warn(
          "[tavo csr action] Static CSR form submissions need bootTavo({ csrActions }) " +
            "or a native backend endpoint. Add data-tavo-native to silence this warning for this form.",
        );
      }
    }
    if (!shouldInterceptFormSubmit(submitEvent, form)) {
      return;
    }

    submitEvent.preventDefault();
    void submitCsrActionForm(form).catch((error) => {
      if (typeof console !== "undefined") {
        console.warn("[tavo csr action]", error);
      }
    });
  });
}
