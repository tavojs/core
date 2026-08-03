# Contributing

Thanks for helping improve Tavo.js Framework.

## Development

```bash
npm install
npm run build
npm run check:structure
npm run test:integration
npm run test:cli
npm run test:compat
npm run docs:check
```

Run `npm run test:e2e` for changes that affect generated applications, SSR output, routing, or browser behavior. Run `npm run benchmark` for performance-sensitive runtime work.

Run `npm run docs:api` after adding, removing, or renaming public exports. The generated API reference is derived from publish declarations and should be committed with the API change.
Run `npm run docs:agent` after changing machine tasks, API cards, recipes, or public signatures. Run
`npm run test:agent` for every machine-protocol change; context size and analysis latency are release
budgets rather than informational benchmarks.

## Repository Structure

- `packages/core`: published `@tavojs/core` runtime and tests
- `packages/cli`: published `@tavojs/cli` package, `tavo` executable, and tests
- `docs`: user-facing framework guides
- `preview`: integration and browser-test application
- `tests`: compatibility and end-to-end test support

Treat public behavior, generated output, and tests as the source of truth. Avoid adding internal architecture snapshots that duplicate the source tree and become stale.

### CLI source organization

CLI command entry files are stable facades. Put substantial implementations in a folder named after
the command, then separate modules by responsibility—for example `validation`, `safety`, `preflight`,
and `executor`. Do not combine protocol formatting, filesystem mutation, validation, and project
analysis in one module.

`npm run check:structure` enforces a 400-line module budget and a 140-character line budget across core
and CLI source. Existing core hotspots are recorded as a ratchet: they may shrink, but new or larger
violations fail CI. Split by ownership or extract a named helper when a limit is reached; do not raise
the baseline to accommodate a feature. Generated code and declarative templates belong outside command
modules. Run `npm run audit:structure` to print every remaining baseline violation.

Use Changesets for release notes:

```bash
npm run changeset
```

Only maintainers publish packages. The release process, verification gates, and npm trusted
publishing setup are documented in [docs/releasing.md](./docs/releasing.md).

The public repository accepts normal pull requests. Maintainers incorporate merged public changes
into the development source before the next release sync so public contributions are preserved.

## License and copyright

Contributions are submitted under the repository's [MIT License](./LICENSE). Contributors retain
copyright in their own contributions, and no copyright assignment is required.

You must have the legal right to submit all code, documentation, tests, examples, designs, and other
material you contribute. Do not submit incompatible copied material, confidential material,
secrets, generated credentials, or personal data.

The MIT License does not grant trademark rights. See [TRADEMARKS.md](./TRADEMARKS.md) for the
trademark policy that applies to Tavo.js Framework names and logos.

## Developer Certificate of Origin

Every commit in a contribution must carry a Developer Certificate of Origin sign-off. Create a
signed-off commit with:

```bash
git commit --signoff
```

This adds a commit trailer in the following form:

```text
Signed-off-by: Your Name <your.email@example.com>
```

By signing off, you certify the contribution under the
[Developer Certificate of Origin 1.1](https://developercertificate.org/). Unsigned commits may need
to be corrected before the contribution can be merged.

## Documentation Style

Describe Tavo.js Framework by the APIs and workflows it provides. Do not position the framework
through comparisons or by framing it around APIs it does not provide.

Lead with functional page and layout modules. Use named exports for route features and
`prerender = true` for build-time HTML. Present `defineRoutePage(...)` only when its route-aware
typing materially improves the example.

## Pull Requests

- Keep changes focused.
- Include tests for behavior changes.
- Update docs when public APIs, CLI commands, or generated output change.
- Run the relevant package checks before requesting review.
