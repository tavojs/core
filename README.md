# Tavo

**The Frontend Framework for Complete Web Apps**

Build CSR and SSR TypeScript applications with file-based routing, reactive stores, MVC components, and production tooling.

## Quick Start

Requirements: Node.js `^20.19.0 || >=22.12.0`.

Node 18 is not supported because Tavo uses Vite 7. Vite 7 requires this Node range and relies on
Node's newer unflagged `require(esm)` behavior; see the
[Vite 7 migration guide](https://v7.vite.dev/guide/migration.html).

```bash
npx @tavojs/cli@latest create app my-app
cd my-app
npm install
npm run dev
```

The generated app includes the Tavo runtime, Vite configuration, file-based pages, and development/build scripts.

## Minimal App

The browser entry boots the pages in `src/pages`:

```tsx
// src/main.tsx
import { bootTavo } from "@tavojs/core";
import "./styles.css";

void bootTavo();
```

Create a home page:

```tsx
// src/pages/index.tsx
export const head = <title>Home</title>;

export default function HomePage() {
  return <main>Hello from Tavo</main>;
}
```

`bootTavo()` mounts a CSR document or hydrates server-rendered HTML in the browser. In a
programmatic Node entry it can create a request handler from explicitly supplied page modules; the
generated production server uses the focused handler from `@tavojs/core/server`.

## What Is Included

- File-based pages, nested layouts, route groups, and typed route parameters
- Loaders, middleware, actions, forms, resources, and server module boundaries
- Reactive local and global stores
- MVC components through `createTavo()` and `TavoController`
- SSR, hydration, static generation, revalidation, and deferred streaming
- SEO, image, font, script, styling, localization, and plugin APIs
- CLI workflows for generation, diagnostics, builds, previews, and production verification
- Token-bounded AI context, targeted inspection, transactional change plans, and agent evaluation gates
- Secure defaults for output escaping, redirects, request origins, sessions, headers, and remote images

## Documentation

Start with the task-first documentation at [tavojs.dev/docs](https://tavojs.dev/docs). The
[repository documentation index](./docs/README.md) provides the version-matched technical reference
for this source checkout.

- [Getting Started](./docs/getting-started.md)
- [Configuration](./docs/configuration.md)
- [Routing and Pages](./docs/routing-and-pages.md)
- [MVC Components](./docs/mvc-components.md)
- [Stores](./docs/stores.md)
- [SSR and Hydration](./docs/ssr-and-hydration.md)
- [Security](./docs/security.md)
- [Plugins](./docs/plugins.md)
- [Plugin Architecture](./docs/plugins-architecture.md)
- [CLI and Build Workflow](./docs/cli-and-build.md)
- [Deployment Overview](./docs/deployment-overview.md)

## Common Commands

Run these inside a Tavo application:

```bash
tavo dev
tavo dev --ssr
tavo build
tavo preview --ssr
tavo routes
tavo check
tavo doctor
```

Run `tavo --help` for generation, inspection, monitoring, and verification commands.

## Repository Development

```bash
npm install
npm run build
npm run test:integration
npm run test:cli
npm run test:compat
npm run test:e2e
npm run test:agent
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) before changing framework behavior or public APIs.
Maintainers should follow [docs/releasing.md](./docs/releasing.md) for versioning and npm publication.

## Packages

- [`@tavojs/core`](./packages/core/README.md): runtime, framework, router, SSR, stores, and component APIs
- [`@tavojs/cli`](./packages/cli/README.md): application scaffolding, development, build, inspection, and verification CLI

## License

MIT
