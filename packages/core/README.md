# @tavojs/core

The runtime package for Tavo applications. It provides the TSX runtime, DOM rendering, file-based pages, MVC components, stores, routing, SSR, forms, sessions, assets, localization, plugins, and testing helpers.

## Install

```bash
npm install @tavojs/core
npm install --save-dev tavo vite typescript
```

For a complete generated project, use:

```bash
npx tavo@latest create app my-app
```

## Basic Usage

```tsx
// src/main.tsx
import { bootTavo } from "@tavojs/core";

void bootTavo();
```

```tsx
// src/pages/index.tsx
export default function HomePage() {
  return <main>Hello from Tavo</main>;
}
```

Configure Vite with the framework helper:

```ts
// vite.config.ts
import { defineTavoViteConfig } from "@tavojs/core/config";

export default defineTavoViteConfig();
```

## Public Entry Points

The package root exposes stable application APIs, so application code can use one import surface:

```tsx
import { Seo, createTavo } from "@tavojs/core";
```

The developer-facing import map is intentionally small:

- `@tavojs/core` — application components, stores, actions, forms, pages, and boot
- `@tavojs/core/router` — routing, navigation, and route state
- `@tavojs/core/server` — Node rendering, sessions, and server utilities
- `@tavojs/core/config` — project and Vite configuration
- `@tavojs/core/plugin` — stable Plugin API v1
- `@tavojs/core/dev` — explicitly experimental development, testing, and observability tools

The JSX runtime and `server-only` marker are technical integration paths and do not
represent additional feature namespaces developers need to choose between.

## Documentation

The task-first documentation is available at [tavojs.dev/docs](https://tavojs.dev/docs). Start with
the [application guide](https://tavojs.dev/docs/getting-started), then use the
[Core guides](https://tavojs.dev/docs/core) and
[API reference](https://tavojs.dev/docs/core/api).

- [Documentation index](https://github.com/tavojs/core/blob/main/docs/README.md)
- [Getting started](https://github.com/tavojs/core/blob/main/docs/getting-started.md)
- [API configuration](https://github.com/tavojs/core/blob/main/docs/configuration.md)
- [SSR and hydration](https://github.com/tavojs/core/blob/main/docs/ssr-and-hydration.md)
- [Security](https://github.com/tavojs/core/blob/main/docs/security.md)
- [Plugin authoring](https://github.com/tavojs/core/blob/main/docs/plugins.md)
- [Plugin architecture](https://github.com/tavojs/core/blob/main/docs/plugins-architecture.md)

Tavo requires Node.js `^20.19.0 || >=22.12.0` for server and build workflows.

## License

MIT
