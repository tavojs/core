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

## Styling Boundaries

Tavo.js styling keeps these responsibilities with the app and bundler:

- CSS-in-JS runtime ownership
- framework-generated CSS files
- framework-only styling functions

Styling should stay flexible and easy to integrate with normal web tooling.

## Best Practices

- keep global tokens in app-level CSS
- use CSS modules for component-local styling
- use SCSS when nesting, mixins, or preprocessing adds real value
- keep inline styles for dynamic or one-off layout behavior, not large design systems

## Next Reading

- [Getting Started](./getting-started.md)
- [SEO And Asset Components](./seo-and-assets.md)
