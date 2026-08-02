import { createTavo } from "@tavojs/core";
import { subscribeAvailableRoutes } from "@tavojs/core/router";

function toExamplePath(routePath) {
  if (!routePath.includes(":") && !routePath.includes("*")) {
    return routePath;
  }

  return routePath
    .replace(/:\?([A-Za-z0-9_]+)/g, "$1")
    .replace(/:([A-Za-z0-9_]+)/g, "sample")
    .replace(/\*\?([A-Za-z0-9_]+)/g, "$1/a/b")
    .replace(/\*/g, "all/segments");
}

class RouteCatalogController {
  syncRoutes() {
    this.model.patch({
      routes: this.router.routes
    });
  }

  onInit() {
    this.syncRoutes();
    this.cleanup(subscribeAvailableRoutes(() => {
      this.syncRoutes();
    }));
  }
}

export const RouteCatalogView = createTavo({
  model: () => ({
    routes: []
  }),
  controller: RouteCatalogController,
  view: ({ state, controller }) => (
    <section className="tavo-panel">
      <h3>Routes Catalog Store</h3>
      <p className="tavo-muted">
        Powered by <code>getAvailableRoutes()</code> and <code>subscribeAvailableRoutes()</code>.
      </p>
      <ul className="tavo-list">
        {state.routes.map((route) => {
          const samplePath = toExamplePath(route.path);
          return (
            <li key={route.file}>
              <code>{route.path}</code> {" -> "}
              <a
                href={samplePath}
                onClick={(event) => {
                  event.preventDefault();
                  controller?.router.navigate(samplePath);
                }}
              >
                {samplePath}
              </a>
            </li>
          );
        })}
      </ul>
    </section>
  )
});
