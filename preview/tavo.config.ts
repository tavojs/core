import { defineConfig } from "@tavojs/core/config";
import { i18n } from "./src/i18n/index.ts";
import { previewMiddleware } from "./src/runtime-config.ts";

export default defineConfig({
  pagesDir: "src/pages",
  cssEntries: ["src/styles.css"],
  ssr: {
    middleware: previewMiddleware(),
    i18n,
    stream: true,
    document: {
      title: "tavo preview",
      unsafeHeadHtml: [
        '<meta name="x-preview-runtime" content="tavo-preview">',
        '<script type="module" src="/src/main.tsx"></script>',
      ].join(""),
    },
  },
});
