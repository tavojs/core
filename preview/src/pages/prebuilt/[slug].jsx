export const prerender = true;

export function generateStaticParams() {
  return [{ slug: "alpha" }, { slug: "beta" }];
}

export const head = ({ params }) => (
  <>
    <title>{`tavo preview - prebuilt ${params.slug}`}</title>
    <meta
      name="description"
      content={`Build-time prerendered dynamic static page ${params.slug}.`}
    />
  </>
);

export default function PrebuiltDynamicPage(props) {
  return (
    <section className="tavo-stack">
      <section className="tavo-panel">
        <h2>Prebuilt Dynamic Page</h2>
        <p>
          Static slug: <code>{props.params.slug}</code>
        </p>
      </section>
    </section>
  );
}
