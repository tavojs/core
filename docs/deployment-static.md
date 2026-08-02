# Deploying As Static Files

> Online guide:
> [tavojs.dev/docs/core/static-output-and-cache](https://tavojs.dev/docs/core/static-output-and-cache)

Use this guide when you want to deploy a Tavo app to static hosting without a Node.js runtime.

Static deployment means:

- Node.js is used only at build time, either on your machine or in CI.
- Production serves files from `.tavo/build/client`.
- There is no running Tavo server after deployment.

This is a good fit for client-rendered apps, marketing pages, documentation, dashboards that call
external APIs from the browser, and routes that can be prerendered at build time.

## Build

Run the production build:

```bash
tavo build
```

This writes static client output to:

```text
.tavo/build/client
```

Deploy that directory to your static host.

The build also creates `.tavo/build/server` because Tavo uses the server renderer during the build
to inspect and prerender routes. Static deployments do not upload or run that server directory.

## Prerender Static Routes

For pages that should ship as HTML files, mark the route static:

```tsx
import type { PageProps } from "@tavojs/core/router";

export const prerender = true;

export default function AboutPage() {
  return <main>About</main>;
}
```

For dynamic routes, list the paths to generate:

```tsx
export const prerender = true;

export function generateStaticParams() {
  return [{ id: "hello" }, { id: "intro" }];
}

export default function BlogPost({ params }: PageProps<unknown, { id: string }>) {
  return <main>Post {params.id}</main>;
}
```

After `tavo build`, Tavo writes prerendered HTML files into `.tavo/build/client`, such as:

```text
.tavo/build/client/index.html
.tavo/build/client/about/index.html
.tavo/build/client/blog/hello/index.html
```

Routes with `revalidate` are not static-file routes. They require a Tavo SSR runtime so the server
can refresh cached HTML after the interval.

## Client-Rendered Routes

If a route cannot be prerendered, make it a browser-rendered route:

```tsx
export const render = "csr";

export default function DashboardPage() {
  return <main>Dashboard</main>;
}
```

Static hosts should fall back unknown application routes to `/index.html` so direct visits still
load the Tavo client router.

Use this fallback only for app routes. Static assets should still return 404 when missing.

## Hosting Rules

Set the publish directory to `.tavo/build/client`. When the app contains CSR routes, configure the
host to serve `/index.html` for an application URL that does not match a generated file. Missing
asset URLs must still return 404.

For example, an Nginx static server can use `try_files`:

Point the server root at `.tavo/build/client` and use `try_files`:

```nginx
server {
  listen 80;
  server_name example.com;
  root /var/www/tavo/.tavo/build/client;

  location / {
    try_files $uri $uri/ /index.html;
  }

  location /assets/ {
    try_files $uri =404;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }
}
```

## API And Forms

Static hosting cannot execute Tavo route `action` exports, server loaders, middleware that
depends on server requests, or `createSessionStorage()` sessions.

For forms and mutations, configure CSR actions so non-GET forms submit to an external API:

```tsx
import { bootTavo } from "@tavojs/core";

void bootTavo({
  csrActions: {
    enabled: true,
    baseUrl: "https://api.example.com",
    credentials: "include"
  }
});
```

With this setup, a static form such as `<form method="post" action="/contact">` submits to
`https://api.example.com/contact`. Use `resolveUrl` instead of `baseUrl` when API paths do not
match app route paths.

If the API manages login state, prefer HttpOnly cookies set by the API and fetch safe user data
from the browser with `credentials: "include"`.

## Limitations

Static deployments cannot use:

- request-time SSR
- progressive SSR streaming
- route `action` exports
- `revalidate` static SSR caching
- server image optimization through `/_tavo/image`
- the built-in `/_tavo/monitor` endpoint

Use [Deploying To Node](./deployment-node.md) when the app needs server rendering or server-side
request handling.

## Checklist

1. Mark build-time HTML routes with `prerender = true`.
2. Add `generateStaticParams()` for each dynamic static route.
3. Use `render = "csr"` for routes that should run only in the browser.
4. Move mutations and private server work to an external API.
5. Run `tavo build`.
6. Deploy `.tavo/build/client`.
7. Configure the host to serve prerendered files and fall back app routes to `/index.html`.
