# Releasing Tavo

Tavo publishes `@tavojs/core` and `tavo` from the public
[`tavojs/core`](https://github.com/tavojs/core) repository. The private development repository is
not an npm publication source.

## Release Model

- The private repository is the maintainer development source of truth.
- The public repository has its own clean Git history and receives reviewed source snapshots through
  pull requests. Private branches, commits, tags, and internal-only files never cross that boundary.
- Every user-visible package change includes a Changeset.
- Maintainers consume Changesets and generate versions and package changelogs in the private
  repository before creating the public sync pull request.
- Publishing is a separate, manual GitHub Actions dispatch protected by the `npm` environment.
- `@tavojs/core` publishes before `tavo` because the CLI depends on the core package.

## Public Repository Bootstrap

Create `tavojs/core` as a new, empty public repository. Do not mirror the private repository or push
its historical branches and tags.

Export the reviewed working tree into an empty directory:

```bash
npm run export:public -- /absolute/path/to/core-public
cd /absolute/path/to/core-public
git init
git add .
git commit -m "feat: release Tavo 1.0"
git branch -M main
git remote add origin git@github.com:tavojs/core.git
git push -u origin main
```

Review the exported tree before committing. It intentionally excludes private handovers,
`global-changelog`, `.agents`, `.codex`, and the credentialed live-evaluation workflow. The exporter
also rejects environment files, keys, npm configuration, symbolic links, token-shaped secrets, and
references to the private Git remote.

## Subsequent Private-to-Public Syncs

Every later transfer goes through a branch and pull request in the public repository:

```bash
cd /absolute/path/to/private-development-repository
npm run version-packages
git diff -- .changeset package.json package-lock.json packages/core/package.json packages/core/CHANGELOG.md packages/cli/package.json packages/cli/CHANGELOG.md
git add -A .changeset package.json package-lock.json packages/core/package.json packages/core/CHANGELOG.md packages/cli/package.json packages/cli/CHANGELOG.md
git commit -m "chore: version packages"
npm run release:check

cd /absolute/path/to/core-public
git switch main
git pull --ff-only
git switch -c sync/private-release

cd /absolute/path/to/private-development-repository
npm run sync:public -- /absolute/path/to/core-public

cd /absolute/path/to/core-public
git diff --check
npm ci
npm run release:check
git add -A
git commit -m "chore: sync public release"
git push -u origin sync/private-release
```

Review and commit the private version/changelog changes before exporting them. Then open a public
pull request, let public CI pass, review the complete source diff, and merge it before running the
publish workflow. The sync command refuses a dirty public checkout, an unexpected remote, or the
`main`/`master` branch. It replaces only the explicitly managed public paths, so every change is
recoverable and reviewable in Git.

If a contribution is merged directly into the public repository, first bring that commit or patch
into the private development repository. Otherwise the next one-way sync can replace the contributed
file. The source content must converge in the private repository before another public snapshot is
generated.

## Repository Settings

Before accepting contributions:

1. Enable GitHub private vulnerability reporting.
2. Create an `npm` environment, allow deployments only from `main`, require maintainer approval,
   prevent self-review, and disallow protection-rule bypass.
3. Protect `main`: require pull requests, CI status checks, resolved review conversations, and block
   force pushes and deletions.
4. Protect package tags matching `@tavojs/core@*` and `tavo@*`.
5. Give GitHub Actions read/write workflow permission so the release workflow can create version
   pull requests, tags, and releases.

## First Publication

npm Trusted Publisher settings are attached to an existing package, so bootstrap each new package
with a short-lived granular npm token:

1. Confirm both names are still available with `npm view @tavojs/core version` and
   `npm view tavo version`; a 404 is expected before first publication. Owning the `@tavojs`
   organization reserves the scoped name, but not the unscoped `tavo` name.
2. Create a one-day granular npm token with **All Packages**, **Read and write**, and
   **Bypass two-factor authentication**. New package names cannot yet be selected individually.
3. Store it as the `NPM_TOKEN` secret on the protected `npm` GitHub environment.
4. In GitHub Actions, manually run the **Publish** workflow from `main`.
5. Confirm both `@tavojs/core@1.0.0` and `tavo@1.0.0` exist on npm and their GitHub releases and tags
   were created.

The publish workflow runs the complete release verification before calling Changesets. Never
publish a package when that gate fails. Its repository guard makes the job a no-op anywhere except
`tavojs/core`, so the private repository cannot publish these packages.

## Enable Tokenless Trusted Publishing

After the first publication, configure the Trusted Publisher for both npm packages:

- Provider: GitHub Actions
- Organization or user: `tavojs`
- Repository: `core`
- Workflow filename: `release.yml`
- Environment: `npm`
- Allowed action: `npm publish`

Then delete the `NPM_TOKEN` environment secret and revoke the bootstrap token. Future publications
use GitHub OIDC and receive npm provenance automatically.

## Subsequent Releases

For each package change:

```bash
npm run changeset
```

Commit the generated `.changeset/*.md` file with the change. When preparing a release:

1. In the private repository, run `npm run version-packages`.
2. Review and commit the consumed Changesets, package versions, lockfile, and changelogs.
3. Run `npm run release:check`.
4. Sync that exact versioned tree to a public branch with `npm run sync:public -- /path/to/public`.
5. Open and merge the public sync pull request after public CI passes.
6. Open **Actions → Publish → Run workflow** in `tavojs/core`.
7. Approve the `npm` environment deployment.
8. Verify the npm versions, provenance, Git tags, and GitHub releases.

## Local Release Audit

The local gate does not publish:

```bash
npm run release:check
```

To inspect the exact package contents:

```bash
npm pack --dry-run --workspace @tavojs/core
npm pack --dry-run --workspace tavo
```
