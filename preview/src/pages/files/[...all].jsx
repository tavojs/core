export default function FilesCatchAllPage(props) {
  return (
    <section className="tavo-panel">
      <h3>Catch-all Route: /files/[...all]</h3>
      <p className="tavo-muted">
        matched: <code>{props.params.all || "(empty)"}</code>
      </p>
    </section>
  );
}
