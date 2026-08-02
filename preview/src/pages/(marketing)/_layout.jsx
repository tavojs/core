export default function MarketingLayout(props) {
  return (
    <section className="tavo-panel">
      <h3>Route Group Layout</h3>
      <p className="tavo-muted">
        This wrapper comes from <code>src/pages/(marketing)/_layout.jsx</code>.
      </p>
      {props.children}
    </section>
  );
}
