# Configuration

> Online guide: [tavojs.dev/docs/core/configuration](https://tavojs.dev/docs/core/configuration)

Tavo has two configuration layers: Vite options in `vite.config.ts`, and framework options in the
single root `tavo.config.ts`. The `ssr` name refers to a nested object in `tavo.config.ts`; it is not
a second file.

## Vite Configuration

```ts
// vite.config.ts
import { defineTavoViteConfig } from "@tavojs/core/config";

export default defineTavoViteConfig({
  server: {
    port: 5173,
  },
});
```

`defineTavoViteConfig()` sets the automatic JSX runtime and `@tavojs/core` JSX import source while preserving normal Vite options.

## Framework Configuration

Tavo loads the default export from `tavo.config.ts` in the project root.

```ts
// tavo.config.ts
import { defineConfig } from "@tavojs/core/config";

export default defineConfig({
  pagesDir: "src/pages",
  cssEntries: ["src/styles.css"],
  diagnostics: {
    devOverlay: true,
    traces: false,
  },
  build: {
    budgets: {
      firstLoadJs: "150kb",
      routeJs: "40kb",
    },
  },
  ssr: {
    trustedHosts: ["example.com", "www.example.com"],
    canonicalOrigin: "https://example.com",
    maxRequestBodyBytes: 1024 * 1024,
    maxResolvedCacheEntries: 500,
  },
});
```

### Project Fields

- `pagesDir`: page source directory. The default convention is `src/pages`.
- `cssEntries`: global CSS or Sass entries that SSR and development tooling should load.
- `plugins`: trusted plugin descriptors, optional exposure remapping, and advanced overrides.
- `diagnostics.devOverlay`: enables the development error overlay.
- `diagnostics.traces`: enables framework diagnostic traces.

### Build Budgets

`build.budgets.firstLoadJs` limits initial JavaScript shared by routes. `build.budgets.routeJs` limits JavaScript attributed to an individual route. Values accept bytes or strings such as `150kb` and `1.5mb`.

The production build fails after printing every route that exceeds a configured budget. CLI flags override project configuration for one run:

```bash
tavo build --max-first-load-js 150kb --max-route-js 40kb
```

## SSR Configuration

The `ssr` object accepts the Node request-handler options used by development, preview, and generated server output.

### Hosts and Origins

- `trustedHosts`: allowed inbound host names for Node-style handlers. Configure this for public deployments.
- `canonicalOrigin`: the public HTTPS origin when Node runs behind a TLS-terminating proxy, for example `https://example.com`.
- `allowExternalRedirects`: permits redirect targets outside the request origin. Leave disabled unless targets are independently allowlisted.

`canonicalOrigin` must be an absolute HTTP(S) origin without credentials, a path, query, or fragment. It does not replace `trustedHosts`; the host allowlist still protects inbound requests.

### Request and Render Limits

- `maxRequestBodyBytes`: maximum buffered mutation body for Node actions and plugin handlers. The default is 10 MiB.
- `maxResolvedCacheEntries`: maximum process-local cache entries for resolved static loader data. Set `0` to disable reuse. Use a finite limit in long-running processes.
- `stream`: enables streamed SSR responses in the generated Node server.
- `staticCache`: supplies an application-managed cache for static SSR/revalidation responses.

Page runtime options such as `modules`, `middleware`, `getPageProps`, `csrFallback`, and `i18n` can
also be set under `ssr` when server behavior needs explicit configuration. Plugins belong only in
the top-level `plugins` field.

## Plugin Configuration

Plugin API v1 treats installation as consent to the permissions and default exposure declared in
the plugin manifest:

```ts
export default defineConfig({
  plugins: [
    databasePlugin,
    analyticsPlugin,
    {
      plugin: sitemapPlugin,
      instanceId: "public",
      expose: { server: "/seo" },
    },
  ],
});
```

- A plugin descriptor installs its default instance and enables its manifest-declared authority.
- `{ plugin, instanceId, enabled }` configures an installation without repeating its plugin ID.
- Installing a plugin enables its manifest-declared permissions and default exposure.
- `expose.page` and `expose.server` remap declared plugin trees. A string moves the complete tree;
  `{ from, to }` remaps a subtree.

Advanced overrides remain available without exposing all low-level registration arrays:

```ts
export default defineConfig({
  plugins: {
    use: [dashboardPlugin],
    overrides: [
      {
        kind: "page",
        key: "/dashboard",
        replace: { plugin: "@acme/dashboard" },
        with: { owner: "app" },
      },
    ],
  },
});
```

The compiler's normalized installation, mount, permission, and override collections are internal.
Application code should not construct them or grant permissions that a plugin failed to declare.

All plugin configuration is compiled before any phase module or factory executes. Invalid graphs
stop dev, verification, build, and production startup. `/_tavo/*` and framework-owned keys cannot
be mounted or overridden.

See [Plugins](./plugins.md) for authoring and [Plugin Architecture](./plugins-architecture.md) for
the canonical ownership and collision contract.

## Image Optimization

Remote images are disabled by default. Enable them only with a narrow allowlist:

```ts
import { defineConfig } from "@tavojs/core/config";

export default defineConfig({
  ssr: {
    images: {
      allowRemote: true,
      remotePatterns: [
        {
          protocol: "https:",
          hostname: "images.example.com",
          pathname: "/media",
        },
      ],
      maxBytes: 8 * 1024 * 1024,
      timeoutMs: 5_000,
      memoryCacheMaxEntries: 100,
      maxConcurrentTransforms: 4,
      maxPendingTransforms: 32,
    },
  },
});
```

Important fields:

- `remotePatterns`: allowed protocol, host, optional port, and pathname prefix.
- `publicDir`: local image root.
- `quality`, `defaultFormat`, and `sizes`: output behavior.
- `cacheMaxAge`: browser/cache response lifetime.
- `timeoutMs` and `maxBytes`: remote fetch limits.
- `memoryCacheMaxEntries`: process-local transformed-image cache bound.
- `maxConcurrentTransforms`: simultaneous image transformations.
- `maxPendingTransforms`: queued transformations before overload requests are rejected.
- `allowInsecureRemote`: allows HTTP remote images. Avoid this in production.

Restart the SSR development server after changing image configuration because optimizer options are loaded at startup.

## Development Diagnostics

Configure application-specific diagnostic callbacks through the development entry point:

```ts
import { configureDevDiagnostics } from "@tavojs/core/dev";

configureDevDiagnostics({
  enabled: true,
  devMode: true,
  strictHydration: false,
  onHydrationMismatch(event) {
    console.warn(event);
  },
  onError(error) {
    console.error(error);
  },
});
```

Set `strictHydration: true` in CI or browser tests to throw a coded `TAVO_HYDRATION_001` error on the first mismatch. Normal development mode reports whether Tavo recovered text, a subtree, or extra-node cleanup without failing the application.

## Next Reading

- [Environment Variables](./environment-variables.md)
- [Routing and Pages](./routing-and-pages.md)
- [SSR and Hydration](./ssr-and-hydration.md)
- [Security](./security.md)
