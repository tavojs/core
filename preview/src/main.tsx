import { bootTavo } from "@tavojs/core";
import { inspectPages } from "@tavojs/core/dev";
import { previewMiddleware } from "./runtime-config.ts";
import { i18n } from "./i18n/index.ts";

import {
  attachPreviewRuntime,
  pushMismatch
} from "./store/index.js";

import "./styles.css";

const pageModules = import.meta.glob("/src/pages/**/*.{js,jsx,ts,tsx}");
const inspection = inspectPages(pageModules);

if (inspection.diagnostics.length > 0) {
  // eslint-disable-next-line no-console
  console.warn("[tavo pages diagnostics]", inspection.diagnostics);
}

if (import.meta.env.DEV) {
  const { configureDevDiagnostics } = await import("@tavojs/core/dev");
  configureDevDiagnostics({
    enabled: true,
    devMode: true,
    onHydrationMismatch(event) {
      pushMismatch(event);
      console.warn("[tavo hydration mismatch]", event);
    },
    onError(error) {
      console.error("[tavo runtime error]", error);
    }
  });
}

attachPreviewRuntime();

void bootTavo({
  modules: pageModules,
  rootSelector: "#app",
  middleware: previewMiddleware(),
  i18n
}).catch((error) => {
  console.error("[tavo preview bootstrap error]", error);
});
