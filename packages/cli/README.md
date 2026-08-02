# tavo

CLI for creating, building, inspecting, and previewing Tavo apps.

## Quick Start

Create a new app:

```bash
npx tavo@latest create app my-app
cd my-app
npm install
npm run dev
```

Run the production build and SSR preview:

```bash
npm run build
npm run preview:ssr
```

Tavo projects use `@tavojs/core` for the app runtime and `tavo` for local development, project inspection, generation, and build commands.

## Common Commands

```bash
tavo create app [dir]
tavo dev
tavo dev --ssr
tavo build
tavo preview
tavo preview --ssr
tavo routes
tavo info
tavo monitor
```

When `dir` is omitted, Tavo prompts for the project name.

Use `--network` with `dev` or `preview` to bind to `0.0.0.0` for testing from another device on the same local network.

Static routes keep collected runtime styles inline by default. To move each
route's styles into one fingerprinted, cacheable production asset, configure:

```ts
export default defineConfig({
  build: {
    prerenderStyles: "external"
  }
});
```

The equivalent one-build override is `tavo build --prerender-styles external`.
Dynamic SSR responses continue using inline styles as a safe fallback.

## Generation

```bash
tavo generate page dashboard
tavo generate page blog/[id] --loader --seo
tavo generate component UserCard --props
tavo generate store session --shape user,ready
tavo generate layout dashboard
```

Generation commands protect existing files by default. Pass `--force` only when replacing generated output intentionally.

## Diagnostics

```bash
tavo check
tavo doctor
tavo doctor --fix-dry-run --json
tavo inventory --json
tavo agent-context --json
tavo agent-context --json --task modify-route --target /account
tavo inspect route /account --json
tavo change --from-json change.json --dry-run
tavo verify --smoke --json
```

## Machine Protocol v1

Every agent-oriented JSON response uses one envelope with a schema version, command, success flag,
project fingerprint, data, diagnostics, next actions, and size/timing metrics. Compact task context
is capped at 8 KB. Use targeted inspection instead of requesting the full inventory.

Transactional change plans require SHA-256 preconditions for existing files and either commit every
operation or roll the transaction back. Published schemas are available under `tavo/schemas`.

`tavo monitor` reads the built-in `/_tavo/monitor` endpoint and refreshes in realtime. Generated SSR servers keep the endpoint hidden until `TAVO_MONITOR_TOKEN` is configured; pass the same value with `--token` or through the CLI environment.

## Documentation

Use the task-oriented [framework CLI documentation](https://tavojs.dev/docs/cli) for create,
generate, development, inspection, build, preview, monitoring, and automation workflows.

- [Getting started](https://github.com/tavojs/core/blob/main/docs/getting-started.md)
- [CLI and build workflow](https://github.com/tavojs/core/blob/main/docs/cli-and-build.md)
- [Routing and pages](https://github.com/tavojs/core/blob/main/docs/routing-and-pages.md)
- [Deployment overview](https://github.com/tavojs/core/blob/main/docs/deployment-overview.md)
- [Testing and diagnostics](https://github.com/tavojs/core/blob/main/docs/testing-and-diagnostics.md)

## Requirements

- Node.js `^20.19.0 || >=22.12.0`
- A Tavo app with `@tavojs/core` installed
