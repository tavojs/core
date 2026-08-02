export function head(context) {
  return <title>tavo preview - docs {context.params.section || "index"}</title>;
}

export default function DocsPage(props) {
  return (
    <section className="tavo-panel">
      <h3>Optional Param Route: /docs/[[section]]</h3>
      <p className="tavo-muted">
        section: <code>{props.params.section || "(none)"}</code>
      </p>
    </section>
  );
}
