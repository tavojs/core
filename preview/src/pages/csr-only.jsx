import { defineRoutePage } from "@tavojs/core/router";

export default defineRoutePage("/csr-only", {
  render: "csr",
  load() {
    return {
      renderedAt: new Date().toISOString()
    };
  },
  head: {
    title: "tavo preview - CSR only"
  },
  default: function CsrOnlyPage({ data }) {
    return (
      <main class="page-stack">
        <section class="panel">
          <h1>CSR Only Page</h1>
          <p>
            This route opts out of SSR for its body. The server sends the app shell,
            then the browser resolves the page loader and renders this content.
          </p>
          <p>
            Client render timestamp: <code>{data?.renderedAt ?? "loading"}</code>
          </p>
        </section>
      </main>
    );
  }
});
