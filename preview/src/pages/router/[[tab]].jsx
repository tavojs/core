import { createTavo } from "@tavojs/core";
import { createRouter, Link, RouterProvider } from "@tavojs/core/router";

const miniRouter = createRouter([
  {
    path: "/router",
    component: () => (
      <article>
        <h4>Standalone Router Home</h4>
        <p className="tavo-muted">
          This view is selected by <code>createRouter()</code> inside a page-routed app.
        </p>
      </article>
    )
  },
  {
    path: "/router/:tab",
    component: ({ params }) => (
      <article>
        <h4>Standalone Router Tab</h4>
        <p className="tavo-muted">
          Active tab param: <code>{params.tab}</code>
        </p>
      </article>
    )
  }
]);

class ClientRouterLinksController {
  constructor({ model }) {
    this.model = model;
  }

  onInit() {
    this.model.patch({ mounted: true });
  }
}

const ClientRouterLinks = createTavo({
  model: () => ({
    mounted: false
  }),
  controller: ClientRouterLinksController,
  view: ({ state }) => {
    if (!state.mounted) {
      return (
        <p className="tavo-muted">
          Link demo mounts after hydration because standalone router links are client-side.
        </p>
      );
    }

    return (
      <section>
        <RouterProvider router={miniRouter}>
          <nav className="tavo-nav">
            <Link to="/router" className="tavo-nav-link">
              Router home
            </Link>
            <Link to="/router/alpha" className="tavo-nav-link">
              Alpha tab
            </Link>
            <Link to="/router/beta" className="tavo-nav-link">
              Beta tab
            </Link>
          </nav>
        </RouterProvider>
        <RouterProvider
          router={miniRouter}
          notFound={<p className="tavo-muted">Mini router did not match this path.</p>}
        />
      </section>
    );
  }
});

export const head = <title>tavo preview - standalone router</title>;

export default function RouterInteropPage(props) {
  return (
    <section className="tavo-panel">
      <h3>Standalone Router Interop</h3>
      <p className="tavo-muted">
        Auto pages handles the file route, while <code>RouterProvider</code>, <code>Link</code>,
        and <code>createRouter</code> handle this nested demo.
      </p>
      <p className="tavo-muted">
        SSR-safe auto-page param: <code>{props.params.tab || "(home)"}</code>
      </p>
      <ClientRouterLinks />
    </section>
  );
}
