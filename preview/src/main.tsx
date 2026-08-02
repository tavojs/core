import { bootTavo } from "@tavojs/core";
import { previewMiddleware } from "./runtime-config.ts";
import { i18n } from "./i18n/index.ts";

import {
  attachPreviewRuntime,
  pushMismatch
} from "./store/index.js";

import "./styles.css";

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
  rootSelector: "#app",
  middleware: previewMiddleware(),
  i18n
}).catch((error) => {
  console.error("[tavo preview bootstrap error]", error);
});
