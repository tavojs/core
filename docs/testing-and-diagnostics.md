# Testing And Diagnostics

> Online guide:
> [tavojs.dev/docs/core/testing-and-diagnostics](https://tavojs.dev/docs/core/testing-and-diagnostics)

This guide explains how to validate Tavo apps and how to use the framework’s diagnostics surfaces.

## Testing Layers

Tavo currently uses several levels of validation:

- build checks
- integration tests
- E2E tests
- benchmark runs
- preview/manual smoke tests

## Framework Scripts

Useful root commands:

```bash
npm run build
npm run test:integration
npm run test:cli
npm run test:compat
npm run test:e2e
npm run benchmark
npm run benchmark:json
```

## Integration Tests

Integration tests are useful for:

- route resolution
- SSR response behavior
- hydration behavior
- SSR/client parity fixtures
- Node development/production parity
- failure containment
- MVC and store behavior
- router accessibility defaults

They are a good fit for framework correctness without the cost of full browser flows for every change.

## CLI Tests

The CLI has its own Node test suite:

```bash
npm run test:cli
```

These tests live in `packages/cli/tests` and cover:

- argument parsing and shared formatting/path helpers
- route discovery and generated route artifacts
- app/page/component/store/layout generators
- functional and typed-route page scaffold output
- monitor table rendering
- command dispatch through `runCli(...)`

Prefer adding focused CLI tests here when changing command behavior. Use the preview build as the heavier end-to-end check for `tavo build`.

## E2E Tests

Playwright-based E2E tests validate:

- browser navigation
- hydration
- route behavior
- progressive rendering behavior

Use them when changing runtime behavior that needs real browser confirmation.

The E2E suite intentionally stays Chromium-only for normal CI. It covers the production preview
server, generated SSR output, client navigation, a keyboard-oriented workflow, form/action
submission, browser history, and route recovery. Broader browser matrices are better suited to
release or nightly workflows.

## Compatibility Tests

Package compatibility tests validate the built package surface:

```bash
npm run test:compat
```

They import every `@tavojs/core` export subpath, verify declaration files exist, and run
`npm pack --dry-run` with an isolated npm cache so publish contents can be checked without touching
the user's global cache.

## Benchmarks

`npm run benchmark` enforces platform-safe absolute ceilings. `npm run benchmark:check` also compares each matching benchmark against `packages/core/benchmarks/results/latest.json` and fails regressions above 35 percent. The relative margin absorbs normal CI variance while catching meaningful slowdowns below the absolute ceiling.

Refresh the JSON baseline intentionally with `npm run benchmark:json` after reviewing a legitimate performance change; do not update it merely to hide a regression.

The benchmark suite helps detect performance regressions in:

- SSR string rendering
- route resolution
- DOM patching
- keyed list updates
- hydration

Tavo also uses thresholds so benchmark runs can act as regression gates instead of only raw numbers.

Use JSON output for CI artifacts or before/after comparisons:

```bash
npm run benchmark:json
```

The JSON output is written to `packages/core/benchmarks/results/latest.json` and includes the Node version plus every benchmark summary.
It also includes threshold metadata and a pass/fail status for each benchmark, and
`npm run benchmark:json` validates that artifact after writing it.

## Runtime Diagnostics

Tavo can report:

- hydration mismatches
- runtime errors
- mount/patch/hydrate traces
- plugin manifest, dependency, ownership, permission, and lifecycle failures

Configuration lives in `@tavojs/core/dev`:

```ts
configureDevDiagnostics({
  enabled: true,
  devMode: true,
  onHydrationMismatch(event) {
    console.warn(event);
  },
  onError(error) {
    console.error(error);
  },
});
```

Plugin API v1 diagnostics have a stable code, severity, phase, resource, owners, and non-secret
remediation hint. Graph errors are fatal and are reported before any client, server, or build phase
loads. Use `tavo inspect plugins --json` for the compiled ownership graph and `tavo verify --json`
to run plugin preflight with other project checks.

Inspection reports effective manifest-declared permissions and exposure, including the declaring
owner and human-readable reason. Application exposure remapping is reflected in the reported public
paths. Tests should reject privileged contributions that are absent from the plugin manifest.

## Hydration Mismatch Payloads

Hydration mismatch events can include:

- phase
- mismatch kind
- path
- path segments

This helps narrow down where SSR and CSR diverged.

## Accessibility Defaults

Tavo also ships accessibility-oriented routing behavior:

- live region announcements
- focus restoration after client navigation
- `aria-current="page"` on active links
- `aria-busy` on route content containers during route loading

This is part of runtime behavior, so it should be included in browser validation when router internals change.

## Recommended Validation Checklist

When changing framework internals:

1. run `npm run build`
2. run `npm run test:integration`
3. run `npm run test:cli` when CLI behavior changed
4. run `npm run test:compat` when exports, package files, or build output changed
5. run `npm run test:e2e` when browser behavior changed
6. run `npm run benchmark:json` when runtime hot paths changed
7. verify preview routes manually when route/UI behavior is involved

## Next Reading

- [CLI And Build Workflow](./cli-and-build.md)
- [Contributing](../CONTRIBUTING.md)
