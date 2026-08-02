import { defineRoutePage } from "@tavojs/core/router";

export default defineRoutePage("/blog/[id]", {
  async load(context) {
    return {
      id: context.params.id,
      title: `Article ${context.params.id}`,
      words: 420
    };
  },
  head(context) {
    return <title>tavo preview - blog {context.params.id}</title>;
  },
  default(props) {
    return (
      <section className="tavo-panel">
        <h3>Dynamic Route: /blog/[id]</h3>
        <p className="tavo-muted">
          Params id: <strong>{props.params.id}</strong>
        </p>
        <pre className="tavo-code">{JSON.stringify(props.data, null, 2)}</pre>
      </section>
    );
  }
});
