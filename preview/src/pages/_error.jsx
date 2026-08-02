export default function ErrorPage(props) {
  return (
    <section className="tavo-panel">
      <h3>Route Load Error</h3>
      <pre className="tavo-error">{String(props.error)}</pre>
      <p className="tavo-muted">
        This was rendered by <code>src/pages/_error.jsx</code>.
      </p>
    </section>
  );
}
