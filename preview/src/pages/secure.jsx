import { defineMiddleware, isClientRuntime } from "@tavojs/core/router";

async function isAuthenticated(context) {
  if (isClientRuntime()) {
    return window.localStorage.getItem("tavo_preview_auth") === "1";
  } else {
    const { getPreviewUser } = await import("../server/session.js");
    return Boolean(await getPreviewUser(context.request));
  }
}

export const middleware = defineMiddleware(async (context) => {
  if (!await isAuthenticated(context)) {
    return { redirect: "/redirected" };
  }
  return undefined;
});

export const head = <title>tavo preview - secure</title>;

export default function SecurePage() {
  return (
    <section className="tavo-panel">
      <h3>Secure Route</h3>
      <p className="tavo-muted">
        You are authenticated and middleware allowed this route.
      </p>
    </section>
  );
}
