# Plugins

> Online guide: [tavojs.dev/docs/core/plugins](https://tavojs.dev/docs/core/plugins)

Tavo.js Plugin API v1 packages framework features as owned, declarative contributions. Tavo.js compiles
the complete plugin graph before it loads phase implementations, so dependencies, mounts,
capabilities, routes, and other shared resources are validated before plugin phase code runs.

This is the task-oriented authoring guide. Framework maintainers and coding agents should also use
[Plugin Architecture And Behavior](./plugins-architecture.md) as the canonical technical
contract for ownership identities, collision keys, lifecycle ordering, diagnostics, and source
responsibilities.

Plugins are trusted application dependencies. The ownership and capability rules prevent accidental
access through Tavo.js APIs, but they are not a JavaScript sandbox. A server or build plugin still has
the privileges of the host process, and client plugin code has the privileges of the application
page.

## Define A Plugin

Every plugin has a globally stable package-style `id`, a semantic `version`, and an explicit API
version. Contributions are declared in the manifest; executable work lives in lazy client, server,
or build phases.

```ts
import {
  defineCapability,
  definePlugin,
  definePluginPhase,
} from "@tavojs/core/plugin";

export const analytics = defineCapability<
  { track(event: string, payload?: unknown): void },
  "runtime"
>({
  provider: "@acme/analytics",
  name: "analytics",
  scope: "runtime",
});

export const analyticsPlugin = definePlugin({
  id: "@acme/analytics",
  version: "1.0.0",
  apiVersion: 1,
  manifest: {
    provides: [analytics],
  },
  client: () => import("./analytics.client"),
});

// analytics.client.ts
export default definePluginPhase({
  capabilities: {
    analytics: () => ({
      track(event: string, payload?: unknown) {
        navigator.sendBeacon("/events", JSON.stringify({ event, payload }));
      },
    }),
  },
});
```

Published plugin packages bake the literal `apiVersion: 1` into their descriptors and declare a
compatible `@tavojs/core` peer range. A plugin defined inside an application may instead reference
`TAVO_PLUGIN_API_VERSION` because it is rebuilt with that application’s host runtime.

The manifest and implementation keys must agree. A missing implementation, an undeclared
implementation, an invalid ID/version, or an unsupported API version is a fatal preflight error.
Server-only and build-only modules are excluded from the browser plugin graph.

## Install Plugins

Installing a trusted plugin enables the permissions and default public exposure declared by its
manifest:

```ts
import { defineConfig } from "@tavojs/core/config";
import { analyticsPlugin } from "@acme/tavo-analytics";

export default defineConfig({
  plugins: [analyticsPlugin],
});
```

Application configuration is needed only to remap a plugin's declared exposure:

```ts
export default defineConfig({
  plugins: [
    analyticsPlugin,
    {
      plugin: sitemapPlugin,
      expose: { server: "/seo" },
    },
  ],
});
```

`expose.server: "/seo"` remaps the plugin's complete server tree from `/` to `/seo`.
Use `{ from, to }` when only a subtree should move. Page exposure uses the same form under
`expose.page`.

A plugin ID can be installed once as the `default` instance. Repeated installations require an
application-supplied, unique `instanceId`. The canonical owner of every contribution is the plugin
ID, instance ID, and local contribution key.

Disabled installs do not enter the graph. Phase modules are not loaded until the remaining graph
has passed preflight.

Tavo.js normalizes descriptors, manifest permissions, manifest exposure, application remapping, and
overrides into an internal graph before compilation. Application code supplies only `plugins:
[...]` or the `{ use, overrides }` form.

## Dependencies And Capabilities

Plugins communicate through typed capability tokens instead of enumerating or reading shared
service and store registries. A consumer must declare the provider, a compatible semantic-version
range, and each capability it uses.

```ts
export const reportingPlugin = definePlugin({
  id: "@acme/reporting",
  version: "1.0.0",
  apiVersion: 1,
  manifest: {
    dependencies: [
      {
        id: "@acme/analytics",
        version: "^2.0.0",
        capabilities: [analytics],
      },
    ],
  },
  client: () => import("./reporting.client"),
});
```

Inside a phase, use `resolve(analytics)` for a required capability. Use `tryResolve(analytics)` only
for a capability declared on an optional dependency. Undeclared resolution is rejected even when
the provider is installed.

Missing required dependencies, incompatible versions, missing capabilities, and dependency cycles
all stop development, verification, build, and production startup. Dependency order is also the
default tie-breaker for contributions that do not declare a more specific order.

## Runtime And Request State

Each application runtime owns an independent plugin container. Runtime-scoped factories initialize
transactionally in dependency order. If one fails, Tavo.js disposes resources already created for that
runtime in reverse order and aborts startup.

Use `definePluginStore()` for plugin-owned runtime state. A store is private unless a consumer
declares its token as a dependency. Request-scoped capability resources are created lazily, cached
only for the current request, and
disposed after the response or stream completes, is cancelled, or fails. Keep users, sessions,
tokens, tenants, carts, and permissions request-scoped.

Only stores declared with `hydrate: true` can cross the SSR/client boundary. Hydrated stores must
provide validation and serialization contracts. Services, arbitrary capabilities, and request
state are never serialized automatically.

## Pages, Endpoints, And Middleware

Plugin page and endpoint paths are local. Their default public mount is:

```txt
/_plugins/<plugin-id>/<instance-id>/...
```

A plugin may declare a reviewed default public tree with manifest `exposure`. Installation enables
that exposure, and application `expose` configuration may remap it. Without a declaration, the
tree remains at its private plugin path. `/_tavo/*` is permanently reserved for framework
endpoints.

Endpoint manifests declare an HTTP method and either an exact path or an explicit subtree matcher.
Exact matches run before subtrees; longer subtrees run before shorter ones. A resolved request has
one terminal owner—endpoint handlers cannot return `null` to fall through to another plugin.
Ambiguous registrations are rejected during preflight.

Cross-cutting behavior belongs in middleware. Middleware declares one of these fixed stages:

- `server:before-handler`
- `page:before-app`
- `page:after-app`

Use contribution IDs with `before` and `after` constraints when ordering within a stage matters.
Unknown IDs and ordering cycles are fatal.

Unsafe HTTP methods validate browser `Origin` headers by default. Disable validation only for an
endpoint that authenticates the request another way, such as a signed webhook.

## Head And Build Contributions

Document-head contributions are keyed and declare `singleton` or `multi` cardinality. Two owners
cannot silently replace the same singleton. Raw HTML requires the plugin manifest to declare the
`unsafeHeadHtml` permission with a reviewable reason. Never include user-controlled content in raw
head HTML.

Build phases declare owned aliases, defines, and named Vite plugins. They do not receive
the complete mutable Vite configuration. Duplicate or reserved keys and invalid ordering constraints
fail graph compilation.

## Mounts, Overrides, And Permissions

Installing a plugin enables its manifest-declared permissions and default public exposure. Review
these declarations before installation and after upgrades with `tavo inspect plugins`. Application
configuration can remap exposure and remains the only source of owner-aware overrides.

An override identifies the resource kind, expected current owner, and replacement owner. Both
owners must exist, so stale overrides fail instead of silently changing behavior after an upgrade.

Prefer each plugin's default private mount. When a public URL is part of the application contract,
keep the mount and any override next to the install in `tavo.config.ts` so ownership is reviewable.

Plugins declare `permissions` and `exposure` with reasons in their manifest. These appear in graph
inspection and become effective when the plugin is installed. For advanced owner-aware overrides,
use:

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

## Inspect And Verify

Inspect the compiled graph without executing plugin phases:

```bash
tavo inspect plugins
tavo inspect plugins --json
tavo verify --json
```

Inspection reports instances, dependencies, capabilities, mounts, middleware order, owned
resources, permissions, and overrides. `tavo verify` runs the same plugin preflight used by dev and
build. Machine-readable diagnostics include a stable code, severity, phase, resource, owners, and
safe remediation context.

Development tooling that needs the serializable graph directly can import the experimental
`inspectPluginGraph()` API from `@tavojs/core/dev`. Graph compilation and runtime construction are
framework internals; application code should configure plugins through `defineConfig()`.

## Publishing

- Keep the plugin `id`, capability tokens, and local contribution keys stable across compatible
  releases.
- Declare accurate provider version ranges and test the oldest and newest supported Tavo.js versions.
- Keep client, server, and build entrypoints separate; do not import a server phase from a client
  module.
- Test graph preflight, startup rollback, request disposal, SSR, and the browser bundle for every
  phase the package contributes.
- Treat changes to capabilities, contribution ownership, mounts, and hydration schemas as public
  compatibility changes.
