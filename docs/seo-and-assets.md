# SEO And Asset Components

> Online guide:
> [tavojs.dev/docs/core/seo-assets-and-styling](https://tavojs.dev/docs/core/seo-assets-and-styling)

This guide documents Tavo’s framework-owned head, font, image, SVG, script, and SEO primitives.

## `Head`

Use `Head` for framework-owned head insertion when you need component-level control outside page `head` exports.

For route pages, prefer exporting `head` directly from the page module.

If you must insert a raw HTML string, use `unsafeHeadHtml` so the risk is visible in code review:

```tsx
<Head unsafeHeadHtml='<meta name="theme-color" content="#101820">' />
```

Prefer JSX children whenever possible because raw strings are not sanitized by Tavo.

## Page `head`

Page modules can export JSX head content:

```tsx
export const head = (
  <>
    <title>Blog</title>
    <meta name="description" content="Blog page" />
  </>
);
```

Or a function:

```tsx
import type { PageLoadContext } from "@tavojs/core/router";

export function head(context: PageLoadContext) {
  return <title>Post {context.params.id}</title>;
}
```

## `Seo`

`Seo` is a higher-level metadata helper:

```tsx
import { Seo } from "@tavojs/core";

<Seo
  title="Tavo"
  description="A lightweight TSX framework."
  canonical="https://tavojs.dev/"
  openGraph={{ type: "website", image: "https://tavojs.dev/og.png" }}
  twitter={{ card: "summary_large_image" }}
/>;
```

Use it for:

- title
- description
- canonical URL
- robots
- keywords
- Open Graph
- Twitter metadata
- theme color

## `Image`

`Image` is Tavo’s framework-managed image component.

Example:

```tsx
import { Image } from "@tavojs/core";

<Image
  src="/hero.jpg"
  alt="Hero illustration"
  width={1200}
  height={630}
  sizes="100vw"
  priority
/>;
```

Behavior:

- in SSR apps, it can use Tavo’s server optimization endpoint
- in CSR-only apps, it falls back to normal asset URLs

This keeps usage consistent between app modes.

Server optimization uses the optional `sharp` peer dependency. Install it in apps that enable optimized server images:

```sh
npm install sharp
```

Remote images are disabled by default. When enabling them, configure explicit allowed hosts:

```ts
import { defineConfig } from "@tavojs/core/config";

export default defineConfig({
  ssr: {
    images: {
      allowRemote: true,
      remotePatterns: [
        { protocol: "https:", hostname: "images.example.com", pathname: "/assets" }
      ],
      timeoutMs: 5000,
      maxBytes: 10 * 1024 * 1024
    }
  }
});
```

Tavo blocks private-network hosts by default and requires HTTPS unless `allowInsecureRemote` is explicitly enabled for local development.

### Remote Image 500s

If the browser reports a failed optimized image request like:

```text
/_tavo/image?src=https%3A%2F%2Fstatic.example.com%2Fimage.png&w=1600&q=75&f=webp 500
```

open the request response body. These errors usually mean the SSR image optimizer rejected the source before optimization. Common messages:

- `tavo image: remote images are disabled.`
- `tavo image: remote image host is not allowed.`
- `tavo image: the optional "sharp" dependency is required for server image optimization.`

Fix remote-image failures in the app's root `tavo.config.ts`, not in the component:

```ts
import { defineConfig } from "@tavojs/core/config";

export default defineConfig({
  ssr: {
    images: {
      allowRemote: true,
      remotePatterns: [
        { protocol: "https:", hostname: "static.coinstats.app" },
      ],
    },
  },
});
```

Keep the allowlist narrow. Prefer exact hosts and optional path prefixes over broad wildcards.

In dev SSR, restart the Tavo dev server after changing `tavo.config.ts`; image optimizer options are read when the server starts.

## SVG Components

Tavo’s Vite config helper converts SVG files to JSX components when the import uses the `?component` query:

```tsx
import Logo from "./logo.svg?component";

export default function Page() {
  return (
    <Logo
      className="brand-mark"
      style={{ color: "tomato" }}
      aria-label="Tavo"
      width="48"
      height="48"
    />
  );
}
```

Plain SVG imports are unchanged:

```tsx
import logoUrl from "./logo.svg";
```

Generated components render inline SVG. Props are applied to the root `<svg>` element after source attributes, so classes, styles, sizing, events, `aria-*`, and `data-*` attributes can be supplied by the caller. SVGs that use `currentColor` can be themed through `style.color` or CSS.

## `Font`

`Font` helps with external or self-hosted font setup.

External stylesheet example:

```tsx
<Font
  href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap"
  preconnect={["https://fonts.googleapis.com", "https://fonts.gstatic.com"]}
  preload
  family="Playfair Display"
  variable="--font-display"
  fallback="serif"
/>;
```

Self-hosted font use is also supported through `src`-based configuration.

## `Script`

`Script` handles external scripts, inline scripts, and JSON-LD:

```tsx
import { Script } from "@tavojs/core";

<Script
  json={{
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Tavo",
  }}
/>;
```

Use it for:

- JSON-LD
- async or deferred external scripts
- script preload relationships

When using a strict Content Security Policy, pass a document `nonce` to SSR render options and pass the same nonce to `Script` components that render inline content.

## Good SEO Pattern

A typical SEO-focused page might combine:

- page `head`
- `Seo`
- `Font`
- `Image`
- `Script`

That gives:

- metadata
- canonical URLs
- optimized hero media
- structured data
- stable font loading

## Best Practices

- prefer page-level `head` for route metadata
- use `Seo` for common SEO bundles
- always provide real `alt` text to `Image`
- only defer non-critical scripts when possible

## Next Reading

- [SSR And Hydration](./ssr-and-hydration.md)
- [Styling](./styling.md)
