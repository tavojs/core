import { configureDevDiagnostics, setDevOverlayHandler } from "./diagnostics-core.js";

/** Formats an unknown error into readable overlay text. */
function formatError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}\n${error.stack ?? ""}`;
  }
  return String(error);
}

/** Renders the browser error overlay used only in development. */
export function showDevErrorOverlay(error: unknown): void {
  if (typeof document === "undefined") {
    return;
  }

  const id = "__tavo_dev_error_overlay__";
  let overlay = document.getElementById(id);
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = id;
    overlay.setAttribute(
      "style",
      [
        "position:fixed",
        "z-index:2147483647",
        "inset:0",
        "padding:16px",
        "overflow:auto",
        "background:rgba(10,10,10,0.92)",
        "color:#fff",
        "font:13px/1.5 ui-monospace,Menlo,Monaco,Consolas,monospace",
        "white-space:pre-wrap"
      ].join(";")
    );
    overlay.addEventListener("click", () => {
      overlay?.remove();
    });
    document.body.appendChild(overlay);
  }

  overlay.textContent = `tavo runtime error (click to dismiss)\n\n${formatError(error)}`;
}

/** Enables a browser overlay for runtime errors and hydration mismatches during development. */
export function installDevOverlay(options?: { traces?: boolean }): void {
  setDevOverlayHandler(showDevErrorOverlay);
  configureDevDiagnostics({
    enabled: options?.traces ?? true,
    devMode: true,
    onError(error) {
      showDevErrorOverlay(error);
    },
    onHydrationMismatch(event) {
      showDevErrorOverlay(
        new Error(
          [
            event.message,
            event.expected ? `expected: ${event.expected}` : "",
            event.found ? `found: ${event.found}` : "",
            event.path ? `path: ${event.path}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        )
      );
    }
  });
}
