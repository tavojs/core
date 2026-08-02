# Runtime Inspection

> Online guide: [tavojs.dev/docs/core/runtime-devtools](https://tavojs.dev/docs/core/runtime-devtools)

Tavo exposes privacy-safe snapshots for development tools, diagnostic panels, and editor integrations.

```ts
import {
  inspectTavoRuntime,
  subscribeTavoRuntime,
} from "@tavojs/core/dev";

console.log(inspectTavoRuntime());

const stop = subscribeTavoRuntime((snapshot) => {
  updateDebugPanel(snapshot);
});
```

Snapshots include:

- Current pathname, matched route pattern, parameters, and lifecycle status
- Route count and render/cache policy summaries
- Process-local cache and in-flight resolution counts
- Loaded route-module count
- Route diagnostics
- Mounted component, pending passive-effect, and pending update counts for lifecycle leak checks

Snapshots intentionally exclude loader results, action input, headers, cookies, tokens, services, and store contents. Use instrumentation events for timing history and the runtime snapshot for current operational state.

Low-level runtimes created with `createPagesRuntime()` also expose `runtime.inspect()` directly.

## Browser Panel

Development builds can install a small opt-in panel without a browser extension:

```ts
import { installTavoDevtoolsPanel } from "@tavojs/core/dev";

const panel = installTavoDevtoolsPanel({ initiallyOpen: true });

// Hot-reload or app teardown:
panel.dispose();
```

The panel is never installed automatically and has no production side effects unless the app calls
the function. It renders the same privacy-safe snapshot as `inspectTavoRuntime()` and updates on
route lifecycle changes; use its Refresh button for an immediate component/scheduler snapshot.
