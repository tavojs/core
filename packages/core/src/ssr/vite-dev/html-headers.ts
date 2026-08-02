import type { ResponseHeaders } from "../headers.js";

/** Prevents browsers from retaining rendered development HTML across HMR updates. */
export function withViteDevHtmlHeaders(headers: ResponseHeaders): ResponseHeaders {
  const next: ResponseHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== "cache-control") {
      next[name] = value;
    }
  }
  next["Cache-Control"] = "no-store";
  return next;
}
