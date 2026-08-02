# Data Loading And Middleware

> Online guide: [tavojs.dev/docs/core/data-and-middleware](https://tavojs.dev/docs/core/data-and-middleware)

This guide explains how route data, middleware, and route status work in Tavo.

## Loaders

Page and layout modules can define `load(...)`:

```tsx
import { defineRoutePage } from "@tavojs/core/router";

export default defineRoutePage("/blog/[id]", {
  async load({ params }) {
    return {
      id: params.id,
      loadedAt: Date.now(),
    };
  },
  default({ data }) {
    return <main>{JSON.stringify(data)}</main>;
  },
});
```

Loaders run as part of route resolution.

Their output becomes:

- `props.data` for the page
- part of `this.page.data` for controllers

## Loader Context

Typical loader inputs include:

- route params
- pathname
- `request`, a normalized Fetch `Request`
- `url`, a normalized `URL`
- `headers`, normalized `Headers`
- `method`, the normalized HTTP method
- `signal`, an `AbortSignal` cancelled when the request or browser navigation is superseded
- `rawRequest`, the original Node request when available
- layout layer data

Generated route typing can help make loader code more explicit in TypeScript projects.

`request` is normalized to the standard Fetch `Request` shape across Node and Vite development.
Use `request.headers`, `request.method`, and `url` for portable code. The original Node request is
available as `rawRequest` for integration boundaries that need it.

Pass `signal` to fetches and other abortable operations:

```ts
import type { PageLoadContext } from "@tavojs/core/router";

export async function load({ signal }: PageLoadContext) {
  const response = await fetch("https://api.example.com/posts", { signal });
  return response.json();
}
```

New browser navigation aborts the previous route resolution. Middleware and layout loaders receive the same signal. Aborted navigation returns to an idle route state rather than publishing an error from obsolete work.

## Pending And Error Views

A page with a long-running loader can export route-specific pending and error components:

```tsx
import { createTavo } from "@tavojs/core";
import type {
  PageErrorProps,
  PageLoadContext,
  PagePendingProps,
  PageProps,
} from "@tavojs/core/router";

export const pending = createTavo<PagePendingProps, Record<string, never>>({
  view: () => (
    <main aria-busy="true">
      <PageSkeleton />
    </main>
  ),
});

export const error = createTavo<PageErrorProps, Record<string, never>>({
  view: ({ props }) => (
    <main role="alert">
      <h1>Could not load this page</h1>
      <p>{String(props.error)}</p>
    </main>
  ),
});

export async function load({ signal }: PageLoadContext) {
  const response = await fetch("/api/large-report", { signal });
  if (!response.ok) throw new Error(`Report request failed: ${response.status}`);
  return response.json();
}

export default function ReportPage({ data }: PageProps<Report>) {
  return <ReportView report={data} />;
}
```

For browser navigation, Tavo changes the URL, resolves middleware and target layout loaders,
then renders `pending` while the page loader runs. The target layouts wrap the pending component
with their resolved layout data. When loading succeeds, Tavo replaces the pending tree with the
default page. The default page and its controller still mount only with resolved page data.

`pending` receives `pathname`, `params`, `layers`, and `layerData`; it does not receive page loader
data. It is not rendered during route prefetching or normal SSR document generation. Without a
`pending` export, Tavo keeps the previous page visible and marks the route region busy.

If a loader fails, the route's `error` component receives the error and resolved route context.
When the route has no `error` export, Tavo uses `src/pages/_error.tsx`. A `notFound()` signal
continues to bypass error views and renders `src/pages/404.tsx`.

## Layout Loaders

Layouts can also define `load(...)`.

Their results are collected into route layer data, which is exposed through:

- `this.page.layerData`
- resolved route metadata

Use layout loaders for:

- shared shells
- global nav data
- section-level settings

## Middleware

Page modules can define middleware:

```tsx
import { defineRoutePage } from "@tavojs/core/router";

export default defineRoutePage("/old", {
  middleware({ to }) {
    if (to === "/old") {
      return { redirect: "/" };
    }
  },
  default() {
    return <main>Redirect target</main>;
  },
});
```

Middleware can:

- allow navigation
- redirect
- block/shape route flow before render

Use it for:

- auth gating
- redirect rules
- route normalization

SSR middleware should derive user state from the current request:

```ts
import { defineServerMiddleware } from "@tavojs/core/router";

async function getUserFromRequest(request: Request) {
  const authorization = request.headers.get("authorization");

  return authorization ? verifyBearerToken(authorization) : null;
}

export const middleware = defineServerMiddleware(async ({ request }) => {
  const user = await getUserFromRequest(request);

  if (!user) {
    return { redirect: "/login" };
  }
});
```

Do not store the current user or token in a global store from middleware. Global stores are process-wide on the server, so another request handled by the same process could observe that state.

Middleware runs in both server and client route resolution by default. Use
`defineServerMiddleware(handler)` or `defineMiddleware(handler, { runtime: "server" })`
for request-bound work such as reading `HttpOnly` cookies, secrets, or server sessions.
Use `isServerRuntime()` and `isClientRuntime()` when shared route code needs an explicit
environment guard.

Use loaders to pass safe user data into the rendered page:

```ts
import { defineServerLoader } from "@tavojs/core/router";

export const load = defineServerLoader(async ({ request }) => {
  const user = await getUserFromRequest(request);

  return {
    user: user ? { id: user.id, name: user.name } : null
  };
});
```

`defineServerLoader()` runs during server-side route resolution and is skipped during
browser route resolution. Use it for `HttpOnly` cookie/session reads, then keep the safe
result in page data or a client store after hydration. Use a normal `defineLoader()` for
loaders that are safe to execute in both environments.

## Route Status APIs

Tavo exposes route status state:

```ts
import {
  getRouteStatus,
  prefetchRoute,
  subscribeRouteStatus,
} from "@tavojs/core/router";
```

Common patterns:

```ts
const controller = new AbortController();
await prefetchRoute("/blog/hello", { signal: controller.signal });

const status = getRouteStatus("/blog/hello");

const stop = subscribeRouteStatus((next) => {
  console.log(next.status);
}, "/blog/hello");
```

Possible route status values include:

- `idle`
- loading/prefetch states
- ready states
- error states

## Controller Usage

Route-aware controllers should prefer:

- `this.page.status`
- `this.page.data`
- `this.page.params`
- `this.page.layerData`

Example:

```ts
class BlogController extends TavoController {
  onInit() {
    this.model.patch({
      id: this.page.params.id,
      title: this.page.data?.title,
    });
  }
}
```

## Resources

For local async component data rather than route data, use `createResource(...)` from `@tavojs/core`.

Use this when the async work is component-scoped rather than page-route-scoped.

```ts
import { createResource } from "@tavojs/core";

const account = createResource(async ({ signal }) => {
  const response = await fetch("/api/account", { signal });
  return response.json();
});

await account.load();
account.abort();
```

Starting another load aborts the previous load. `reset()` and `abort()` also cancel active work and prevent stale completions from changing state. The resource operation settles back to `idle` even if a loader ignores its signal.

## Lazy Components

Use `lazy(...)` from `@tavojs/core` when the async work is loading a component implementation:

```tsx
import { lazy } from "@tavojs/core";

const HeavyPanel = lazy(() => import("../components/HeavyPanel"), {
  fallback: <p>Loading...</p>
});

export default function Dashboard() {
  return <HeavyPanel accountId="demo" />;
}
```

The returned component is still a normal Tavo component. It starts loading on first browser render, swaps the fallback after the dynamic import resolves, and exposes `preload()` for hover handlers, controllers, or SSR setup:

```ts
await HeavyPanel.preload();
```

Synchronous SSR renders the fallback unless the component has already been preloaded.

## Forms And Actions

Tavo also ships action primitives:

- `createAction(...)`
- `createFormAction(...)`
- `createServerFormAction(...)`

These are useful for mutation state that should live alongside MVC controllers as explicit store-backed state.
Action and form state is exposed through stores, so controllers can subscribe with `this.listen(...)`, `this.select(...)`, or direct store reads.

Route modules can also export a server `action` for non-GET requests in SSR mode:

```tsx
import { defineAction, defineRoutePage } from "@tavojs/core/router";

export const action = defineAction(async ({ request }) => {
  const form = await request.formData();

  return {
    redirect: `/thanks?email=${encodeURIComponent(String(form.get("email") ?? ""))}`
  };
});

export default defineRoutePage("/contact", {
  default() {
    return (
      <form method="post">
        <input name="email" type="email" />
        <button>Join</button>
      </form>
    );
  }
});
```

Actions run before page rendering for mutation methods. If an action returns `{ redirect }`,
Tavo sends a `303` response by default. Browser-origin mutations are protected by same-origin
validation unless the action is defined with `{ validateOrigin: false }`.

Client components can enhance the same endpoint:

```ts
import { createServerFormAction } from "@tavojs/core";

const signup = createServerFormAction("/signup");
```

For static CSR deployments, there is no Tavo server process to execute route `action`
exports. Use `bootTavo({ csrActions })` to enhance the same form markup and submit it
to your API instead:

```ts
import { bootTavo } from "@tavojs/core";

void bootTavo({
  csrActions: {
    enabled: true,
    baseUrl: "https://api.example.com",
    credentials: "include"
  }
});
```

When a form omits `action`, the current route path is used. The API should own login,
logout, and HttpOnly session cookies; Tavo's `createSessionStorage()` is for SSR
deployments where the Tavo server runtime handles the request.

## Best Practices

- use route loaders for page-level or layout-level route data
- use middleware for navigation rules, not for view rendering
- use `createResource(...)` for component-local async state
- avoid putting unrelated mutation state into route loaders
- keep SSR request data in `request`, loader return values, or your external session store
- use route actions for login, logout, register, and other cookie-setting mutations
- avoid module-scoped resources/actions for per-user SSR data

## Next Reading

- [Stores](./stores.md)
- [SSR And Hydration](./ssr-and-hydration.md)
