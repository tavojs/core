# Security

> Online guide: [tavojs.dev/docs/core/security](https://tavojs.dev/docs/core/security)

Tavo.js ships with secure defaults for SSR rendering, routing, image optimization, and CLI-generated files. This page explains the behavior developers should know before deploying an app.

## Plugin Trust Boundary

Plugins are trusted application code, not sandboxed extensions. Server and build phases have the
same filesystem, environment, network, and process privileges as other code in the host process.
Client phases have the same browser privileges as the application page. Install and update plugins
with the same care as other executable dependencies.

Plugin API v1 enforces ownership through framework APIs. A plugin cannot enumerate another
plugin's private stores or capabilities through its phase context, and capability resolution is
allowed only for dependencies declared in the compiled manifest. Each application runtime has an
isolated plugin container, while user/session state belongs in request scope.

These checks prevent accidental coupling and make collisions deterministic; they do not protect
against malicious code using JavaScript, Node, browser, or imported package APIs directly. Truly
untrusted extensions require a separate worker, process, or origin with an independently designed
message boundary.

See [Plugin Architecture And Behavior](./plugins-architecture.md) for the complete trust
model, ownership identities, collision keys, lifecycle, diagnostics, and current non-guarantees.

Installing a plugin enables the permissions and default public exposure declared in its manifest.
Use `tavo inspect plugins` before installation and after upgrades to review permission names,
reasons, and public mounts. A plugin cannot use raw document-head HTML without declaring the
`unsafeHeadHtml` permission. Application configuration may remap declared exposure and remains the
only source of exact owner-aware overrides.

The framework permanently reserves `/_tavo/*`. Invalid ownership, ambiguous endpoint matching,
undeclared capability access, missing permissions, and stale overrides stop startup rather than
selecting a winner based on registration order.

## SSR Escaping

Text and attribute values rendered through TSX are escaped by default.

```tsx
export default function Page(props: { title: string }) {
  return <h1>{props.title}</h1>;
}
```

Attribute names are validated before SSR serialization and DOM patching. Unsafe attribute names are skipped. URL-valued attributes such as `href`, `src`, `action`, and `formaction` reject unsafe protocols like `javascript:`.

## Raw Head HTML

Prefer JSX head exports:

```tsx
export const head = (
  <>
    <title>Dashboard</title>
    <meta name="description" content="Team dashboard" />
  </>
);
```

Raw HTML head strings are treated as an escape hatch. Plugin raw HTML requires a manifest-declared
`unsafeHeadHtml` permission with a reviewable reason. Do not pass user input to plugin or page head strings, or to
`<Head unsafeHeadHtml>`.

## Redirects

Middleware redirects are same-origin by default:

```ts
export const middleware = () => ({ redirect: "/login" });
```

External redirects are blocked unless `allowExternalRedirects` is explicitly enabled in runtime options. Avoid enabling this for redirects based on request query values unless you also validate the target against your own allowlist.

## SSR Headers

SSR HTML and optimized image responses include default hardening headers:

```txt
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
X-Frame-Options: SAMEORIGIN
```

If your deployment needs a stricter Content Security Policy, add it at the reverse proxy or hosting
edge.

## Action Origin Checks

Route actions and plugin endpoints validate browser `Origin` headers for unsafe methods by
default. Node SSR handlers also require the request host to be local or explicitly trusted before
accepting same-origin mutation requests, because the request URL is derived from the inbound
`Host` header.

For public Node SSR deployments, configure the canonical hosts your server should accept:

```ts
// tavo.config.ts
import { defineConfig } from "@tavojs/core/config";

export default defineConfig({
  ssr: {
    trustedHosts: ["example.com", "www.example.com"],
    canonicalOrigin: "https://example.com",
  },
});
```

Set `canonicalOrigin` when a trusted proxy terminates HTTPS before forwarding to Node. This keeps
request URLs and origin checks aligned with the public origin while `trustedHosts` continues to
reject unexpected inbound hosts.

This setting applies to the generated Node handler and reverse-proxy deployments, where the
framework creates a request URL from the inbound `Host` header.

Actions or plugin endpoints that intentionally receive cross-origin server-to-server calls,
such as webhook endpoints, can opt out per endpoint:

```ts
export const action = defineAction(handleWebhook, { validateOrigin: false });

export const webhookPlugin = definePlugin({
  id: "@acme/webhook",
  version: "1.0.0",
  apiVersion: 1,
  manifest: {
    endpoints: [
      {
        id: "receive",
        methods: ["POST"],
        match: { kind: "exact", path: "/webhook" },
        validateOrigin: false,
      },
    ],
  },
  server: () => import("./webhook.server"),
});
```

Only disable validation when the endpoint authenticates the request another way, such as a
signature header or shared secret.

## Request Body Limits

Node SSR handlers cap mutation request bodies before buffering them for actions or plugin server
handlers. The default limit is 10 MiB. Apps can tune it with `maxRequestBodyBytes`:

```ts
// tavo.config.ts
import { defineConfig } from "@tavojs/core/config";

export default defineConfig({
  ssr: {
    maxRequestBodyBytes: 1024 * 1024,
  },
});
```

Large upload workflows should use a dedicated upload service or an adapter that streams directly
to storage instead of buffering through route actions.

## SSR Auth And Tokens

Treat authentication as request-scoped during SSR. Do not write the current user, access token, session data, tenant, cart, or permissions into a global store, a global service, or a module-level variable.

Tavo.js includes an opaque signed session-cookie helper for SSR apps:

```ts
import {
  defineAction,
  defineServerLoader,
  defineServerMiddleware,
} from "@tavojs/core/router";

export const action = defineAction(async ({ request }) => {
  const { getAuthSessions } = await import("../server/authSessions");
  const sessions = getAuthSessions();
  const form = await request.formData();
  const user = await verifyLogin(form);

  const session = await sessions.getSession(request);
  session.rotate();
  session.set("userId", user.id);

  return sessions.redirect("/dashboard", session);
});

export const middleware = defineServerMiddleware(async ({ request }) => {
  const { getAuthSessions } = await import("../server/authSessions");
  const sessions = getAuthSessions();
  const session = await sessions.getSession(request);

  if (!session.get("userId")) {
    return { redirect: "/login", status: 302 };
  }
});
```

Session cookies are signed, `HttpOnly`, `SameSite=Lax`, path-scoped to `/`, and marked
`Secure` on HTTPS requests by default. The cookie contains only an opaque session ID; keep
session data in your database, Redis, or another server-side store. `createMemorySessionStore()`
is bounded to 10,000 entries by default and accepts `maxEntries`, but it remains intended for tests
and local demos rather than production persistence.

Keep secrets, sessions, database clients, and private API clients behind a server module boundary.
Tavo.js blocks static imports from `src/server/**` in the client bundle and recognizes the canonical
`@tavojs/core/server-only` marker:

```ts
// src/server/authSessions.ts
import "@tavojs/core/server-only";
import { defineServerOnly } from "@tavojs/core/server";
import { createSessionStorage } from "@tavojs/core/server";

export const getAuthSessions = defineServerOnly(() =>
  createSessionStorage<{ userId: string }>({
    cookie: {
      name: "__session",
      secrets: [process.env.SESSION_SECRET!],
      maxAge: 60 * 60 * 24 * 7,
    },
    store: dbSessionStore,
  }),
);
```

Each session signing secret must be at least 32 bytes. Generate a high-entropy
`SESSION_SECRET` for every deployment environment, keep old secrets after new
ones during rotation, and never commit those values to source control.

Shared route modules can dynamically import server-only helpers from server-only
exports such as actions and server middleware:

```ts
import { defineServerMiddleware } from "@tavojs/core/router";

export const middleware = defineServerMiddleware(async ({ request }) => {
  const { getAuthSessions } = await import("../server/authSessions");
  const sessions = getAuthSessions();
  const session = await sessions.getSession(request);

  if (!session.get("userId")) {
    return { redirect: "/login" };
  }
});
```

Use server loaders to pass safe user data into SSR HTML and the initial CSR hydration
state. Do not return access tokens or session IDs:

```ts
import { defineServerLoader } from "@tavojs/core/router";

export const load = defineServerLoader(async ({ request }) => {
  const { getAuthSessions } = await import("../server/authSessions");
  const sessions = getAuthSessions();
  const session = await sessions.getSession(request);
  const userId = session.get("userId");
  const user = userId ? await getUserById(userId) : null;

  return {
    user: user ? { id: user.id, name: user.name } : null,
  };
});
```

`defineServerLoader()` runs during server-side route resolution and is skipped during
browser route resolution. For client-side navigation, keep the initial safe user data in
a client auth store or refresh it through a server endpoint such as `/api/me`.

The browser can still use a global store for UI state after hydration:

```ts
import { defineGlobalStore } from "@tavojs/core";

type AuthUser = { id: string; name: string };
type AuthState = {
  user: AuthUser | null;
  setUser(user: AuthUser | null): void;
};

export const authStore = defineGlobalStore<AuthState>("auth", () => ({
  user: null,
  setUser(user: AuthUser | null) {
    authStore.patch({ user });
  },
}));
```

Use that client-side store as a convenience for rendering and navigation state. The server should still validate each SSR request from cookies, `Authorization`, or your session backend.

Avoid this during SSR:

```ts
// Unsafe: process-wide state can leak between users.
authStore.setState({ user: await getUserFromRequest(request) });
```

Tavo.js warns when global stores or services are written/registered during SSR because those registries are process-wide on the server. Shared configuration and stateless services are fine; request-specific mutable state is not.

## Image Optimizer

Remote image optimization is disabled by default. When enabled, remote hosts must match `remotePatterns`, use HTTPS unless `allowInsecureRemote` is enabled, and cannot point to private network hosts.

Remote redirects are revalidated on every hop. Local optimized images must live inside `publicDir`; symlink escapes and oversized files are rejected.

## Monitor Endpoint

The generated production SSR server keeps `/_tavo/monitor` hidden unless `TAVO_MONITOR_TOKEN` is configured. Set a strong token and pass the same value to the CLI:

```bash
TAVO_MONITOR_TOKEN=secret node .tavo/build/server/start.mjs
tavo monitor --url https://example.com --token secret
```

Do not expose monitor data publicly without authentication. The CLI sends tokens in the
`Authorization: Bearer ...` header. Query-string tokens are rejected because URLs are commonly
recorded by proxies, shells, browsers, and monitoring systems.

## Content Security Policy

Tavo.js does not set a default Content Security Policy because apps differ in script, style, image,
font, analytics, and deployment needs. Add CSP at your reverse proxy or hosting edge. A strict starting
point for an app with self-hosted assets is:

```txt
Content-Security-Policy: default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; img-src 'self' data:; script-src 'self'; style-src 'self'; font-src 'self'
```

If you use progressive streaming with inline deferred patch scripts, pass a nonce through document
rendering and include it in `script-src`:

```txt
Content-Security-Policy: default-src 'self'; script-src 'self' 'nonce-{nonce}'; object-src 'none'; base-uri 'self'
```

## CLI Generators

Generator names must be relative project paths. Absolute paths, control characters, and `.` or `..` path segments are rejected to prevent accidental writes outside the project tree.
