export async function load() {
  throw new Error("Intentional load error from /load-error");
}

export default function LoadErrorPage() {
  return (
    <section className="tavo-panel">
      <h3>Load Error Route</h3>
      <p className="tavo-muted">You should not see this message because load throws first.</p>
    </section>
  );
}
