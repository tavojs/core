# Getting Started

> Online learning path: [tavojs.dev/docs/getting-started](https://tavojs.dev/docs/getting-started)

Create a working Tavo 1.x application first, then use the rest of this guide to understand the
generated runtime and public package boundaries.

## Prerequisites

- HTML, CSS, TypeScript, and TSX fundamentals
- Node.js `^20.19.0 || >=22.12.0`
- npm and a modern browser

## Outcomes

- Create and run the generated application.
- Identify the route, bootstrap, configuration, and styling boundaries.
- Verify the same route in CSR and SSR development.
- Know where local component state, shared stores, server work, and optional Tavo UI belong.

## What Tavo Is

Tavo is a TypeScript and TSX framework with its own component runtime; it is not a React wrapper.
Vite supplies the development server and bundling pipeline, while Tavo adds file routes, request
data, client and server rendering, hydration, state, and production output.

Its optional MVC component model separates:

- `model`: local reactive component state
- `controller`: business logic, subscriptions, navigation, async work
- `view`: a TSX function that renders output

Tavo also ships:

- file-based pages
- reactive stores
- SSR and hydration
- streaming deferred sections
- framework-managed SEO components

Tavo UI is a separate, optional package for accessible interface components, responsive styling,
and project-owned themes. Framework applications do not require it.

## Create The Application

Use the latest CLI only for the initial bootstrap. Once the project exists, run the version recorded
in its lockfile through package scripts or `npx tavo`.

For a new app:

```bash
npx @tavojs/cli@latest create app my-app
cd my-app
npm install
npm run dev
```

Open the URL printed by Vite and exercise the generated starter. The CLI writes the route directory,
application entry, TypeScript and Vite configuration, development scripts, starter page, and
agent-facing project guidance. It protects existing files unless `--force` is explicitly supplied.

Then verify server development:

```bash
# Stop the CSR server first.
npm run dev:ssr
```

The website’s cumulative
[first-app tutorial](https://tavojs.dev/docs/getting-started/first-app) adds route data, local state,
controller behavior, Tavo UI, navigation, CSR, and SSR with a checkpoint after each change.

## Understand The Generated Vite Setup

Use the framework config helper so app developers do not need to remember JSX runtime settings:

```ts
// vite.config.ts
import { defineTavoViteConfig } from "@tavojs/core/config";

export default defineTavoViteConfig();
```

You can still pass normal Vite options:

```ts
import { defineTavoViteConfig } from "@tavojs/core/config";

export default defineTavoViteConfig({
  server: {
    port: 5173,
  },
});
```

## Understand The HTML Entry

Your HTML shell only needs a mount element and the app entry:

```html
<div id="app"></div>
<script type="module" src="/src/main.tsx"></script>
```

## Understand App Bootstrap

The usual app entry is file-based pages:

```tsx
// src/main.tsx
import { bootTavo } from "@tavojs/core";
import "./styles.css";

void bootTavo({
  rootSelector: "#app",
});
```

`bootTavo()` is the public default bootstrap API for file-based Tavo apps. It:

- discovers page modules
- builds the page manifest
- mounts or hydrates the app based on the current document
- wires navigation state
- applies route loaders and middleware

For advanced routing state, import focused helpers such as `navigate()`, `prefetchRoute()`,
or `subscribeRouteStatus()` from `@tavojs/core/router`. App startup should still go
through `bootTavo()`.

## Minimal Page

Create `src/pages/index.tsx`:

```tsx
export default function HomePage() {
  return <main>Hello from Tavo</main>;
}
```

Add route behavior with named exports:

```tsx
import type { PageProps } from "@tavojs/core/router";

export const head = <title>Home</title>;

export async function load() {
  return { greeting: "Hello from Tavo" };
}

export default function HomePage({ data }: PageProps<{ greeting: string }>) {
  return <main>{data?.greeting}</main>;
}
```

Use the optional `defineRoutePage(...)` helper when its path-aware parameter and loader-data types
are useful:

```tsx
import { defineRoutePage } from "@tavojs/core/router";

export default defineRoutePage("/", {
  head: <title>Home</title>,
  default() {
    return <main>Hello from Tavo</main>;
  },
});
```

## Project Shape

A typical Tavo project looks like this:

```text
src/
  main.tsx
  styles.css
  pages/
    _layout.tsx
    index.tsx
    about.tsx
    blog/
      [id].tsx
  components/
    Header.tsx
  store/
    app.ts
```

Important conventions:

- `src/pages` enables file-based routing
- `src/pages/_layout.tsx` wraps descendant routes
- `src/pages/404.tsx` handles not found routes
- `src/pages/_error.tsx` handles route errors

## Public Package Surface

Import stable application APIs from `@tavojs/core`:

```tsx
import { Seo, createTavo } from "@tavojs/core";
```

Tavo intentionally keeps its import map small:

- `@tavojs/core` for application APIs
- `@tavojs/core/router` for routing and navigation
- `@tavojs/core/server` for Node rendering, sessions, and server utilities
- `@tavojs/core/config` for project and Vite configuration
- `@tavojs/core/plugin` for Plugin API v1
- `@tavojs/core/dev` for explicitly experimental development tools

The root package exports the common runtime APIs such as:

- `createRoot`
- `render`
- `bootTavo`
- `createStore`
- `createTavo`
- `TavoController`
- `createRef`
- `createDirective`
- `Head`
- `Image`
- `Font`
- `Script`
- `Seo`

## First Global Store

Global stores can keep state and action methods together:

```ts
// src/store/app.ts
import { defineGlobalStore } from "@tavojs/core";

export const appStore = defineGlobalStore("app", (set) => ({
  theme: "sunset",
  authenticated: false,
  setTheme(value: string) {
    set({ theme: value });
  },
  setAuthenticated(value: boolean) {
    set({ authenticated: value });
  },
}));
```

Controllers can access registered stores through `this.stores.get("app")`, or modules can import the store directly when that is clearer.

## MVC-first Guidance

Application code should use the explicit MVC and store APIs:

- `createTavo(...)`
- `TavoController`
- controller lifecycle methods such as `onInit()`, `onMount()`, and `onPropsChange(...)`
- controller helpers such as `this.listen(...)`, `this.select(...)`, `this.watch(...)`, and `this.cleanup(...)`
- `createRef(...)` and DOM directives for element behavior
- `this.router`
- `this.page`
- `this.stores`
- `this.services`

That keeps app behavior explicit, testable, and aligned with the framework’s intended structure.

## Next Reading

- [Configuration](./configuration.md)
- [MVC Components](./mvc-components.md)
- [Routing And Pages](./routing-and-pages.md)
