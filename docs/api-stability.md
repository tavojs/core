# API Stability and Diagnostics

> Online guide: [tavojs.dev/docs/core/api-stability](https://tavojs.dev/docs/core/api-stability)

Tavo.js labels every public package entry point as `stable` or `experimental`. The labels are part of
the 1.0 compatibility contract.

## Stability Levels

- `stable`: changes follow semantic versioning. Breaking changes require release notes and a major
  version.
- `experimental`: the entry point is supported and tested, but its shape can change as production contracts mature.

Read the current labels at runtime or from tooling:

```ts
import {
  getApiStability,
  TAVO_API_STABILITY,
} from "@tavojs/core";

console.log(getApiStability("@tavojs/core"));
console.log(TAVO_API_STABILITY);
```

The stable developer-facing entry points are the package root plus `router`, `server`, `config`,
and `plugin`. The single `dev` entry point contains development hooks, page inspection,
instrumentation, validation, scheduling, devtools, and testing helpers and is explicitly
experimental. JSX runtime paths and the `server-only` marker are stable technical integration
boundaries rather than feature namespaces.

Generated route types and build manifests include a schema version. Applications should generate these artifacts with the same Tavo.js CLI used for the build; project diagnostics warn when route artifacts use an incompatible schema.

## Stable Diagnostic Codes

Framework errors intended for application developers use `TavoError` and a stable diagnostic code:

```ts
import { formatTavoError, isTavoError } from "@tavojs/core";

try {
  await startApplication();
} catch (error) {
  if (isTavoError(error)) {
    console.error(error.code, error.details);
    console.error(formatTavoError(error));
  }
}
```

A `TavoError` contains:

- `code`: stable identifier for tests, documentation, IDEs, and support tooling.
- `message`: human-readable failure with the code prefix.
- `hint`: optional remediation guidance.
- `details`: structured, non-secret context such as the invalid option or route.
- `cause`: underlying exception when one exists.

Do not parse error prose. Branch on `code` and treat `details` as diagnostic context rather than a serialization contract.
