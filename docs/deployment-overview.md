# Deployment Overview

> Online guide: [tavojs.dev/docs/core/deployment](https://tavojs.dev/docs/core/deployment)

Tavo produces two provider-neutral deployment outputs:

- `.tavo/build/client` contains browser assets and prerendered HTML for static hosting.
- `.tavo/build/server/start.mjs` is the generated Node production server.

Both outputs are created by:

```bash
tavo build
```

## Choose An Output

Use static hosting when every route is either prerendered or client-rendered and server-side route
actions, loaders, sessions, revalidation, and monitoring are unnecessary. Deploy only
`.tavo/build/client`; see [Static Hosting](./deployment-static.md).

Use the Node output for request-time rendering, route actions, server loaders, sessions,
revalidation, streaming, image optimization, or the monitor endpoint. Start
`.tavo/build/server/start.mjs`; see [Node](./deployment-node.md).

Configure the selected output using standard static-directory or Node-process settings.

## Useful Build Artifacts

- `.tavo/generated/route-manifest.json`
- `.tavo/generated/routes.d.ts`
- `.tavo/generated/build-report.json` when built with `--report-json`
- `.tavo/build/build-manifest.json`

Treat generated files as build artifacts. Re-run `tavo build` instead of editing them.

## Production Checklist

1. Run the complete verification suite and `tavo build`.
2. Choose either `.tavo/build/client` or `.tavo/build/server/start.mjs`.
3. For Node, configure `trustedHosts`, `canonicalOrigin`, and `TAVO_MONITOR_TOKEN`.
4. Add a Content Security Policy and transport security at the reverse proxy or hosting edge.
5. Verify direct route loads, assets, error pages, mutations, and any host fallback rules.
