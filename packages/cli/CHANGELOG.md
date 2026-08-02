# @tavojs/cli

## 1.0.0

### Major Changes

- Release the stable Tavo 1.0 framework and CLI contracts. This release establishes functional page
  modules, static prerendering, Node server output, Plugin API v1, one project configuration file,
  stable package boundaries, and launch-grade documentation and verification. The public import map
  is consolidated around the package root plus router, server, config, plugin, and development
  boundaries.

### Minor Changes

- Introduce Tavo machine protocol v1 for AI code generators. Agent commands now use compact versioned
  JSON envelopes, task-scoped context, targeted entity inspection, cached analysis, transactional
  hash-guarded change plans, change receipts, and dependency-aware targeted verification.

  Ship machine schemas, declaration-derived API cards, generated agent guidance, a 45-task evaluation
  corpus, correctness-per-token scoring, deterministic context performance gates, and a
  provider-neutral live-model adapter contract.

- Make Tavo faster, safer, and easier to operate in production. This release adds end-to-end async
  cancellation, tagged cache invalidation and request deduplication, stable diagnostics and artifact
  schemas, stricter client/server boundaries, structured OpenTelemetry-compatible instrumentation,
  validated actions, prioritized scheduling, runtime devtools, plugin API compatibility checks, and
  a production Node runtime plus static build output.

  The CLI now supports transactional feature recipes, dry-run generation plans, build-size budgets,
  and versioned output. Performance regressions are baseline-gated, lifecycle and hydration behavior
  have stronger stress coverage, and the documentation has been reorganized around generated API
  reference, stability, observability, validation, scheduling, and cancellation guides.

- Introduce stable Plugin API v1 with an owned, declarative graph: typed capabilities and stores,
  isolated runtime and request lifecycles, manifest-declared exposure and owner-aware overrides, deterministic
  endpoint and middleware matching, keyed head contributions, declarative build contributions, and
  fatal structured collision diagnostics.

  Add an ergonomic application configuration layer: plain descriptors install directly, plugin
  manifests declare permissions and default public exposure, per-installation `expose` remaps those
  defaults, and `{ use, overrides }` preserves advanced replacement. Plugin inspection reports the
  effective permission and exposure audit with human-readable reasons.

  Add plugin graph inspection and automatic plugin preflight to the Tavo CLI.

### Patch Changes

- Update the CLI dependency to `@tavojs/core@1.0.0`.
