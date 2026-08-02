export const head = (
  <>
    <title>tavo preview - about</title>
    <meta name="description" content="Route group layout demo" />
  </>
);

export default function AboutPage() {
  return (
    <section>
      <h4>About Page</h4>
      <p className="tavo-muted">
        This page is under a route group folder and still maps to <code>/about</code>.
      </p>
    </section>
  );
}
