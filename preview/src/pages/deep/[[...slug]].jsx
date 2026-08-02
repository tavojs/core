export default function DeepOptionalCatchAllPage(props) {
  return (
    <section className="tavo-panel">
      <h3>Optional Catch-all: /deep/[[...slug]]</h3>
      <p className="tavo-muted">
        slug: <code>{props.params.slug || "(none)"}</code>
      </p>
    </section>
  );
}
