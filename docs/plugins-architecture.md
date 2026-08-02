# Plugin Architecture And Behavior

> Online reference: [tavojs.dev/docs/core/plugin-api-v1](https://tavojs.dev/docs/core/plugin-api-v1)

This document is the canonical technical contract for Tavo's plugin system. It is intended for
framework maintainers, plugin authors, application teams, and coding agents that need to change or
integrate plugins without reconstructing the design from source code.

For task-oriented usage, start with [Plugins](./plugins.md).

## Design Goals

Plugin API v1 is built around five rules:

1. Installation is consent. A trusted plugin enables only the permissions and default exposure it
   declares in its manifest; the application retains remapping and override authority.
2. Registration is declarative. The complete ownership graph is validated before client, server,
   or build phase implementations are loaded.
3. Plugins communicate through declared, typed capability tokens rather than shared registries.
4. Collisions are errors. Installation order never silently decides which page, endpoint,
   singleton head value, alias, or define wins.
5. Runtime and request state have explicit ownership, hydration, and disposal rules.

## Security Boundary

Plugins are trusted executable dependencies, not sandboxes.

- A server or build phase has the filesystem, environment, network, and process authority of the
  host process.
- A client phase has the browser authority of the application page.
- Capability checks prevent undeclared access through Tavo's plugin APIs. They do not stop a
  malicious package from using JavaScript globals, Node APIs, browser APIs, or direct imports.
- Truly untrusted extensions require a separate process, worker, or origin and an independently
  designed RPC boundary.

Treat installing a plugin like installing any other executable npm dependency. Build phases are
especially privileged because their named Vite plugins execute during the application build.

## Public Entry Point

Plugin APIs are exported from `@tavojs/core/plugin`:

```ts
import {
  TAVO_PLUGIN_API_VERSION,
  checkPluginCompatibility,
  defineCapability,
  definePlugin,
  definePluginFactory,
  definePluginPhase,
  definePluginStore,
} from "@tavojs/core/plugin";
```

Applications normally configure plugins through `defineConfig()` rather than constructing a
runtime directly. Graph compilation, runtime construction, request dispatch, and head rendering
are framework internals rather than plugin-author APIs. Tooling should use `tavo inspect plugins`
or the experimental `inspectPluginGraph()` export from `@tavojs/core/dev`.

## Descriptor And Phase Separation

A plugin descriptor contains identity, a declarative manifest, and lazy phase loaders:

```ts
export const examplePlugin = definePlugin({
  id: "@acme/example",
  version: "1.3.0",
  apiVersion: 1,
  manifest: {
    // Declarative ownership and dependency claims.
  },
  client: () => import("./example.client"),
  server: () => import("./example.server"),
  build: () => import("./example.build"),
});
```

The descriptor and application configuration are imported to discover the graph. Client, server,
and build implementation modules remain lazy and are not loaded during graph preflight. Tavo's
Vite integration also prevents server runtime loader branches and server-only modules from
entering browser route bundles.

Published descriptors bake the literal `apiVersion: 1` and declare a compatible core peer range.
Host-local plugins may use `TAVO_PLUGIN_API_VERSION` because the application rebuilds them with its
installed runtime.

Each loaded phase is defined with `definePluginPhase()` and may implement only keys declared in the
manifest. A declared key without an implementation and an implementation without a declaration
both fail with `TAVO_PLUGIN_007`.

## Identity And Ownership

Every plugin has:

- `id`: a stable package-style identifier, such as `@acme/analytics`;
- `version`: a valid semantic version;
- `apiVersion`: the literal `1` for a published descriptor;
- `instanceId`: supplied by the application installation and defaulting to `default`.

The canonical installation owner is:

```txt
<plugin-id>#<instance-id>
```

For example, `@acme/database#reporting` and `@acme/database#billing` are independent owners. Every
store, capability, page, endpoint, middleware item, head item, alias, define, and build plugin is
attributed to one canonical owner plus a stable local key.

Duplicate canonical owners are invalid. Installing the same plugin more than once therefore
requires unique instance IDs.

## Application Configuration

The application installs trusted descriptors directly. Manifest permissions and exposure become
effective automatically:

```ts
export default defineConfig({
  plugins: [
    databasePlugin,
    analyticsPlugin,
    sitemapPlugin,
    { plugin: optionalPlugin, enabled: false },
  ],
});
```

- A descriptor is shorthand for an enabled default installation and its declared authority.
- Manifest `permissions` enable named sensitive behavior such as raw document-head HTML.
- Manifest `exposure` maps an installed owner's private page or server tree to its default public
  path.
- Application `expose` remaps a declared page or server tree for one installation.
- `{ use, overrides }` adds advanced exact owner replacement without separating normal uses into
  several arrays.

The compiler normalizes these public forms into internal installation, mount, permission, and
override collections before it validates the ownership graph. Those normalized collections are
not an application configuration API.

References to missing installations are fatal. This includes stale mounts and overrides.

## Manifest Reference

### Dependencies

Dependencies name a provider, semantic-version range, optional instance, optionality, and the exact
tokens the consumer may resolve:

```ts
dependencies: [
  {
    id: "@acme/analytics",
    instanceId: "default",
    version: "^2.0.0",
    optional: false,
    capabilities: [analytics],
  },
];
```

A required missing dependency, ambiguous instance, incompatible version, unavailable token, or
dependency cycle fails preflight. Optional dependencies may be absent or version-incompatible
without invalidating the graph.

Dependencies determine phase initialization order. Providers initialize before consumers.

### Capabilities

Capabilities are typed tokens owned by their declared provider:

```ts
export const analytics = defineCapability<
  { track(name: string, data?: unknown): void },
  "runtime"
>({
  provider: "@acme/analytics",
  name: "analytics",
  scope: "runtime",
});
```

Supported scopes are:

- `runtime`: one value per application plugin runtime;
- `request`: one lazy value per request scope.

A plugin can resolve its own declared tokens. It can resolve another owner's token only when the
provider is a declared dependency and the exact token appears in that dependency's `capabilities`
list. There is no list or enumeration API for another plugin's private resources.

The application-level runtime resolver can resolve installed runtime capabilities. This is trusted
application authority and is not exposed as another plugin's context.

### Stores And Hydration

`definePluginStore()` declares a runtime-scoped, plugin-owned store. Stores are private unless a
consumer lists the token on a declared dependency.

Hydration is denied by default. A hydrated store must provide all three hooks:

```ts
export const preferences = definePluginStore<Preferences>({
  provider: "@acme/preferences",
  name: "preferences",
  hydrate: true,
  validate: isPreferences,
  serialize: (state: Preferences) => state,
  deserialize: (payload: unknown) => payload as Preferences,
});
```

During SSR, only opted-in stores are serialized into `pluginState`. On the client, payloads are
deserialized, validated, and applied to an already initialized store. Capabilities and request
state are never serialized automatically. Credentials, sessions, tenants, and user identity must
remain request-scoped.

### Pages

Pages declare a local `id` and local path. Without an application mount, the public path is under:

```txt
/_plugins/<plugin-id>/<instance-id>/...
```

Application file routes and plugin page routes are checked together at runtime creation. A plugin
page cannot silently shadow an application page. The application may explicitly select itself or
another installed owner through an exact override.

### Endpoints

Endpoints declare:

- a local ID;
- one or more HTTP methods;
- an `exact` or `subtree` matcher;
- optional `validateOrigin`, which defaults to `true`.

Exact routes are considered before subtree routes. Among subtrees, longer paths are considered
before shorter paths. One request has one terminal endpoint owner; handlers return a `Response`
and cannot return `null` to fall through.

Unsafe methods validate browser origins by default. Set `validateOrigin: false` only for an
endpoint with another authentication mechanism, such as a verified webhook signature.

### Middleware

Middleware uses fixed targets and stages:

| Target   | Stage                   | Purpose                                       |
| -------- | ----------------------- | --------------------------------------------- |
| `server` | `server:before-handler` | Run before terminal plugin endpoint selection |
| `page`   | `page:before-app`       | Run before application page middleware        |
| `page`   | `page:after-app`        | Run after application page middleware         |

`before` and `after` constraints refer to stable middleware IDs. A local ID is resolved within the
same owner; a fully qualified owner-and-ID reference can order across owners. Unknown references
and cycles fail preflight.

### Document Head

Head declarations contain an ID, a global key, and cardinality:

- `singleton`: exactly one selected owner for the key;
- `multi`: contributions compose in compiled order.

An implementation returning a raw HTML string must declare `unsafeHeadHtml: true`, and its plugin
manifest must declare `unsafeHeadHtml` with a reason. Prefer TSX head nodes whenever possible.

### Declared Permissions And Exposure

A plugin declares its installation contract and why it needs each privileged contribution:

```ts
const manifest = {
  permissions: [
    {
      name: "unsafeHeadHtml",
      required: true,
      reason: "Injects the validated analytics bootstrap script.",
    },
  ],
  exposure: [
    {
      target: "server",
      from: "/",
      to: "/",
      reason: "Publishes sitemap.xml and robots.txt at their standard paths.",
    },
  ],
};
```

Installing the descriptor enables these declarations. Inspection reports the effective permission
and public path with its owner and reason. An application `expose` record replaces the declared
mount for that target; plugins cannot declare owner-aware overrides.

### Build Contributions

Build manifests may declare:

- owned Vite aliases;
- owned Vite defines;
- named Vite plugin implementations with `before` and `after` constraints.

The build phase implements only the declared named Vite plugins. It does not receive an arbitrary
Tavo hook for mutating the whole configuration. Application aliases and defines remain
application-owned; a collision requires an explicit override naming the expected plugin owner and
`app` as the replacement.

## Compilation Pipeline

The internal `compilePluginGraph()` pipeline is deterministic and performs these operations without loading phase
implementations:

1. Normalize plugin uses, manifest permissions, manifest exposure, application remapping, and
   overrides into strict internal collections.
2. Validate configuration shape, identities, semantic versions, API versions, and unique owners.
3. Validate mounts, permissions, and override references.
4. Resolve required and optional dependencies and semantic-version ranges.
5. Topologically order installations and reject dependency cycles.
6. Validate local contribution IDs and manifest ownership.
7. Validate token providers and dependency capability grants.
8. Resolve public page and endpoint paths.
9. Detect application and plugin contribution collisions.
10. Resolve explicit overrides and select one owner where replacement is authorized.
11. Order middleware and build items, rejecting missing references and cycles.
12. Return structurally read-only graph collections containing selected owners and contributions.

The compiler throws the first fatal structured diagnostic. The experimental
`inspectPluginGraph()` tool from `@tavojs/core/dev` returns
a serializable inspection containing all collected diagnostics and the proposed graph, making it
appropriate for CLI tooling and editors.

## Collision Rules

Registration order is never an authorization mechanism.

| Resource           | Collision identity                                         | Default behavior                           |
| ------------------ | ---------------------------------------------------------- | ------------------------------------------ |
| Installation       | Plugin ID plus instance ID                                 | Fatal duplicate owner                      |
| Local contribution | Kind plus local ID within one owner                        | Fatal duplicate declaration                |
| Capability/store   | Owner, kind, name, and scope                               | Fatal duplicate or foreign token           |
| Page               | Resolved public path                                       | Fatal between plugins or with an app route |
| Endpoint           | Shared HTTP method, resolved path, and matcher specificity | Fatal for equally specific owners          |
| Middleware         | Stage plus resolved ordering reference                     | Unknown reference or cycle is fatal        |
| Head               | Global key when cardinality is `singleton`                 | Fatal without exact override               |
| Alias              | Alias key                                                  | Fatal without exact override               |
| Define             | Define key                                                 | Fatal without exact override               |
| Named build plugin | Local ID within one owner                                  | Fatal duplicate; ordering is validated     |

Exact endpoints and subtree endpoints may intentionally coexist because their specificity is
deterministic. Overlapping subtrees may also coexist; the longest matching subtree wins. The same
path and same matcher kind cannot have multiple owners for a shared method without an application
override.

The framework permanently reserves `/_tavo` and `/_tavo/*`. A mount, page, or endpoint cannot
claim that space.

Application file routes claim page paths and their normal `GET`/`HEAD` request surface. Plugin
endpoint collisions with application page routes are therefore checked for `GET` and `HEAD`.

## Overrides

Only application configuration may authorize replacement:

```ts
overrides: [
  {
    kind: "page",
    key: "/dashboard",
    replace: { plugin: "@acme/dashboard" },
    with: { owner: "app" },
  },
];
```

Supported kinds are `page`, `endpoint`, `head`, `alias`, and `define`. The key must match the
canonical collision key used by that resource. Both plugin owners must be installed; stale
expected or replacement owners fail preflight. This prevents an upgrade from silently redirecting
an old override to a new owner.

The current canonical keys are:

| Override kind | Key                                                                                         |
| ------------- | ------------------------------------------------------------------------------------------- |
| `page`        | Resolved public path, for example `/dashboard`                                              |
| `endpoint`    | Uppercase, de-duplicated method list plus resolved path, for example `GET,POST:/api/events` |
| `head`        | Declared global head key                                                                    |
| `alias`       | Declared Vite alias key                                                                     |
| `define`      | Declared Vite define key                                                                    |

Plugins cannot ship self-authorizing overrides. Keep overrides beside application installations so
they remain visible in security and compatibility review.

## Runtime Lifecycle

The asynchronous runtime is the general implementation and supports asynchronous phase loaders,
factories, setup, and disposal. A synchronous entry point exists for entirely synchronous phases
and rejects asynchronous values.

For each plugin in dependency order, runtime initialization:

1. Loads the current environment's client or server phase.
2. Verifies declaration and implementation keys.
3. Creates declared runtime capability values.
4. Registers request capability factories without executing them.
5. Creates declared stores.
6. Installs selected pages, middleware, head contributions, and endpoints.
7. Runs phase setup.
8. Registers phase disposal.

If initialization fails, resources registered before the failure are disposed in reverse creation
order and startup fails. A phase's own `dispose` hook is registered after its `setup` completes, so
a setup implementation must clean up anything it creates before throwing. Separate application
runtimes have separate value maps, request factories, phase maps, and disposer stacks; plugin
runtime state is not stored on `globalThis`.

Runtime capabilities and stores are available to MVC controllers through the active pages runtime's
capability resolver.

## Request Lifecycle

Every plugin-handled request creates an isolated request scope:

1. Server middleware runs in compiled order.
2. The most-specific terminal endpoint is selected.
3. Origin validation runs for an unsafe method when enabled.
4. Request-scoped capabilities initialize lazily on first resolution and are cached only in that
   request.
5. Request resources are disposed in reverse creation order after a non-streaming response, after
   a response stream completes, after cancellation, or after request failure.

Concurrent requests never share request-scoped capability values. Runtime-scoped capabilities and
stores are shared only within one application runtime.

Plugin endpoint failures are wrapped as safe `TAVO_PLUGIN_009` errors. Raw causes remain available
to trusted diagnostics through error chaining but are not exposed as HTTP response details by the
plugin dispatcher.

`tryResolve()` is intended for capabilities on optional dependencies. The current implementation
returns `undefined` for any resolution failure, so use `resolve()` for required dependencies and do
not use `tryResolve()` to suppress provider initialization or authorization errors.

## SSR And Client Hydration

The pages runtime serializes opted-in plugin store state alongside the normal initial document
state. The client creates its own client-phase plugin runtime before applying the payload. Store
contracts validate both the server state before serialization and the client state after
deserialization.

Server and client phases may implement the same manifest with environment-appropriate behavior,
but they must preserve declared keys and compatible state contracts. Server or build entrypoints
must never be imported directly from client modules.

## Build Lifecycle

Tavo compiles the same ownership graph before applying build contributions. Build aliases and
defines are merged only after collision checks against other plugins and the application Vite
configuration. Named Vite plugins load in declared order after their phase implementation keys are
validated.

Because Vite plugin objects are executable and run with build-process authority, only install build
plugins from trusted packages. Declarative ownership makes their presence and ordering inspectable;
it does not sandbox their implementation.

## Diagnostics And Inspection

Plugin diagnostics use stable codes:

| Code              | Meaning                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| `TAVO_PLUGIN_001` | Unsupported plugin API version                                         |
| `TAVO_PLUGIN_002` | Invalid identity, manifest, range, method, or local key                |
| `TAVO_PLUGIN_003` | Duplicate owner or colliding contribution                              |
| `TAVO_PLUGIN_004` | Missing dependency, owner, ordering reference, or capability           |
| `TAVO_PLUGIN_005` | Dependency or ordering cycle                                           |
| `TAVO_PLUGIN_006` | Reserved resource or undeclared privileged contribution                |
| `TAVO_PLUGIN_007` | Phase implementation does not match its manifest or hydration contract |
| `TAVO_PLUGIN_008` | Initialization, synchronous contract, or build failure                 |
| `TAVO_PLUGIN_009` | Request handling or request-scope disposal failure                     |

Each structured diagnostic can include severity, lifecycle phase, resource identity, owners, and a
safe remediation hint.

Use:

```bash
tavo inspect plugins
tavo inspect plugins --json
tavo verify
tavo verify --json
```

`tavo inspect plugins` imports application configuration, discovers application routes, and runs
the graph inspection pipeline without loading client, server, or build phase implementations. `tavo
verify` includes the same preflight with the project's other verification checks.

## Compatibility Rules For Plugin Authors

Treat these as public compatibility surfaces:

- plugin ID and default instance assumptions;
- capability/store token provider, name, kind, and scope;
- dependency semantic-version ranges;
- page, endpoint, middleware, head, and build local IDs;
- public mount expectations documented for applications;
- endpoint matcher kind and methods;
- singleton head, alias, and define keys;
- middleware/build ordering references;
- hydrated store data shape and serialization behavior.

Removing or renaming any of these can break consumers or make application mounts and overrides
stale. Additive manifest changes can still create collisions in an application, so release notes
must identify new pages, endpoints, global head keys, aliases, and defines.

## Current Non-Guarantees

The compiled graph freezes its public collections and compiled contribution records, but plugin
descriptor functions and nested manifest objects originate in executable application modules. Do
not treat graph freezing as a security boundary against a malicious package or mutate descriptors
after configuration loading.

Plugin API v1 does not provide:

- process, worker, filesystem, network, environment, or browser isolation;
- execution timeouts or resource quotas for phase factories and handlers;
- package signature or publisher verification;
- runtime schema validation for arbitrary capability return values;
- automatic version envelopes for hydrated store payloads;
- graceful request-generation draining during application-managed hot replacement.

Do not imply these guarantees through capability ownership or graph validation documentation.

## Required Test Matrix

A plugin package should test:

- valid graph compilation and JSON inspection;
- missing, optional, incompatible, and cyclic dependencies;
- undeclared capability access;
- duplicate installation and contribution collisions;
- every intentional application override;
- separate runtime and concurrent request isolation;
- startup rollback and reverse disposal;
- response completion, streaming completion, cancellation, and failure disposal;
- exact and subtree endpoint selection plus origin checks;
- server serialization and client hydration validation;
- absence of server/build phase code from browser bundles;
- build alias, define, implementation-key, and ordering collisions.

Framework changes should run:

```bash
npm --workspace @tavojs/core run test:integration
npm --workspace tavo run test
npm run test:compat
npm run check:structure
git diff --check
```

## Implementation Map

The public barrel is `packages/core/src/plugins/index.ts`. Responsibilities are split as follows:

| Source                              | Responsibility                                                          |
| ----------------------------------- | ----------------------------------------------------------------------- |
| `plugins/types.ts`                  | Public descriptor, manifest, graph, runtime, and diagnostic types       |
| `plugins/declarations.ts`           | Public definition helpers and API-version compatibility                 |
| `plugins/compiler-installations.ts` | Installation, owner, mount, dependency, and version validation          |
| `plugins/compiler-graph.ts`         | Contribution ownership, collision detection, and winner selection       |
| `plugins/ordering.ts`               | Middleware and build ordering validation                                |
| `plugins/compiler.ts`               | Immutable graph compilation and serializable inspection                 |
| `plugins/runtime-shared.ts`         | Phase validation, hydration, token authorization, and disposal helpers  |
| `plugins/runtime.ts`                | Client/server runtime initialization and head rendering                 |
| `plugins/request.ts`                | Request scope, endpoint dispatch, origin validation, streaming disposal |
| `config/plugin-build.ts`            | Declarative build contributions and app-config collision checks         |
| `framework/runtime.ts`              | Pages/MVC integration and app-route-aware graph creation                |
| `auto-pages/state.ts`               | Active runtime and plugin hydration state integration                   |
| `cli/commands/inspect/plugins.mts`  | Project graph inspection and CLI output                                 |

## Guidance For Coding Agents

When changing plugin behavior in this repository:

1. Read this contract, [Plugins](./plugins.md), and the relevant implementation module.
2. Preserve manifest declaration requirements and application-only owner overrides.
3. Keep graph preflight pure with respect to phase implementations.
4. Add a stable structured diagnostic for every new fatal condition.
5. Never restore global string-keyed service/store registries or order-dependent collision winners.
6. Test both graph inspection and runtime enforcement; TypeScript-only checks are insufficient.
7. Update this document, the task-oriented plugin guide, release guidance, and the generated API
   reference for public type changes.

If a proposed feature needs to execute mutually untrusted code, do not extend the in-process
capability system and call it isolation. Design a worker/process/origin boundary first.
