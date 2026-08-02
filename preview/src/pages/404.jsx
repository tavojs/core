export const head = <title>tavo preview - 404</title>;

export default function NotFoundPage(props) {
  return (
    <section className="tavo-panel">
      <h3>404 Not Found</h3>
      <p className="tavo-muted">
        No page matched: <code>{props.pathname}</code>
      </p>
    </section>
  );
}
