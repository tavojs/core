# Tavo Framework Documentation

These version-matched repository guides document Tavo Framework 1.x. Use
[tavojs.dev/docs](https://tavojs.dev/docs) for the task-first website, tutorials, searchable API
inventory, Tavo UI documentation, and the broader ecosystem. Use this directory when you need the
technical contract that ships with a specific Framework checkout.

## Choose A Documentation Path

- **Build one application:** follow the
  [first-app tutorial](https://tavojs.dev/docs/getting-started/first-app) on tavojs.dev.
- **Solve a focused task:** browse the
  [Framework guides](https://tavojs.dev/docs/core) or the sections below.
- **Look up an exact symbol:** use the
  [online Core API](https://tavojs.dev/docs/core/api) or the
  [declaration-generated repository reference](./api-reference.md).
- **Work on the CLI:** use the [CLI documentation](https://tavojs.dev/docs/cli) and
  [CLI and Build Workflow](./cli-and-build.md).

## Start Here

1. [Getting Started](./getting-started.md) — create an app, inspect the generated model, and verify
   CSR and SSR.
2. [Configuration](./configuration.md) — configure Vite, pages, diagnostics, SSR, caching, and images.
3. [Environment Variables](./environment-variables.md) — separate server secrets, browser-safe
   values, and build configuration.
4. [Routing and Pages](./routing-and-pages.md) — pages, layouts, route groups, parameters, and navigation.

## Build Application Features

- [MVC Components](./mvc-components.md) — component models, controllers, lifecycle, refs, focus, and directives.
- [Scheduling](./scheduling.md) — update priorities, background transitions, and synchronous rendering.
- [Stores](./stores.md) — reactive state, selectors, persistence, and global stores.
- [Data Loading and Middleware](./data-loading-and-middleware.md) — loaders, middleware, resources, actions, and forms.
- [Async Work and Cancellation](./async-and-cancellation.md) — ownership, deduplication, aborts, and stale-result rules.
- [Validation](./validation.md) — portable schema adapters and typed validated actions.
- [Styling](./styling.md) — global CSS, modules, Sass, inline styles, and SSR behavior.
- [SEO and Assets](./seo-and-assets.md) — document head, metadata, images, fonts, SVGs, and scripts.
- [Localization](./localization.md) — translations, typed keys, locale routing, and SSR detection.
- [Plugins](./plugins.md) — owned capabilities, lifecycle, routing, and graph validation.
- [Plugin Architecture](./plugins-architecture.md) — canonical ownership, collision, lifecycle, security, and implementation contract.

## Server Rendering and Production

- [SSR and Hydration](./ssr-and-hydration.md) — Node request handling, hydration, and static caching.
- [Streaming and Deferred Rendering](./streaming-and-deferred.md) — streamed boundaries, timeouts, and CSP.
- [Security](./security.md) — production hardening, origins, sessions, images, headers, and monitoring.
- [CLI and Build Workflow](./cli-and-build.md) — development, inspection, builds, previews, and generated artifacts.
- [Testing and Diagnostics](./testing-and-diagnostics.md) — tests, runtime diagnostics, benchmarks, and validation.
- [API Stability and Diagnostics](./api-stability.md) — compatibility levels, future change policy, and stable error codes.
- [Generated API Reference](./api-reference.md) — public symbols generated from published TypeScript declarations.
- [Observability](./observability.md) — structured route, loader, action, and cache instrumentation.
- [Runtime Inspection](./devtools.md) — privacy-safe state for debug panels and editor tools.

## Deployment

- [Deployment Overview](./deployment-overview.md)
- [Static Hosting](./deployment-static.md)
- [Node](./deployment-node.md)

## Automation

- [Agent Codegen](./agent-codegen.md) — structured inspection and generation workflows for coding agents.
- [AI Evaluation](./ai-evaluation.md) — correctness-per-token metrics, certified tasks, and live adapter requirements.

## Contributing

Framework contributors should use [CONTRIBUTING.md](../CONTRIBUTING.md) for setup, tests, documentation conventions, and pull-request expectations. Internal source layout is documented by the code and its tests rather than a separate architecture snapshot that can become stale.
