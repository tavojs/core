export default function RedirectedPage() {
  return (
    <section className="tavo-panel">
      <h3>Middleware Redirect Example</h3>
      <p className="tavo-muted">
        The secure route redirected here because auth is disabled. Toggle auth in controls and try
        again.
      </p>
    </section>
  );
}
