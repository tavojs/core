# Route Pending And Error Exports

> Online guide:
> [tavojs.dev/docs/core/pages-and-layouts](https://tavojs.dev/docs/core/pages-and-layouts)

Tavo.js pages can export route-specific `pending` and `error` components alongside their loader and
default page component.

Use these exports when a page loader may take long enough that users need immediate feedback, or
when a page should present a contextual error instead of the application-wide error page.

```tsx
import { createTavo } from "@tavojs/core";
import type {
  PageErrorProps,
  PageLoadContext,
  PagePendingProps,
  PageProps,
} from "@tavojs/core/router";

type Report = {
  title: string;
  rows: Array<Record<string, unknown>>;
};

const ReportSkeleton = createTavo<
  PagePendingProps,
  Record<string, never>
>({
  view: () => (
    <main aria-busy="true" aria-label="Loading report">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-toolbar" />
      <div className="skeleton skeleton-table" />
    </main>
  ),
});

const ReportError = createTavo<
  PageErrorProps,
  Record<string, never>
>({
  view: ({ props }) => (
    <main role="alert">
      <h1>Could not load the report</h1>
      <p>{String(props.error)}</p>
    </main>
  ),
});

export const pending = ReportSkeleton;
export const error = ReportError;

export async function load({ signal }: PageLoadContext): Promise<Report> {
  const response = await fetch("/api/report", { signal });

  if (!response.ok) {
    throw new Error(`Report request failed: ${response.status}`);
  }

  return response.json();
}

export default function ReportPage({ data }: PageProps<Report>) {
  if (!data) return null;
  return <ReportView report={data} />;
}
```

## Navigation Behavior

For client-side navigation to a page with a `pending` export, Tavo.js follows this sequence:

1. Change the browser URL to the target page.
2. Run route middleware.
3. Run the target route's layout loaders.
4. Render the target route's `pending` component inside its resolved layouts.
5. Run the page loader.
6. Replace the pending component with the default page when loading succeeds.
7. Render the route's `error` component if loading fails.

The default page component and its controller do not mount until the page loader has completed.
This preserves the guarantee that the completed page starts with resolved loader data.

If a page does not export `pending`, Tavo.js preserves the existing behavior: the previous page
remains visible while the target route loads, and the route content region is marked as busy.

## Pending Components

The `pending` export is a normal Tavo.js component definition. It can be a function component:

```tsx
import type { PagePendingProps } from "@tavojs/core/router";

export function pending({ params }: PagePendingProps) {
  return (
    <main aria-busy="true">
      Loading account {params.id}…
    </main>
  );
}
```

It can also be a component created with `createTavo()`:

```tsx
import { createTavo } from "@tavojs/core";
import type { PagePendingProps } from "@tavojs/core/router";

export const pending = createTavo<
  PagePendingProps,
  { elapsedSeconds: number }
>({
  model: () => ({
    elapsedSeconds: 0,
  }),

  view: ({ state }) => (
    <main aria-busy="true">
      Loading… {state.elapsedSeconds}s
    </main>
  ),
});
```

A pending component receives:

```ts
type PagePendingProps = {
  pathname: string;
  params: Record<string, string | undefined>;
  layers: RouteDataLayer[];
  layerData: Record<string, unknown>;
};
```

Page loader data is intentionally unavailable because the page loader is still running.

Controllers inside a pending component receive target-route context through `this.page`, including:

- `this.page.pathname`
- `this.page.route`
- `this.page.status`
- `this.page.params`
- `this.page.layers`
- `this.page.layerData`

`this.page.data` is unavailable during this state.

## Error Components

The route-level `error` export handles loader failures for its page:

```tsx
import type { PageErrorProps } from "@tavojs/core/router";

export function error({ error, pathname }: PageErrorProps) {
  return (
    <main role="alert">
      <h1>Unable to open {pathname}</h1>
      <p>{error instanceof Error ? error.message : "Unknown error"}</p>
    </main>
  );
}
```

An error component receives:

```ts
type PageErrorProps = {
  pathname: string;
  params: Record<string, string | undefined>;
  data: unknown;
  error: unknown;
  layers: RouteDataLayer[];
  layerData: Record<string, unknown>;
};
```

Error resolution follows this order:

1. Use the target page's `error` export when present.
2. Otherwise, use the global `src/pages/_error.tsx` page.

A `notFound()` signal is not treated as a loader error. It bypasses both error views and renders
`src/pages/404.tsx` with HTTP status 404.

## Layout Data

Tavo.js waits for target layout loaders before rendering the page's pending component. This allows
the pending UI to appear inside the correct application or section layout with valid layout data.

```tsx
export function pending({ layerData }: PagePendingProps) {
  const dashboard = layerData["/dashboard"] as
    | { accountName: string }
    | undefined;

  return (
    <DashboardSkeleton accountName={dashboard?.accountName} />
  );
}
```

If a layout loader fails, Tavo.js proceeds to error handling instead of rendering the page pending
component with invalid layout state.

## SSR And Prefetching

`pending` is intended for active browser navigation and initial client-side route resolution.

It is not rendered during:

- Normal server-rendered document generation
- Static prerendering
- Route prefetching
- Navigation resolved entirely from a fresh route cache entry

During SSR, Tavo.js waits for the route loader and sends the completed page or its error view. For
progressive server-rendered sections, use deferred rendering and streaming rather than the route
pending export.

Prefetching performs loader work without changing the URL or replacing the visible route, so it
does not display the pending component.

## Cancellation

Page loaders receive an `AbortSignal`:

```tsx
export async function load({ signal }: PageLoadContext) {
  const response = await fetch("/api/report", { signal });
  return response.json();
}
```

When navigation is replaced by another navigation, Tavo.js:

- aborts the obsolete route resolution;
- removes its pending component;
- prevents obsolete data or errors from replacing the active route.

Pass `signal` to `fetch()` and other abortable operations so superseded work can stop promptly.

## Accessibility

Pending views should communicate their state without trapping users unnecessarily:

```tsx
export function pending() {
  return (
    <main aria-busy="true" aria-label="Loading account">
      <AccountSkeleton />
      <span className="sr-only">Loading account…</span>
    </main>
  );
}
```

Recommended practices:

- Use `aria-busy="true"` on the pending content region.
- Give the skeleton an accessible label or status message.
- Avoid moving focus into a non-interactive skeleton.
- Ensure error views use `role="alert"` or an equivalent announcement strategy.
- Keep skeleton dimensions close to the completed page to reduce layout movement.

## Choosing Between Route Pending And Component Resources

Use a route `pending` export when the page cannot render meaningfully until its page loader
completes:

```text
Page A → Page B skeleton → completed Page B
```

Use `createResource()` inside the page when the page shell can render immediately and only one
section depends on slow data:

```text
Page A → Page B shell with section skeleton → completed section
```

For large datasets, also consider pagination, filtering, or loading only the data required for the
initial viewport. A skeleton improves feedback, but reducing the amount of blocking data usually
provides the larger performance improvement.

## API Summary

```tsx
export const pending = PendingComponent;
export const error = ErrorComponent;

export async function load(context: PageLoadContext) {
  // Return page data or throw an error.
}

export default function Page(props: PageProps) {
  // Render the completed page.
}
```

Both `pending` and `error` are optional and can be either function components or components created
with `createTavo()`.
