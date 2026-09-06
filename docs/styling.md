# Styling

> Online guide:
> [tavojs.dev/docs/core/seo-assets-and-styling](https://tavojs.dev/docs/core/seo-assets-and-styling)

This guide explains how styling works in Tavo.js applications.

## Framework Position

Styling in Tavo.js is bundler-owned and app-owned.

That means:

- regular CSS imports work
- CSS modules work
- SCSS works when the app bundler supports it
- inline style objects are supported in TSX

## Global CSS

Import global CSS from your app entry:

```tsx
import "./styles.css";
```

This is the most common setup for app-level styles and design tokens.

## CSS Modules

Component-scoped CSS modules are supported:

```tsx
import styles from "./Card.module.css";

export function Card() {
  return <section className={styles.card}>Hello</section>;
}
```

## SCSS And SCSS Modules

If the app has Sass support installed, Tavo.js works with:

- `.scss`
- `.module.scss`

Example:

```tsx
import styles from "./Button.module.scss";
```

The framework ships ambient typing support for style module imports, while the bundler handles the actual transformation.

## Inline Style Objects

Tavo.js also supports style objects in TSX:

```tsx
<div
  style={{
    display: "grid",
    gap: "1rem",
    padding: "1rem",
  }}
/>
```

These styles are also serialized for SSR and compared during hydration.

## SSR Styling

When using SSR, CSS files should be part of the app’s build output so styles are available with the document shell.

Tavo.js’s config and dev server helpers can discover common CSS entry files automatically, and `cssEntries` can be used when your app uses a different structure.

## Runtime Style Registry And Lifecycle

Use `style(id, css, options?)` when a component must register runtime CSS. During SSR it writes to the active style registry. In the browser, a call made while a component renders is owned by that component: shared IDs are reference counted, IDs omitted by the next render are released, and root unmount removes the final owned style.

```tsx
import { style } from "@tavojs/core";

export function PreviewPanel() {
  style("preview.panel", ".preview-panel { display: grid; }");
  return <section className="preview-panel">Preview</section>;
}
```

Calls made outside a component remain persistent for source compatibility. For an explicitly disposable non-component style, use `retainClientStyle()` and invoke its returned disposer:

```ts
import { retainClientStyle } from "@tavojs/core";

const release = retainClientStyle("preview.theme", css, {
  ownerDocument: iframe.contentDocument,
  attributes: { nonce: cspNonce },
});

release();
```

`ownerDocument` keeps iframe or secondary-document styles scoped to the correct document. Under a nonce-based Content Security Policy, pass the host-provided nonce in `attributes`; Tavo.js does not generate or reuse security nonces. `ensureClientStyle()` is the persistent counterpart and is not removed by root disposal.

## Styling Boundaries

Tavo.js styling keeps these responsibilities with the app and bundler:

- full CSS-in-JS authoring and runtime policy
- automatic framework-generated project stylesheets
- project design-token and theme semantics

Styling should stay flexible and easy to integrate with normal web tooling.

## Best Practices

- keep global tokens in app-level CSS
- use CSS modules for component-local styling
- use SCSS when nesting, mixins, or preprocessing adds real value
- keep inline styles for dynamic or one-off layout behavior, not large design systems

## Next Reading

- [Getting Started](./getting-started.md)
- [SEO And Asset Components](./seo-and-assets.md)
