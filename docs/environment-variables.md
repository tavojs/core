# Environment Variables

> Online guide:
> [tavojs.dev/docs/core/environment-variables](https://tavojs.dev/docs/core/environment-variables)

Choose the runtime boundary before naming or reading an environment variable. Server secrets,
browser-safe configuration, and build configuration have different exposure rules.

## Choose The Boundary

| Boundary | Example | Read it from |
| --- | --- | --- |
| Server only | `process.env.DATABASE_URL` | `src/server`, a server loader, action, middleware, or server plugin phase |
| Browser safe | `import.meta.env.VITE_PUBLIC_API_ORIGIN` | A source module included in browser code |
| Build/configuration | `process.env.TAVO_SITE_URL` | `tavo.config.ts` or server-side build tooling |

Vite replaces `VITE_`-prefixed variables in browser bundles. Never use that prefix for passwords,
signing keys, database URLs, private tokens, or any value that must remain secret.

## Server Environment Files

Tavo loads server environment files from the project root in this order:

```text
.env
.env.local
.env.<mode>
.env.<mode>.local
```

Later files override earlier files. Values already supplied by the shell or hosting platform win
over every file. Development uses the development mode files; production builds and servers use the
production mode files.

Commit only non-secret defaults when appropriate. Keep `.env.local` and mode-local files out of
source control. Commit an `.env.example` containing required names and safe placeholders.

## Keep Secrets Server-only

```ts
// src/server/projects.ts
import "@tavojs/core/server-only";

function requireEnvironmentVariable(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

const databaseUrl = requireEnvironmentVariable("DATABASE_URL");

export function getProjectsDatabaseUrl(): string {
  return databaseUrl;
}
```

Files under `src/server` and modules importing `@tavojs/core/server-only` are enforced client-build
boundaries. Import them only from server loaders, actions, middleware, or server plugin phases. Do
not statically import them into components or universal loaders.

## Expose Browser-safe Configuration

```bash
# .env.example
VITE_PUBLIC_API_ORIGIN=https://api.example.com
```

```ts
// src/config/public.ts
const publicEnvironment = (
  import.meta as ImportMeta & {
    readonly env: Record<string, string | undefined>;
  }
).env;

export const publicConfig = {
  apiOrigin: publicEnvironment.VITE_PUBLIC_API_ORIGIN,
};
```

Restart the development server after changing an environment file. Verify a server value through
the route or handler that consumes it; verify a public value in the browser without logging unrelated
environment data.

## Explicit Server Loading

Generated configuration and server workflows load the appropriate mode automatically. Custom Node
integrations can load it explicitly:

```ts
import { loadServerEnv } from "@tavojs/core/server";

loadServerEnv({
  root: process.cwd(),
  mode: process.env.NODE_ENV === "production" ? "production" : "development",
});
```

`loadServerEnv()` returns the values read from files while preserving environment values that were
already supplied by the process.

## Next Reading

- [Configuration](./configuration.md)
- [Security](./security.md)
- [Deploying To Node](./deployment-node.md)
