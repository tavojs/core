import { defineAction } from "@tavojs/core/router";

export const action = defineAction(async ({ request }) => {
  const { authSessions } = await import("../server/session.js");
  const form = await request.formData();
  const intent = form.get("intent");
  const session = await authSessions.getSession(request);

  if (intent === "logout") {
    return new Response(null, {
      status: 303,
      headers: {
        Location: "/",
        "Set-Cookie": await authSessions.destroySession(session),
      },
    });
  }

  session.rotate();
  session.set("userId", "preview-user");
  return authSessions.redirect("/", session);
});

export const head = <title>tavo preview - auth action</title>;

export default function AuthPage() {
  return (
    <section className="tavo-panel">
      <h3>Auth Action</h3>
      <p className="tavo-muted">
        Submit a POST request to this route to create or clear the preview session.
      </p>
    </section>
  );
}
