# Deploying To Node

> Online guide: [tavojs.dev/docs/core/node-runtime](https://tavojs.dev/docs/core/node-runtime)

Use the generated Node server when the application needs request-time rendering, actions, server
loaders, sessions, revalidation, streaming, image optimization, or monitoring.

## Build And Run

```bash
tavo build
node .tavo/build/server/start.mjs
```

The server defaults to `HOST=127.0.0.1` and `PORT=4174`. Override them with environment variables:

```bash
HOST=0.0.0.0 PORT=3000 node .tavo/build/server/start.mjs
```

Run one generated server entry per process. Tavo initializes the application plugin runtime once
and reuses its process-local caches across requests.

## Project Configuration

Server options live in the `ssr` section of the single root configuration file:

```ts
// tavo.config.ts
import { defineConfig } from "@tavojs/core/config";

export default defineConfig({
  ssr: {
    trustedHosts: ["example.com", "www.example.com"],
    canonicalOrigin: "https://example.com",
    maxRequestBodyBytes: 1024 * 1024,
  },
});
```

Use `canonicalOrigin` when a trusted reverse proxy terminates TLS. Keep `trustedHosts` narrow so an
untrusted inbound `Host` header cannot define the origin used for action checks.

## Operations

- Re-run `tavo build` before starting production after application changes.
- Set `TAVO_MONITOR_TOKEN` in the server environment before using `tavo monitor`; the CLI sends it
  only in the `Authorization: Bearer ...` header.
- The default static/revalidation cache is process-local. Provide an application cache adapter
  when multiple processes must share cached responses.
- Terminate TLS, set a Content Security Policy, and configure request limits at the reverse proxy.
- If progressive streaming uses inline patch scripts, pass a nonce through document rendering and
  include it in `script-src`.
