# Localization

> Online guide: [tavojs.dev/docs/core/localization](https://tavojs.dev/docs/core/localization)

Tavo localization is built around MVC-friendly services. Create one i18n service in your app, import it where needed, and read translations directly as an object in views.

```ts
import { createI18n } from "@tavojs/core";

export const i18n = createI18n({
  defaultLocale: "en",
  routing: {
    enabled: true
  },
  locales: {
    en: { label: "English", dir: "ltr" },
    es: { label: "Spanish", dir: "ltr" }
  },
  messages: {
    en: {
      home: {
        title: "Hello"
      }
    },
    es: {
      home: {
        title: "Hola"
      }
    }
  }
});
```

## Direct View Access

`i18n.text` is reactive. When it is read during a Tavo render, the component is connected to the active locale messages.

```tsx
import { createTavo } from "@tavojs/core";
import { i18n } from "../i18n";

export const Hero = createTavo({
  view: () => {
    const text = i18n.text;

    return <h1>{text.home.title}</h1>;
  }
});
```

## Controllers

Controllers can change locale without managing subscriptions manually.

```tsx
class LocaleController {
  setSpanish() {
    i18n.setLocale("es");
  }
}
```

## Dynamic Keys

Use `t()` for dynamic paths, interpolation, and missing-key fallback.

```ts
i18n.t("home.greeting", { name: "Ada" });
```

Direct object access should be the default for normal views. `t()` is best for dynamic keys, user-generated key paths, or strings with parameters.

## Typed Keys

When messages are defined inline or with `as const`, `t()` autocompletes nested translation keys.

```ts
i18n.t("home.title");
i18n.t("home.greeting", { name: "Ada" });
```

For reusable contracts, import the key helper type.

```ts
import type { I18nTranslationKey } from "@tavojs/core";
import { i18n } from "./i18n";

type TranslationKey = I18nTranslationKey<typeof i18n.messages.en>;
```

## Locale Routing

Enable locale-prefix routing with `routing.enabled`. Tavo can then resolve localized URLs while matching the normal page route.

```ts
i18n.resolvePath("/es/about");
// { pathname: "/about", locale: "es", localized: true }

i18n.localizePath("/about", "es");
// "/es/about"
```

Pass the service to the framework runtime or auto-pages bootstrap.

```ts
import { bootTavo } from "@tavojs/core";
import { i18n } from "./i18n";

void bootTavo({
  i18n
});
```

With SSR, `/es/about` renders the `/about` page while setting the active locale to `es`.

## SSR Locale Detection

When `i18n` is attached to the pages runtime, SSR detects locale from the path, cookie, and `Accept-Language` header. Path wins by default.

```ts
const response = await renderPagesResponseAsync(modules, "/about", {
  i18n,
  request
});
```

The rendered document automatically receives `lang` and `dir` from the active locale.

```html
<html lang="es" dir="ltr">
```

Use `routing.detectFrom` to customize detection order.

```ts
createI18n({
  defaultLocale: "en",
  routing: {
    enabled: true,
    detectFrom: ["cookie", "header"]
  },
  messages
});
```
