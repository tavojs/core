# SSR And Hydration

> Online guide:
> [tavojs.dev/docs/core/ssr-and-hydration](https://tavojs.dev/docs/core/ssr-and-hydration)

This guide explains how Tavo renders on the server and attaches the client runtime afterward.

## SSR Model

Tavo supports server-side rendering for file-based pages and standalone runtime trees.

Main SSR capabilities:

- HTML document rendering
- route loaders on the server
- route middleware on the server
- hydration on the client
- static SSR caching and revalidation

## Key Public APIs

Relevant packages:

- `@tavojs/core/server`
- `@tavojs/core`

Important APIs include:

- `renderToString(...)`
- `renderDocument(...)`
- `renderPagesResponseAsync(...)`
- Node request-handler helpers

## Unified App Code

App developers should write the same page and component code for CSR and SSR.

The framework decides whether to:

- mount client-side
- hydrate server-rendered HTML

That is one of the main design goals of Tavo’s pages runtime.

## Hydration

On the client, Tavo reuses existing SSR DOM and attaches behavior.

Hydration attempts to preserve:

- existing text nodes
- matching elements
- component boundaries
- route markup

If the server DOM and client tree disagree, Tavo can report hydration mismatches in dev diagnostics.

## Serialized Initial State

When SSR is used for pages, Tavo serializes resolved route data into the document.

That allows the client to:

- reuse the resolved route payload
- avoid immediate duplicate route loading on boot
- hydrate against the same route tree the server rendered

This is especially important for:

- SSR route data
- revalidation caches
- stable route transitions on first load

## Node SSR

`tavo build` produces the generated Node server at:

```text
.tavo/build/server/start.mjs
```

The stable `@tavojs/core/server` entry point provides the Node-focused rendering contract used by that
server.

## Per-page SSR Or CSR

Pages render with SSR by default when the app runs through `tavo dev --ssr`,
`tavo preview --ssr`, or the generated Node server.

Opt a route out of server body rendering with `render: "csr"`:

```tsx
import type { PageProps } from "@tavojs/core/router";

export const render = "csr";

export async function load() {
  const response = await fetch("/api/profile");
  return response.json();
}

export default function ProfilePage({ data }: PageProps<{ name: string }>) {
  return <main>{data?.name}</main>;
}
```

CSR routes still receive the same HTML document shell and client entry script, but the server does not run the page loader or render the page body. The app container is marked with `data-tavo-render-mode="csr"`, so the browser mounts the route instead of hydrating an empty server body. The browser resolves the route after boot.

If an empty shell is too abrupt, pass a CSR fallback shell to the pages runtime:

```tsx
import { h } from "@tavojs/core";
import { defineConfig } from "@tavojs/core/config";

export default defineConfig({
  ssr: {
    csrFallback: ({ pathname }) => (
      <main className="page-loading" aria-busy="true">
        Loading {pathname}
      </main>
    ),
  },
});
```

The fallback is rendered by the server for CSR routes only. It should be deterministic and should not depend on page loader data, because the page loader runs in the browser for CSR routes.

Static page metadata can still be applied on the server for CSR routes:

```tsx
import { defineRoutePage } from "@tavojs/core/router";

export default defineRoutePage("/dashboard", {
  render: "csr",
  head: {
    title: "Client dashboard"
  },
  default: function DashboardPage() {
    return <main>Dashboard</main>;
  }
});
```

Data-dependent `head(context)` functions run when the browser resolves the CSR route, so they do
not affect the initial HTML. Prefer static `head` objects or JSX for CSR routes when the first
response needs title or metadata. `prerender`, `revalidate`, `vary`, and
`generateStaticParams()` are SSR/static rendering features; Tavo ignores them on CSR routes and
reports a route diagnostic.

## Static SSR And Revalidation

Pages can configure:

- `prerender = true`
- `revalidate = <seconds>`
- `generateStaticParams()`

Example:

```tsx
export const prerender = true;

export default function AboutPage() {
  return <main>About</main>;
}
```

For production builds, `prerender = true` without `revalidate` prerenders the route into an HTML
file under the client build output. The optional `defineRoutePage(...)` helper expresses the same
mode with its `{ static: true }` property. Do not declare both forms in one module.

For dynamic routes, list the paths to prerender with `generateStaticParams()`:

```tsx
import { defineRoutePage } from "@tavojs/core/router";

function generateStaticParams() {
  return [{ id: "hello" }, { id: "intro" }];
}

export default defineRoutePage("/blog/[id]", {
  static: true,
  generateStaticParams,
  default: function BlogPage(props) {
    return <main>{props.params.id}</main>;
  }
});
```

`revalidate = <seconds>` keeps the route in runtime-cached SSR mode instead:

```tsx
export const revalidate = 60;
```

That lets the server cache HTML for a route and refresh it after the configured interval.

This is a process-local cache by default, which is a good practical first step for Node-style deployments.

Static cache entries automatically vary by URL query string and `Accept-Language`. Requests with `Cookie` or `Authorization` headers bypass static SSR caching because they are usually personalized.

Tag related entries for targeted invalidation. Tags can be static or derived from route context:

```tsx
import { defineRoutePage } from "@tavojs/core/router";

export default defineRoutePage<"/blog/[id]", { title: string }>("/blog/[id]", {
  static: true,
  cacheTags: ({ params }) => ["posts", `post:${params.id}`],
  load: ({ params }) => getPost(params.id),
  default: ({ data }) => <main>{data?.title}</main>,
});
```

Node request handlers invalidate both cached loader data and rendered responses:

```ts
const handler = createNodeRequestHandler({ modules });

await handler.invalidateCache("post:hello");
await handler.invalidateCache(["posts", "homepage"]);
await handler.clearCache();
```

If a static route depends on another request header, declare it with `vary`:

```tsx
import type { PageLoadContext, PageProps } from "@tavojs/core/router";

export const prerender = true;
export const vary = "x-tenant";

export async function load({ request }: PageLoadContext) {
  return {
    tenant: request.headers.get("x-tenant")
  };
}

export default function TenantPage({ data }: PageProps<{ tenant: string | null }>) {
  return <main>{data?.tenant}</main>;
}
```

Multiple headers are supported:

```ts
export const vary = ["x-tenant", "x-region"];
```

When `vary` is used, Tavo includes those header values in its static SSR cache key and emits a matching `Vary` response header when the request contains them.

For production environments with multiple processes or regions, provide a static cache adapter:

```ts
import { createNodeRequestHandler } from "@tavojs/core/server";

const handler = createNodeRequestHandler({
  modules,
  staticCache: {
    async get(key) {
      return readFromExternalCache(key);
    },
    async set(key, entry) {
      await writeToExternalCache(key, entry);
    },
    async delete(key) {
      await deleteFromExternalCache(key);
    },
    async invalidateTags(tags) {
      return invalidateExternalCacheTags(tags);
    }
  }
});
```

The cache entry contains the rendered response, `expiresAt`, and `tags`, so adapters can map it to Redis, platform KV, or an edge cache. Handler-level invalidation also tracks keys written during the current process and falls back to deleting those keys when an adapter has no native tag index.

## `Image` And SSR

The `Image` component can use a built-in optimization endpoint on SSR-capable servers.

In CSR-only apps it gracefully falls back to normal asset URLs.

## Vite SSR Dev

Tavo also supports a Vite-based SSR development server for local development:

- route discovery
- SSR rendering
- CSS entry handling
- monitor endpoint support

This keeps the dev server setup simple from day one.

## Best Practices

- write page code once and let Tavo choose CSR vs SSR behavior
- use SSR for SEO-sensitive or first-load-sensitive routes
- use revalidation for pages that are mostly static but need periodic refresh
- keep request-specific data out of global stores, global services, and module-level variables
- declare `vary` for static routes that depend on request headers other than cookies, authorization, or language
- keep hydration mismatches treated as real bugs, not harmless warnings

## Next Reading

- [Streaming And Deferred Rendering](./streaming-and-deferred.md)
- [SEO And Asset Components](./seo-and-assets.md)
