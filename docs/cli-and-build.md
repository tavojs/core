# CLI And Build Workflow

> Online CLI guide: [tavojs.dev/docs/cli](https://tavojs.dev/docs/cli)

Use the `tavo` CLI as the supported interface for creating, understanding, validating, building,
previewing, and operating a Tavo.js application.

## Install and Run

Generated applications install `@tavojs/cli` as a development dependency and expose the `tavo` command through
npm scripts. Prefer those scripts or `npx tavo` from the project root so local development and CI use
the version recorded in the lockfile. Use `npx @tavojs/cli@latest create app` only for a new project.

## Common Commands

Typical commands include:

- `tavo create app [name]` (prompts for the project name when omitted)
- `tavo dev`
- `tavo dev --ssr`
- `tavo dev --network`
- `tavo build`
- `tavo build --report-json`
- `tavo preview`
- `tavo preview --ssr`
- `tavo preview --network`
- `tavo routes`
- `tavo info`
- `tavo inventory`
- `tavo doctor`
- `tavo check`
- `tavo inspect <route|component|store|file|api> <target> --json`
- `tavo inspect plugins`
- `tavo generate page <name>`
- `tavo generate page <name> --typed-route`
- `tavo generate layout <name>`
- `tavo generate store <name>`
- `tavo generate component <name>`
- `tavo generate action <name>`
- `tavo generate 404`
- `tavo generate error`
- `tavo agent-context --json`
- `tavo change --from-json <file> --dry-run`
- `tavo verify --smoke --json`
- `tavo monitor`

Run `npx tavo --version` and `npx tavo --help` for the exact installed command and flag inventory.

## Local Network Access

Use `--network` when you want to open the app from another device on the same Wi-Fi network, such as a phone or tablet:

```bash
tavo dev --network
tavo dev --ssr --network
tavo preview --network
tavo preview --ssr --network
```

`--network` binds the server to `0.0.0.0`. You can also pass an explicit host:

```bash
tavo dev --host 0.0.0.0
```

Then open the server from your mobile device using your computer's local network IP address and the printed port.

## `tavo build`

`tavo build` is responsible for the production-oriented app output.

Enforce application JavaScript budgets through `tavo.config.ts` or CLI flags:

```bash
tavo build --max-first-load-js 150kb --max-route-js 40kb
```

Budget failures name each offending route and report its actual and configured size.

It generates:

- client build output
- SSR server output
- route artifacts in `.tavo/generated`
- route manifest and generated typing
- route size summary for pages
- optional build report JSON in `.tavo/generated/build-report.json`

The route size summary looks like:

```text
Route (pages)        Mode     Size     First Load JS
┌ ƒ /                SSR      ...
```

Route modes are:

- `SSR`: rendered on each server request
- `CSR`: body rendering is deferred to the browser
- `SSG`: prerendered static HTML
- `ISR`: runtime static SSR cache with revalidation

When `--report-json` is enabled, `.tavo/generated/build-report.json` includes both the table rows and a normalized `routes` array:

```json
{
  "routes": [
    {
      "route": "/dashboard",
      "mode": "CSR",
      "symbol": "ƒ",
      "size": 12697,
      "firstLoadJs": 86118
    }
  ]
}
```

## `tavo preview`

`tavo preview` serves the built app.

Use:

- `tavo preview` for CSR-style preview
- `tavo preview --ssr` for SSR preview

`tavo preview --ssr` automatically builds when the SSR output is missing or stale.

Preview is the right place to validate the actual production build behavior rather than just Vite dev mode.

## `tavo monitor`

The monitor command shows runtime server information in a live table-like view.

It is intended for:

- request counts
- latency
- inflight load
- memory
- CPU
- top routes

Useful forms:

- `tavo monitor --token <token>`
- `tavo monitor --token <token> --once`
- `tavo monitor --token <token> --json --once`
- `tavo monitor --url http://127.0.0.1:4174 --token <token>`
- `tavo monitor --token <token> --interval 2000`

By default, monitor refreshes every second and reads `http://127.0.0.1:4174/_tavo/monitor`. If `--url` points at a server root, the CLI appends `/_tavo/monitor` automatically.
The generated SSR server keeps this endpoint hidden until `TAVO_MONITOR_TOKEN` is set. Pass the same value with `--token`, or set it in the CLI environment. Authentication is sent in the `Authorization: Bearer ...` header; URL query tokens are rejected.

## Agent-Oriented Inspection

Tavo.js exposes structured project information for agents and editor tooling:

- `tavo info --json`
- `tavo routes --json`
- `tavo inventory --json`
- `tavo doctor --json`
- `tavo check --json`
- `tavo agent-context --json`
- `tavo verify --json`
- `tavo verify --smoke --json`

`tavo doctor` reports project-shape diagnostics without running a production build. `tavo check`
adds lightweight validation and runs the local `typecheck` script when TypeScript dependencies are
installed.

The route JSON output includes route paths, source files, layout files, and parameter metadata so
agents can modify pages without hand-maintaining route maps.

`tavo agent-context --json --task <task> --target <name>` is the best entrypoint for agents. Its
default response is capped at 8 KB and contains only task-relevant conventions, the selected entity,
API cards, diagnostics, and next actions. Use `--detail full` only when the complete graph is needed.

`tavo inspect <route|component|store|file|api> <target> --json` fetches one entity with its imports,
parse status, and SHA-256. Use that hash in `tavo change` plans that modify existing files.

`tavo inspect plugins [--json]` compiles the Plugin API v1 graph without loading phase modules. It
reports installed instances, dependency edges, capabilities, endpoint ownership, middleware order,
head keys, overrides, and effective manifest-declared permissions and exposure with their reasons.
The human-readable output prints a permission audit; JSON contains the same structured data.
Invalid graphs return structured plugin diagnostics instead of choosing a collision winner based on
configuration order.

`tavo change --from-json <plan> --dry-run` preflights a versioned transaction. Applying the same
plan returns a receipt with resulting hashes and a targeted verification command. Existing-file
operations with stale hashes are rejected before any write; a safe fix that creates a missing file
uses the explicit `expectedMissing` precondition.

`tavo inventory --json` reports pages, layouts, components, stores, actions, CSS entries, exports,
and import paths so agents can inspect the app without guessing file locations.

Use `tavo doctor --fix-dry-run --json` when an agent needs suggested repairs without mutating files.
Agents should apply a returned low-risk fix through a hash-guarded `apply-fix` change-plan operation;
the direct `doctor --fix` command remains a human convenience. Use `tavo verify --spec <file> --json` after schema generation to confirm context,
diagnostics, route freshness, plugin graph preflight, and optional typecheck status in one payload.
Add `--smoke` to include
lightweight route module parse and export checks before running a full production build.
Use `--files <comma-separated-files>` or `--receipt <file>` to verify the changed files and their
dependent Tavo.js modules without returning unrelated diagnostics.

## Generators

Generators create application source files:

- `tavo generate page blog/[id] --loader --seo`
- `tavo generate page blog/[id] --loader --seo --typed-route`
- `tavo generate component UserCard --props`
- `tavo generate store session --shape user,ready`
- `tavo generate --from-json tavo.generated.json`
- `tavo generate --from-stdin`
- `tavo generate --validate-spec tavo.generated.json`

Page generation produces a functional module by default. `--typed-route` opts into
`defineRoutePage(...)` when an explicit route-pattern contract is useful.

## Generated Route Typings

After build, Tavo.js generates route typings in:

```text
.tavo/generated/routes.d.ts
```

This is part of the build workflow, not something app developers maintain by hand.

## SSR Build Output

The production SSR flow emits generated server files in `.tavo/build/server` and client assets in `.tavo/build/client`.

This allows Tavo.js to support:

- SSR preview
- generated Node production output
- build-time route artifact generation

## When To Use Dev vs Preview

Use `npm run dev` or `tavo dev` when:

- iterating quickly
- relying on HMR
- building UI fast

Use `tavo build` + `tavo preview` when:

- validating code splitting
- validating SSR
- checking generated route types
- testing production behavior

For the workspace preview app, `npm run test:e2e` builds the core package, builds the preview SSR output, starts the generated production server, and runs the Playwright browser suite against it.

## Best Practices

- treat `preview` as the real app-behavior check
- use `tavo build` regularly when working on routing or SSR
- use generated artifacts as outputs, not hand-edited files
- run `npm run test:cli` after changing command parsing, route artifact generation, or scaffolds

## Next Reading

- [Configuration](./configuration.md)
- [Testing And Diagnostics](./testing-and-diagnostics.md)
