# @tavojs/core

## 1.0.3

### Patch Changes

- Apply `routing.trailingSlash` consistently across SSR, CSR, prerendering, redirects, forms, plugins, generated production servers, and route-aware links. Preserve external and scheme-based Link destinations during SSR localization, and report only actionable noncanonical links while validating prerendered HTML.

## 1.0.2

### Patch Changes

- 2958197: Correct package author and copyright attribution, and add the project trademark, DCO
  contribution, and private security-reporting policies.
- Standardize public product naming as Tavo.js across documentation, generated application copy,
  schemas, diagnostics, and package metadata.

## 1.0.1

### Patch Changes

- Correct the npm installation and app-creation instructions to use the scoped `@tavojs/cli` package.

## 1.0.0

### Major Changes

- Release the stable Tavo.js 1.0 framework and CLI contracts. This release establishes functional page
  modules, static prerendering, Node server output, Plugin API v1, one project configuration file,
  stable package boundaries, and launch-grade documentation and verification. The public import map
  is consolidated around the package root plus router, server, config, plugin, and development
  boundaries.

### Minor Changes

- Make Tavo.js faster, safer, and easier to operate in production. This release adds end-to-end async
  cancellation, tagged cache invalidation and request deduplication, stable diagnostics and artifact
  schemas, stricter client/server boundaries, structured OpenTelemetry-compatible instrumentation,
  validated actions, prioritized scheduling, runtime devtools, plugin API compatibility checks, and
  a production Node runtime plus static build output.

  The CLI now supports transactional feature recipes, dry-run generation plans, build-size budgets,
  and versioned output. Performance regressions are baseline-gated, lifecycle and hydration behavior
  have stronger stress coverage, and the documentation has been reorganized around generated API
  reference, stability, observability, validation, scheduling, and cancellation guides.

- Add a loader-level `notFound()` helper for dynamic resources, render reserved 404 page head metadata during route resolution, and normalize trailing slashes when preloading static routes for hydration.
- Add route-local `pending` and `error` page component exports. Browser navigation can now render a
  target-route skeleton while its page loader runs, and loader failures prefer the route's error
  component before falling back to the global `_error` page.
- Introduce stable Plugin API v1 with an owned, declarative graph: typed capabilities and stores,
  isolated runtime and request lifecycles, manifest-declared exposure and owner-aware overrides, deterministic
  endpoint and middleware matching, keyed head contributions, declarative build contributions, and
  fatal structured collision diagnostics.

  Add an ergonomic application configuration layer: plain descriptors install directly, plugin
  manifests declare permissions and default public exposure, per-installation `expose` remaps those
  defaults, and `{ use, overrides }` preserves advanced replacement. Plugin inspection reports the
  effective permission and exposure audit with human-readable reasons.

  Add plugin graph inspection and automatic plugin preflight to the Tavo.js CLI.
