import { startViteAutoPagesDevServer } from "@tavojs/core/dev";
import path from "node:path";
import { fileURLToPath } from "node:url";

const port = Number(process.env.PORT || 4174);
const root = path.dirname(fileURLToPath(import.meta.url));
const running = await startViteAutoPagesDevServer({
  port,
  root
});

// eslint-disable-next-line no-console
console.log(`preview unified SSR running at ${running.url}`);
