import "@tavojs/core/server-only";
import { createMemorySessionStore, createSessionStorage } from "@tavojs/core/server";

function resolvePreviewSessionSecret() {
  const configured = process.env.TAVO_PREVIEW_SESSION_SECRET;
  if (configured) {
    return configured;
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error("TAVO_PREVIEW_SESSION_SECRET is required for production preview sessions.");
  }
  const host = (process.env.HOST || "127.0.0.1").toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
    throw new Error("TAVO_PREVIEW_SESSION_SECRET is required when the preview is exposed beyond loopback.");
  }
  return "tavo-preview-loopback-only-development-secret";
}

export const authSessions = createSessionStorage({
  cookie: {
    name: "__tavo_preview_session",
    secrets: [resolvePreviewSessionSecret()],
    maxAge: 60 * 60,
  },
  store: createMemorySessionStore(),
});

export async function getPreviewUser(request) {
  const session = await authSessions.getSession(request);
  const userId = session.get("userId");
  return typeof userId === "string" ? { id: userId, name: "Preview User" } : null;
}
