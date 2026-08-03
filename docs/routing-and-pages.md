# Routing And Pages

> Online guide:
> [tavojs.dev/docs/core/pages-and-layouts](https://tavojs.dev/docs/core/pages-and-layouts)

This guide explains Tavo.js’s file-based routing system and the standalone router package.

## File-based Pages

If `src/pages` exists, Tavo.js can create routes automatically.

Examples:

- `src/pages/index.tsx` -> `/`
- `src/pages/about.tsx` -> `/about`
- `src/pages/blog/[id].tsx` -> `/blog/:id`
- `src/pages/docs/[[section]].tsx` -> optional param
- `src/pages/files/[...all].tsx` -> catch-all
- `src/pages/deep/[[...slug]].tsx` -> optional catch-all

## Root Component

Use `src/pages/_root.tsx` for the application-wide wrapper around every route. The root
component is always the outermost route layer, before any `_layout.tsx` files:

```tsx
import type { PropsWithChildren } from "@tavojs/core";

export default function Root({ children }: PropsWithChildren) {
  return (
    <AppProviders>
      <div class="app">{children}</div>
    </AppProviders>
  );
}
```

Only `_root.tsx` directly inside `src/pages` is recognized. Nested `_root.tsx` files are
ignored; use nested `_layout.tsx` files for section-specific wrappers.

The root is distinct from a layout in one important way: a page that exports
`layout = false` skips its `_layout.tsx` chain but remains wrapped by `_root.tsx`. This
makes the root appropriate for providers and application-wide concerns that every route
must retain.

Like layout modules, the root module can export route-layer features such as `load`,
`head`, and `middleware`. Its component receives the rendered layout or page through
`children`.

## Layouts

Use `_layout.tsx` files to wrap descendant routes.

Examples:

- `src/pages/_layout.tsx`
- `src/pages/dashboard/_layout.tsx`
- `src/pages/(marketing)/_layout.tsx`

Layouts are composed from root to leaf.

That means route groups and nested sections can each add their own shell without losing parent layouts.

## Route Groups

Route groups are folder names wrapped in parentheses:

```text
src/pages/
  (marketing)/
    _layout.tsx
    about.tsx
```

Route group names do not appear in the URL.

This is useful for:

- alternate page shells
- section-specific layouts
- internal organization without changing route paths

## Error And Fallback Pages

Supported conventions:

- `src/pages/404.tsx`
- `src/pages/_error.tsx`

`404.tsx` handles unmatched routes.

`_error.tsx` handles route-level loader or render errors.

The 404 file is a reserved fallback, not a normal `/404` route. The requested URL stays
unchanged and server rendering returns an HTTP 404 response. It can export head metadata
like any other page:

```tsx
import type { PageProps } from "@tavojs/core/router";

export const head = (
  <>
    <title>Page not found</title>
    <meta name="robots" content="noindex" />
  </>
);

export default function NotFoundPage({ pathname }: PageProps) {
  return (
    <main>
      <h1>Page not found</h1>
      <p>No page exists at {pathname}.</p>
    </main>
  );
}
```

Dynamic route patterns match URLs before loaders run. For example, a root
`src/pages/[slug].tsx` route matches every one-segment URL that is not claimed by a
static route. When the pattern matches but its backing resource does not exist, call
`notFound()` from the loader:

```tsx
import { defineRoutePage, notFound } from "@tavojs/core/router";

export default defineRoutePage<"/[slug]", { title: string }>("/[slug]", {
  async load({ params }) {
    const page = await findPageBySlug(params.slug);
    if (!page) notFound();
    return page;
  },
  default: ({ data }) => <main>{data?.title}</main>,
});
```

`notFound()` stops loader resolution, bypasses `_error.tsx`, and renders
`src/pages/404.tsx` with status 404. Static routes still take precedence over `[slug]`.

## Page Modules

A page is a functional default export. Route features are optional named exports:

```tsx
export const head = <title>Home</title>;
export const prerender = true;

export default function HomePage() {
  return <main>Home</main>;
}
```

The named module exports include `load`, `pending`, `error`, `action`, `middleware`, `head`,
`render`, `prerender`, `revalidate`, `vary`, and `generateStaticParams`.

`pending` and `error` are normal component definitions, including components created with
`createTavo(...)`. During browser navigation, `pending` renders after middleware and layout
loaders finish and while the page loader is still running. A route-level `error` handles loader
failures for that route before Tavo.js falls back to the global `src/pages/_error.tsx` page.

`static` cannot be declared as a module binding, so it cannot be the name of a `const` export.
Use the named `prerender` export. In the optional helper below, `{ static: true }` is valid because
`static` is an object property key rather than a binding. Choose one form per module; manifest
creation rejects a named `prerender` export combined with helper-level `static`.

### Optional route-aware helper

```tsx
import { defineRoutePage } from "@tavojs/core/router";

export default defineRoutePage("/", {
  default() {
    return <main>Home</main>;
  },
});
```

Use `defineRoutePage(...)` only when route params or loader data should be tied to an explicit route
pattern. The helper is optional; generated pages are functional modules unless
`tavo generate page --typed-route` is requested.

Dynamic route with loader data:

```tsx
import { defineRoutePage } from "@tavojs/core/router";

export default defineRoutePage<"/blog/[id]", { title: string }>("/blog/[id]", {
  load: async ({ params }) => ({
    title: `Post ${params.id}`,
  }),
  default: ({ data }) => <main>{data?.title}</main>,
});
```

## Head Metadata

Page modules can export `head` as JSX:

```tsx
export const head = (
  <>
    <title>About</title>
    <meta name="description" content="About this app" />
  </>
);
```

Or a dynamic function:

```tsx
import type { PageLoadContext } from "@tavojs/core/router";

export function head(context: PageLoadContext) {
  return <title>Post {context.params.id}</title>;
}
```

## Build-time Route Types

After `tavo build`, route types are generated in:

```text
.tavo/generated/routes.d.ts
```

Useful generated types include:

- `AppRoutePath`
- `RouteParamsFor<TPath>`
- `RouteLoaderContextFor<TPath>`
- `RouteLoaderDataFor<TPath>`
- `RoutePagePropsFor<TPath>`
- `RouteComponentPropsFor<TPath>`
- `RouteComponentFor<TPath>`
- `RouteHeadFor<TPath>`
- `RouteFileFor<TPath>`

This helps route-aware page code stay typed without manual route maps.

## Standalone Router

Tavo.js also ships a small standalone router package:

```tsx
import { createRouter, Link, RouterProvider } from "@tavojs/core/router";
```

Use it when you need:

- a local nested router
- a small client-only route area
- a non-file-based route setup

## `Link`

`Link` provides SPA navigation behavior and adds `aria-current="page"` automatically when active.

```tsx
function Navigation() {
  return (
    <nav>
      <Link to="/settings">Settings</Link>
      <Link to="/feed" scroll={false}>Feed</Link>
    </nav>
  );
}
```

Client navigation scrolls like a browser page load by default: new routes start
at the top, hash targets scroll into view, and browser back/forward restores
saved positions. Use `scroll={false}` or `navigate(path, { scroll: false })`
for transitions that should preserve the current scroll position.

## `RouterProvider`

`RouterProvider` provides:

- route matching
- live location state
- accessibility announcements
- focus restoration after navigation
- route scroll restoration

## Best Practices

- use file-based pages for full app routes
- use the standalone router only for focused local routing scenarios
- keep page modules small and move reusable UI into components
- use layouts to compose page shells rather than repeating wrappers in pages

## Next Reading

- [Data Loading And Middleware](./data-loading-and-middleware.md)
- [SSR And Hydration](./ssr-and-hydration.md)
