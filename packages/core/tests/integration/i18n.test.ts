import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { applyI18nMessageChunk, createI18n, defineMessages } from "../../src/i18n/index.ts";
import { renderPagesResponseAsync } from "../../src/framework/index.ts";
import { createFetchRequestHandler } from "../../src/ssr/handlers.ts";
import { createRoot, createTavo, h } from "../../src/index.tsx";

type GlobalWithDom = typeof globalThis & {
  window?: Window & typeof globalThis;
  document?: Document;
  Node?: typeof Node;
  HTMLElement?: typeof HTMLElement;
  Text?: typeof Text;
};

function setupDom(markup: string) {
  const dom = new JSDOM(markup, { url: "http://localhost/" });
  const globalRef = globalThis as GlobalWithDom;
  globalRef.window = dom.window as unknown as Window & typeof globalThis;
  globalRef.document = dom.window.document;
  globalRef.Node = dom.window.Node;
  globalRef.HTMLElement = dom.window.HTMLElement;
  globalRef.Text = dom.window.Text;
  return dom;
}

function clearDom() {
  const globalRef = globalThis as GlobalWithDom;
  delete globalRef.window;
  delete globalRef.document;
  delete globalRef.Node;
  delete globalRef.HTMLElement;
  delete globalRef.Text;
}

test("i18n: exposes translations through a direct reactive text object", async () => {
  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
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

  const Greeting = createTavo({
    view: () => h("p", null, i18n.text.home.title)
  });

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  createRoot(app).render(h(Greeting, {}));
  assert.equal(app.textContent, "Hello");

  i18n.setLocale("es");
  await Promise.resolve();
  assert.equal(app.textContent, "Hola");

  clearDom();
});

test("i18n: t() calls are reactive when locale changes", async () => {
  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    messages: {
      en: {
        common: {
          nav: "Portfolio tracker"
        }
      },
      es: {
        common: {
          nav: "Rastreador de cartera"
        }
      }
    }
  });

  const NavLabel = createTavo({
    view: () => h("p", null, i18n.t("common.nav"))
  });

  const dom = setupDom(`<!doctype html><html><body><div id="app"></div></body></html>`);
  const app = dom.window.document.getElementById("app");
  assert.ok(app);

  createRoot(app).render(h(NavLabel, {}));
  assert.equal(app.textContent, "Portfolio tracker");

  i18n.setLocale("es");
  await Promise.resolve();
  assert.equal(app.textContent, "Rastreador de cartera");

  clearDom();
});

test("i18n: setLocale persists to the browser locale cookie", () => {
  setupDom(`<!doctype html><html><body></body></html>`);
  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    routing: {
      enabled: true
    },
    messages: {
      en: { common: { label: "English" } },
      es: { common: { label: "Spanish" } }
    }
  });

  i18n.setLocale("es");

  assert.match(document.cookie, /(?:^|;\s*)tavo_locale=es(?:;|$)/);
  assert.equal(document.documentElement.lang, "es");
  assert.equal(document.documentElement.getAttribute("dir"), "ltr");
  clearDom();
});

test("i18n: browser locale cookie is used as the initial locale", () => {
  setupDom(`<!doctype html><html><body></body></html>`);
  document.cookie = "tavo_locale=es; Path=/";

  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    routing: {
      enabled: true
    },
    messages: {
      en: { common: { label: "English" } },
      es: { common: { label: "Spanish" } }
    }
  });

  assert.equal(i18n.locale, "es");
  assert.equal(i18n.t("common.label"), "Spanish");
  assert.equal(document.documentElement.lang, "es");
  clearDom();
});

test("i18n: CSR request locale detection reads the browser locale cookie", () => {
  setupDom(`<!doctype html><html><body></body></html>`);
  document.cookie = "tavo_locale=es; Path=/";

  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    routing: {
      enabled: true
    },
    messages: {
      en: { common: { label: "English" } },
      es: { common: { label: "Spanish" } }
    }
  });

  assert.equal(
    i18n.detectLocale({
      pathname: "/",
      request: new Request("http://localhost/")
    }),
    "es"
  );
  clearDom();
});

test("i18n: non-persistent locale restores do not overwrite the browser locale cookie", () => {
  setupDom(`<!doctype html><html><body></body></html>`);
  document.cookie = "tavo_locale=es; Path=/";

  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    routing: {
      enabled: true
    },
    messages: {
      en: { common: { label: "English" } },
      es: { common: { label: "Spanish" } }
    }
  });

  assert.equal(i18n.locale, "es");

  i18n.setLocale("en", { persist: false });

  assert.equal(i18n.locale, "en");
  assert.match(document.cookie, /(?:^|;\s*)tavo_locale=es(?:;|$)/);
  clearDom();
});

test("i18n: supports dynamic translation keys, interpolation, and merged message updates", () => {
  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    messages: {
      en: {
        common: {
          greeting: "Hello {name}"
        }
      }
    }
  });

  assert.equal(i18n.t("common.greeting", { name: "Ada" }), "Hello Ada");
  assert.equal(i18n.t("common.missing"), "common.missing");

  i18n.setMessages("en", {
    common: {
      farewell: "Bye {name}"
    }
  }, { merge: true });

  assert.equal(i18n.t("common.greeting", { name: "Ada" }), "Hello Ada");
  assert.equal(i18n.t("common.farewell", { name: "Ada" }), "Bye Ada");
});

test("i18n: defineMessages preserves catalogs and generated chunks merge into services", () => {
  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    messages: defineMessages({
      en: {
        common: {
          title: "Common"
        }
      }
    })
  });

  assert.equal(i18n.t("common.title"), "Common");

  applyI18nMessageChunk({
    en: {
      route: {
        title: "Generated route",
        subtitle: "Loaded later"
      }
    }
  });

  assert.equal(i18n.t("route.title"), "Generated route");
  assert.equal(i18n.t("route.subtitle"), "Loaded later");
});

test("i18n: resolves locale-prefixed paths and detects request locale", () => {
  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    routing: {
      enabled: true
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

  assert.deepEqual(i18n.resolvePath("/es/about"), {
    pathname: "/about",
    locale: "es",
    localized: true
  });
  assert.equal(i18n.localizePath("/about", "es"), "/es/about");
  assert.equal(i18n.localizePath("/es/about", "en"), "/about");
  assert.equal(
    i18n.detectLocale({
      headers: {
        "accept-language": "fr;q=0.9, es;q=0.8, en;q=0.1"
      }
    }),
    "es"
  );
  assert.equal(
    i18n.detectLocale({
      cookie: "tavo_locale=%E0%A4%A"
    }),
    "en"
  );
});

test("i18n: SSR renders localized routes with lang and direction metadata", async () => {
  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    routing: {
      enabled: true
    },
    locales: {
      es: {
        dir: "ltr"
      }
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

  const response = await renderPagesResponseAsync(
    {
      "/src/pages/about.tsx": {
        default: () => h("main", null, i18n.text.home.title)
      }
    },
    "/es/about",
    {
      i18n
    }
  );

  assert.equal(i18n.locale, "en");
  assert.match(
    response.html,
    /<html(?=[^>]*\blang="es")(?=[^>]*\bdir="ltr")[^>]*>/,
  );
  assert.match(response.html, /Hola/);
});

test("i18n: SSR request locale detection falls back to default locale per request", async () => {
  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    routing: {
      enabled: true
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
  const modules = {
    "/src/pages/about.tsx": {
      default: () => h("main", null, i18n.text.home.title)
    }
  };

  const spanish = await renderPagesResponseAsync(modules, "/es/about", {
    i18n,
    request: new Request("http://localhost/es/about")
  });
  const fallback = await renderPagesResponseAsync(modules, "/about", {
    i18n,
    request: new Request("http://localhost/about")
  });

  assert.match(spanish.html, /Hola/);
  assert.match(fallback.html, /Hello/);
  assert.match(fallback.html, /<html lang="en"/);
});

test("i18n: concurrent SSR requests render with isolated request locales", async () => {
  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    routing: {
      enabled: true,
      detectFrom: ["cookie", "header"]
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
  let releaseSpanishLoad: (() => void) | null = null;
  let spanishLoadStarted: (() => void) | null = null;
  const spanishLoadStartedPromise = new Promise<void>((resolve) => {
    spanishLoadStarted = resolve;
  });
  const spanishLoadReleasePromise = new Promise<void>((resolve) => {
    releaseSpanishLoad = resolve;
  });
  const handler = createFetchRequestHandler({
    i18n,
    modules: {
      "/src/pages/about.tsx": {
        load: async ({ request }) => {
          const cookie = request instanceof Request ? request.headers.get("cookie") ?? "" : "";
          if (cookie.includes("tavo_locale=es")) {
            spanishLoadStarted?.();
            await spanishLoadReleasePromise;
          }
          return null;
        },
        default: () => h("main", null, i18n.text.home.title)
      }
    }
  });

  const spanish = handler(new Request("http://localhost/about", {
    headers: { cookie: "tavo_locale=es" }
  }));
  await spanishLoadStartedPromise;
  const english = handler(new Request("http://localhost/about", {
    headers: { cookie: "tavo_locale=en" }
  }));

  releaseSpanishLoad?.();
  const [spanishResponse, englishResponse] = await Promise.all([spanish, english]);
  const spanishHtml = await spanishResponse.text();
  const englishHtml = await englishResponse.text();

  assert.match(spanishHtml, /<html lang="es"/);
  assert.match(spanishHtml, /Hola/);
  assert.match(englishHtml, /<html lang="en"/);
  assert.match(englishHtml, /Hello/);
});

test("i18n: concurrent SSR requests keep page head locale isolated", async () => {
  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    routing: {
      enabled: true,
      detectFrom: ["cookie"]
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
  let releaseSpanishLoad: (() => void) | null = null;
  let spanishLoadStarted: (() => void) | null = null;
  const spanishLoadStartedPromise = new Promise<void>((resolve) => {
    spanishLoadStarted = resolve;
  });
  const spanishLoadReleasePromise = new Promise<void>((resolve) => {
    releaseSpanishLoad = resolve;
  });
  const handler = createFetchRequestHandler({
    i18n,
    modules: {
      "/src/pages/about.tsx": {
        load: async ({ request }) => {
          const cookie = request instanceof Request ? request.headers.get("cookie") ?? "" : "";
          if (cookie.includes("tavo_locale=es")) {
            spanishLoadStarted?.();
            await spanishLoadReleasePromise;
          }
          return null;
        },
        head: () => ({
          title: i18n.t("home.title")
        }),
        default: () => h("main", null, i18n.text.home.title)
      }
    }
  });

  const spanish = handler(new Request("http://localhost/about", {
    headers: { cookie: "tavo_locale=es" }
  }));
  await spanishLoadStartedPromise;
  const english = handler(new Request("http://localhost/about", {
    headers: { cookie: "tavo_locale=en" }
  }));

  releaseSpanishLoad?.();
  const [spanishResponse, englishResponse] = await Promise.all([spanish, english]);
  const spanishHtml = await spanishResponse.text();
  const englishHtml = await englishResponse.text();

  assert.match(spanishHtml, /<title>Hola<\/title>/);
  assert.match(spanishHtml, /Hola/);
  assert.match(englishHtml, /<title>Hello<\/title>/);
  assert.match(englishHtml, /Hello/);
});

test("i18n: concurrent awaited loaders read request-local translations", async () => {
  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    routing: {
      enabled: true,
      detectFrom: ["cookie"]
    },
    messages: {
      en: { greeting: "Hello" },
      es: { greeting: "Hola" }
    }
  });
  const started = new Map<string, () => void>();
  const released = new Map<string, Promise<void>>();
  const release = new Map<string, () => void>();
  for (const locale of ["en", "es"]) {
    released.set(locale, new Promise<void>((resolve) => release.set(locale, resolve)));
  }
  const startedPromises = new Map(
    ["en", "es"].map((locale) => [
      locale,
      new Promise<void>((resolve) => started.set(locale, resolve))
    ])
  );
  const handler = createFetchRequestHandler({
    i18n,
    modules: {
      "/src/pages/about.tsx": {
        load: async ({ request }) => {
          const locale = request.headers.get("cookie")?.includes("=es") ? "es" : "en";
          started.get(locale)?.();
          await released.get(locale);
          return { greeting: i18n.t("greeting") };
        },
        default: ({ data }: any) => h("main", null, data.greeting)
      }
    }
  });

  const spanish = handler(new Request("http://localhost/about", {
    headers: { cookie: "tavo_locale=es" }
  }));
  await startedPromises.get("es");
  const english = handler(new Request("http://localhost/about", {
    headers: { cookie: "tavo_locale=en" }
  }));
  await startedPromises.get("en");

  release.get("es")?.();
  const spanishResponse = await spanish;
  release.get("en")?.();
  const englishResponse = await english;

  assert.match(await spanishResponse.text(), /Hola/);
  assert.match(await englishResponse.text(), /Hello/);
});

test("i18n: static SSR cache varies by Accept-Language", async () => {
  const i18n = createI18n({
    defaultLocale: "en",
    serviceName: false,
    routing: {
      enabled: true,
      detectFrom: ["header"]
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
  const handler = createFetchRequestHandler({
    i18n,
    modules: {
      "/src/pages/about.tsx": {
        static: true,
        default: () => h("main", null, i18n.text.home.title)
      }
    }
  });

  const spanish = await handler(new Request("http://localhost/about", {
    headers: { "accept-language": "es" }
  }));
  const english = await handler(new Request("http://localhost/about", {
    headers: { "accept-language": "en" }
  }));
  const spanishHtml = await spanish.text();
  const englishHtml = await english.text();

  assert.match(spanishHtml, /Hola/);
  assert.match(englishHtml, /Hello/);
  assert.equal(spanish.headers.get("vary"), "Accept-Language");
  assert.equal(english.headers.get("vary"), "Accept-Language");
});

test("i18n: SSR can use the registered default i18n service", async () => {
  const i18n = createI18n({
    defaultLocale: "en",
    routing: {
      enabled: true
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

  const response = await renderPagesResponseAsync(
    {
      "/src/pages/index.tsx": {
        default: () => h("main", null, i18n.t("home.title"))
      }
    },
    "/",
    {
      request: new Request("http://localhost/", {
        headers: { cookie: "tavo_locale=es" }
      })
    }
  );

  assert.match(response.html, /<html lang="es"/);
  assert.match(response.html, /Hola/);
});
