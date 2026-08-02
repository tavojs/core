export function createAppMainTsxSource(): string {
  return [
    'import { bootTavo } from "@tavojs/core";',
    'import "./styles.css";',
    "",
    "void bootTavo().catch((error) => {",
    "  console.error(\"[tavo bootstrap error]\", error);",
    "});",
    ""
  ].join("\n");
}
