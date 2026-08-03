import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { createFetchRequestHandler } from "../../src/ssr/handlers.ts";
import { Deferred, Font, Image, Script, Seo, h, renderToString } from "../../src/index.tsx";
import { renderDocument, renderDocumentStream } from "../../src/server.ts";

test("ssr: Image renders optimizer URLs with responsive srcset", () => {
  const html = renderToString(
    h(Image, {
      src: "/hero.svg",
      alt: "Hero image",
      width: 320,
      height: 180,
      sizes: "(max-width: 768px) 100vw, 320px"
    })
  );

  assert.match(html, /src="\/_tavo\/image\?src=%2Fhero\.svg&amp;w=1600&amp;q=75&amp;f=webp"/);
  assert.match(html, /_tavo\/image\?src=%2Fhero\.svg&amp;w=640&amp;q=75&amp;f=webp 640w/);
  assert.match(html, /srcset="/);
  assert.match(html, /sizes="\(max-width: 768px\) 100vw, 320px"/);
});

test("ssr: image optimizer endpoint serves transformed image bytes", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "tavo-image-"));
  const publicDir = path.join(tempRoot, "public");

  await mkdir(publicDir, { recursive: true });
  await writeFile(
    path.join(publicDir, "hero.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
      <rect width="1200" height="800" fill="#17324d" />
      <circle cx="250" cy="220" r="120" fill="#f2d9a0" />
      <rect x="0" y="520" width="1200" height="280" fill="#3c7a5c" />
      <text x="120" y="700" font-size="92" fill="#ffffff">tavo image</text>
    </svg>`
  );

  try {
    const handler = createFetchRequestHandler({
      modules: {
        "/src/pages/index.tsx": {
          default: () => h("main", null, "home")
        }
      },
      images: {
        publicDir
      }
    });

    const response = await handler(
      new Request("http://example.com/_tavo/image?src=/hero.svg&w=320&q=72&f=webp")
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/webp");
    assert.match(response.headers.get("cache-control") ?? "", /immutable/);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.ok(bytes.length > 0);

    await writeFile(path.join(publicDir, "hero.svg"), "not-an-image");
    const cached = await handler(
      new Request("http://example.com/_tavo/image?src=/hero.svg&w=320&q=72&f=webp&ignored=1")
    );
    assert.equal(cached.status, 200);
    assert.deepEqual(new Uint8Array(await cached.arrayBuffer()), bytes);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("ssr: remote image optimizer blocks unsafe hosts before fetching", async () => {
  const handler = createFetchRequestHandler({
    modules: {
      "/src/pages/index.tsx": {
        default: () => h("main", null, "home")
      }
    },
    images: {
      allowRemote: true,
      remotePatterns: ["localhost"]
    }
  });

  const response = await handler(
    new Request("http://example.com/_tavo/image?src=http://localhost/hero.png&w=320")
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("ssr: remote image optimizer requires explicit allowed host patterns", async () => {
  const handler = createFetchRequestHandler({
    modules: {
      "/src/pages/index.tsx": {
        default: () => h("main", null, "home")
      }
    },
    images: {
      allowRemote: true,
      remotePatterns: [{ protocol: "https:", hostname: "cdn.example.com", pathname: "/assets" }]
    }
  });

  const response = await handler(
    new Request("http://example.com/_tavo/image?src=https://other.example.com/hero.png&w=320")
  );

  assert.equal(response.status, 403);
});

test("ssr: malformed image requests are contained without breaking the handler", async () => {
  const handler = createFetchRequestHandler({
    modules: {
      "/src/pages/index.tsx": {
        default: () => h("main", null, "home")
      }
    }
  });

  const malformed = await handler(new Request("http://example.com/_tavo/image"));
  const healthy = await handler(new Request("http://example.com/"));

  assert.equal(malformed.status, 400);
  assert.equal(malformed.headers.get("x-content-type-options"), "nosniff");
  assert.equal(healthy.status, 200);
  assert.match(await healthy.text(), /home/);
});

test("csr: Image falls back to original asset URLs when no SSR marker is present", () => {
  const previousWindow = (globalThis as typeof globalThis & { window?: unknown }).window;
  const previousDocument = (globalThis as typeof globalThis & { document?: unknown }).document;

  (globalThis as typeof globalThis & { window?: unknown }).window = {};
  (globalThis as typeof globalThis & {
    document?: {
      getElementById(id: string): unknown;
      querySelector(selector: string): unknown;
    };
  }).document = {
    getElementById() {
      return null;
    },
    querySelector() {
      return null;
    }
  };

  try {
    const node = Image({
      src: "/hero.svg",
      alt: "Hero image",
      width: 320,
      height: 180,
      sizes: "100vw"
    }) as { props: Record<string, unknown> };

    assert.equal(node.props.src, "/hero.svg");
    assert.equal(node.props.srcset, undefined);
  } finally {
    if (previousWindow === undefined) {
      delete (globalThis as typeof globalThis & { window?: unknown }).window;
    } else {
      (globalThis as typeof globalThis & { window?: unknown }).window = previousWindow;
    }

    if (previousDocument === undefined) {
      delete (globalThis as typeof globalThis & { document?: unknown }).document;
    } else {
      (globalThis as typeof globalThis & { document?: unknown }).document = previousDocument;
    }
  }
});

test("ssr: Font renders preload and stylesheet markup for external fonts", () => {
  const html = renderToString(
    h(Font, {
      href: "https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap",
      preconnect: ["https://fonts.googleapis.com", "https://fonts.gstatic.com"],
      preload: true,
      family: "Playfair Display",
      variable: "--font-display",
      fallback: "serif"
    })
  );

  assert.match(html, /rel="preconnect" href="https:\/\/fonts\.googleapis\.com"/);
  assert.match(html, /rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin="anonymous"/);
  assert.match(html, /rel="preload" as="style"/);
  assert.match(html, /rel="stylesheet" href="https:\/\/fonts\.googleapis\.com/);
  assert.match(html, /--font-display: 'Playfair Display', serif/);
});

test("ssr: Script renders preload and JSON-LD safely", () => {
  const html = renderToString([
    h(Script, {
      src: "/analytics.js",
      preload: true,
      defer: true
    }),
    h(Script, {
      json: {
        "@context": "https://schema.org",
        "@type": "SoftwareApplication",
        name: "Tavo.js <Framework>"
      }
    })
  ]);

  assert.match(html, /rel="preload" as="script" href="\/analytics\.js"/);
  assert.match(html, /<script src="\/analytics\.js" defer><\/script>/);
  assert.match(html, /type="application\/ld\+json"/);
  assert.match(html, /Tavo\.js \\u003cFramework>/);
});

test("ssr: Seo renders title, canonical, and social metadata", () => {
  const html = renderDocument(
    h("main", null, h(Seo, {
      title: "Tavo.js SEO",
      description: "SEO metadata for Tavo.js pages.",
      canonical: "https://tavojs.dev/seo",
      noIndex: true,
      keywords: ["tavo", "seo", "ssr"],
      themeColor: "#0f172a",
      openGraph: {
        type: "website",
        image: "https://tavojs.dev/og.png",
        siteName: "Tavo.js"
      },
      twitter: {
        card: "summary_large_image",
        creator: "@tavojs"
      }
    }))
  );
  const head = html.slice(html.indexOf("<head>"), html.indexOf("</head>"));
  const app = html.slice(html.indexOf('<div id="app">'), html.indexOf("</body>"));

  assert.match(head, /<title>Tavo\.js SEO<\/title>/);
  assert.match(head, /name="description" content="SEO metadata for Tavo\.js pages\."/);
  assert.match(head, /rel="canonical" href="https:\/\/tavojs\.dev\/seo"/);
  assert.match(head, /name="robots" content="noindex"/);
  assert.match(head, /property="og:image" content="https:\/\/tavojs\.dev\/og\.png"/);
  assert.match(head, /name="twitter:card" content="summary_large_image"/);
  assert.doesNotMatch(app, /<title|<meta|rel="canonical"/);
});

test("ssr: streamed deferred patch scripts include document nonce", async () => {
  const stream = renderDocumentStream(
    h(
      Deferred,
      {
        id: "nonce-deferred",
        value: Promise.resolve("ready"),
        fallback: h("p", null, "loading")
      },
      (value: unknown) => h("p", null, String(value))
    ),
    {
      nonce: "abc123",
      initialState: { ok: true }
    }
  );
  const html = await new Response(stream).text();

  assert.match(html, /<script id="__TAVO_STATE__" nonce="abc123" type="application\/json">/);
  assert.match(html, /<script nonce="abc123">/);
});
