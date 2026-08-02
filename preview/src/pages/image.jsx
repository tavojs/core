import { Font } from "@tavojs/core";
import { Image } from "@tavojs/core";
import { Script } from "@tavojs/core";
import { Seo } from "@tavojs/core";
import TavoGlyph from "../assets/tavo-glyph.svg?component";

export default function ImagePage() {
  return (
    <section className="tavo-stack">
      <Seo
        title="tavo preview - SEO asset components"
        description="Server-optimized images, managed fonts, SEO metadata, and JSON-LD scripts rendered by Tavo."
        canonical="https://preview.tavojs.dev/image"
        keywords={["tavo", "seo", "image optimization", "json-ld", "fonts"]}
        openGraph={{
          type: "website",
          image: "https://preview.tavojs.dev/tavo-landscape.svg",
          siteName: "Tavo Preview"
        }}
        twitter={{
          card: "summary_large_image"
        }}
      />

      <Font
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=IBM+Plex+Sans:wght@400;600&display=swap"
        preconnect={["https://fonts.googleapis.com", "https://fonts.gstatic.com"]}
        preload
        family="Playfair Display"
        variable="--tavo-display-font"
        fallback="serif"
      />

      <Script
        json={{
          "@context": "https://schema.org",
          "@type": "SoftwareApplication",
          name: "Tavo",
          applicationCategory: "WebFramework",
          operatingSystem: "Any"
        }}
      />

      <section className="tavo-panel">
        <h2 style={{ fontFamily: "var(--tavo-display-font)" }}>SEO Asset Components</h2>
        <p className="tavo-muted">
          This image is rendered as normal HTML on the server with responsive <code>srcset</code>,
          <code>sizes</code>, width and height metadata, then optimized through the built-in
          <code>/_tavo/image</code> endpoint. In pure CSR apps, the same component falls back to
          the original asset URL automatically. The <code>Font</code> component can preload and
          attach external or self-hosted fonts with the same SSR/CSR-friendly API, while
          <code>Seo</code> and <code>Script</code> handle metadata and JSON-LD through built-in
          head components.
        </p>
      </section>

      <section className="tavo-panel">
        <Image
          src="/tavo-landscape.svg"
          alt="Stylized Tavo mountain landscape illustration"
          width={960}
          height={540}
          sizes="(max-width: 900px) 100vw, 960px"
          priority
          style={{ width: "100%", height: "auto", borderRadius: "18px" }}
        />
      </section>

      <section className="tavo-panel">
        <h3>SVG Components</h3>
        <p className="tavo-muted">
          Import <code>*.svg?component</code> to render inline SVG as a Tavo component. Props are
          applied directly to the root SVG, so classes, inline styles, ARIA labels, and sizing work
          like normal JSX.
        </p>
        <TavoGlyph
          aria-label="Tavo glyph"
          width="96"
          height="96"
          style={{ color: "#7c5cff", display: "block" }}
        />
      </section>

      <section className="tavo-panel">
        <pre className="tavo-code">{`<Seo
  title="tavo preview - SEO asset components"
  description="Server-optimized images, managed fonts, SEO metadata, and JSON-LD scripts rendered by Tavo."
  canonical="https://preview.tavojs.dev/image"
  openGraph={{ type: "website", image: "https://preview.tavojs.dev/tavo-landscape.svg" }}
  twitter={{ card: "summary_large_image" }}
/>

<Font
  href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&display=swap"
  preconnect={["https://fonts.googleapis.com", "https://fonts.gstatic.com"]}
  preload
  family="Playfair Display"
  variable="--tavo-display-font"
  fallback="serif"
/>

<Script
  json={{
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "Tavo"
  }}
/>

<Image
  src="/tavo-landscape.svg"
  alt="Stylized Tavo mountain landscape illustration"
  width={960}
  height={540}
  sizes="(max-width: 900px) 100vw, 960px"
  priority
/>

import TavoGlyph from "../assets/tavo-glyph.svg?component";

<TavoGlyph
  aria-label="Tavo glyph"
  width="96"
  height="96"
  style={{ color: "#7c5cff" }}
/>`}</pre>
      </section>
    </section>
  );
}
