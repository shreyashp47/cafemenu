# Releases

A release is one versioned package of the cafe app. CI builds it when a
version tag is pushed and publishes it as a GitHub Release. The deployer
fetches it from there, verifies it, and deploys it to each cafe's own Firebase
project. The plan behind this is in
[PLAN.md → Releases](../PLAN.md#releases-versions).

## Versions and channels

| Tag             | Channel | Who gets it                                                                     |
| --------------- | ------- | ------------------------------------------------------------------------------- |
| `vX.Y.Z`        | stable  | Cafes on auto-update (stable). Cafes staying on `X.Y` get it if only Z changed. |
| `vX.Y.Z-beta.N` | beta    | Cafes on auto-update (beta). A GitHub prerelease.                               |
| `vX.Y.Z-rc.N`   | beta    | The same: a release candidate is the last beta before `vX.Y.Z`.                 |

- The **minor line** is `X.Y`. An owner who picks "Stay on 1.4" gets every
  `1.4.x` patch automatically and nothing else until they press **Upgrade**.
- A cafe **never moves down**: a version it already runs, or an older one
  (a `1.4.3` patch after the cafe reached `1.5.0`), is skipped.
- Versions follow [Semantic Versioning](https://semver.org/). A tag that
  matches `v*.*.*` but is anything else (`v1.2.3-alpha.1`, `v1.2.3+build`,
  `v1.02.3`) fails the release workflow at its first step, before anything is
  built.
- **A published version never changes.** Don't move, delete or re-push a tag
  once its release is published, and don't replace its assets: cafes may
  already run it. Fix it in the next patch or the next `beta.N`.

## Rolling a release out

Publishing a release doesn't touch any cafe. `deployer rollout --version
<x.y.z> --cafes <cafes.json>`
([packages/deployer](../packages/deployer/README.md#rollout-a-release-to-every-cafe-that-should-get-it))
decides who gets it from the table above, then deploys in waves:

1. **The canary**, the cafe marked `canary` (TOE).
2. **Beta cafes**, in batches.
3. **Stable cafes** and cafes pinned to the version's minor line, in batches.

Each cafe is a full `deploy --version` with its smoke test, which rolls that
cafe back if it fails. The rollout **pauses** before the next cafe when the
canary fails, or when more than 1 in 5 of a batch has failed (both
configurable), and `--resume <rollout-id>` carries on once someone has looked
at why. A beta only ever reaches beta cafes; a patch reaches the cafes pinned
to its line. `--dry-run` prints the plan without deploying anything.

## Cutting a release

1. Start from `main` with CI green. A patch to an older line is tagged on a
   branch from that line's last tag, such as `release/1.4`.
2. In `CHANGELOG.md`, rename `## [Unreleased]` to the version with today's
   date, add a new empty `## [Unreleased]` above it, and commit:

   ```markdown
   ## [Unreleased]

   ## [0.1.0-beta.1] - 2026-10-21

   ### Added

   - …
   ```

   That section becomes the release notes, in the package and on the GitHub
   Release. Without one, GitHub writes notes from the merged pull requests.

3. Tag the commit and push the tag:

   ```bash
   git tag -a v0.1.0-beta.1 -m "v0.1.0-beta.1"
   ```

   ```bash
   git push origin v0.1.0-beta.1
   ```

4. Watch **Actions → Release**. It takes a few minutes.

## What CI does

[`.github/workflows/release.yml`](../.github/workflows/release.yml) runs two
jobs:

1. **test · build · package** (read-only token): checks that the tag is a
   release version, runs `npm ci` at the root, runs the cafe app's tests and
   the release scripts' tests, builds `apps/cafe` (retrying once if
   `next/font` can't reach Google), runs
   [`package.mjs`](../scripts/release/package.mjs), checks the result with
   [`verify.mjs`](../scripts/release/verify.mjs), and uploads the archive and
   `SHA256SUMS` as a workflow artifact.
2. **publish the GitHub release** (`contents: write`, and no npm code runs in
   it): downloads the artifact, verifies it again, and runs
   `gh release create` with the archive and `SHA256SUMS`. Beta and rc tags are
   marked as prereleases. A stable release is marked **Latest** only if it is
   the newest stable version, so a `1.4.3` patch after `1.5.0` doesn't take
   that from `1.5.0`.

[`.github/workflows/release-tooling.yml`](../.github/workflows/release-tooling.yml)
runs the release scripts' tests on every pull request that touches
`scripts/release/`, `migrations/` or either workflow.

## Where the package lands

On the GitHub Release for the tag. The repository is public, so anyone can
download it without a token:

```
https://github.com/shreyashp47/cafemenu/releases/download/v0.1.0-beta.1/cafemenu-cafe-0.1.0-beta.1.tar.gz
https://github.com/shreyashp47/cafemenu/releases/download/v0.1.0-beta.1/SHA256SUMS
```

The deployer finds versions through the releases API
(`GET /repos/shreyashp47/cafemenu/releases`), choosing by channel and minor
line itself rather than relying on GitHub's "Latest" label.

## What is in a package

`cafemenu-cafe-<version>.tar.gz`:

```
release.json             the manifest, always the first entry
NOTES.md                 this version's CHANGELOG.md section, if it has one
firebase.json            apps/cafe/firebase.json, with Hosting's "public" set to "site"
firestore.indexes.json   apps/cafe/firestore.indexes.json
firestore.rules          apps/cafe/firestore.rules
migrations/              migrations/*, apart from schema.json and README.md (can be empty)
site/                    apps/cafe/out: the static export, with sw.js stamped
```

The deployer takes Hosting's headers from `firebase.json`: `nosniff`, frame
protection and the cache rules. An unpacked package is also a Firebase project
folder, so `firebase deploy --project <id>` works from inside it when you need
a manual fallback. Dotfiles in `out/` are left out of the package; Hosting's
`**/.*` ignore rule would skip them anyway.

### `release.json`

```json
{
  "format": 1,
  "name": "cafemenu-cafe",
  "version": "0.1.0-beta.1",
  "channel": "beta",
  "schemaVersion": 1,
  "minSchemaVersion": 1,
  "gitSha": "6d9d49d516f3253d17b3129da876669e0b508b4c",
  "createdAt": "2026-10-20T07:22:12Z",
  "files": [
    {
      "path": "firebase.json",
      "size": 3162,
      "sha256": "b3bd406563d758eee8d2cb61e60f8a1abba94571ce774886b796d2964589fa9c"
    }
  ]
}
```

| Field              | Meaning                                                                                |
| ------------------ | -------------------------------------------------------------------------------------- |
| `format`           | Layout version. `verify.mjs` refuses formats it doesn't know.                          |
| `version`          | Without the `v`.                                                                       |
| `channel`          | `stable` or `beta`, always as the version implies.                                     |
| `schemaVersion`    | The data schema this release migrates a cafe to. From `migrations/schema.json`.        |
| `minSchemaVersion` | The oldest schema whose releases still work on that data, which is the rollback floor. |
| `gitSha`           | The commit it was built from.                                                          |
| `createdAt`        | That commit's time, in UTC. It isn't the build time, so the archive is reproducible.   |
| `files`            | Every other file in the archive, sorted, with its size and SHA-256.                    |

## The schema version and migrations

Both live in [`migrations/`](../migrations/README.md) at the repository root:
`migrations/schema.json` holds `schemaVersion` and `minSchemaVersion`, and
`migrations/NNNN-what-it-does.mjs` is the migration to schema NNNN. Schema 1 is
TOE's data before CafeMenu; schema 2 is
[`0002-money-minor-units.mjs`](../migrations/0002-money-minor-units.mjs), TOE's
whole rupees as paise, with `minSchemaVersion` 2. `package.mjs` refuses to
build when the migrations don't add up to `schemaVersion`.

The deployer runs them as the cafe's service account
([packages/deployer](../packages/deployer/README.md#migrate)), from the data's
`config/meta.schemaVersion` up to the release's `schemaVersion`:

- `deployer deploy --version` runs the package's own migrations before the
  rules and the site, when the release live during the upgrade can run on the
  result (the release's `minSchemaVersion` is at or below the data's schema).
- `deployer migrate --project <id> --to <n>` runs the repository's, outside a
  deploy. A release whose `minSchemaVersion` is above the data's, as the first
  one at schema 2 is for TOE, needs it first, while the cafe is closed.

Both carry on where a stopped run left off, and `--dry-run` says what they
would change without writing.

Upgrading TOE to schema 2, from a checkout of that release:

```bash
deployer migrate --project <toe> --to 2 --dry-run
deployer migrate --project <toe> --to 2          # with the cafe closed
deployer deploy  --project <toe> --site <site> --version <x.y.z> --settings toe.json
```

The deploy keeps the money unit `config/site` now has, even with a settings
file that still says `"major"`, and puts it in `site.json` too. Rolling TOE
back to a release at schema 1 is refused from then on.

## Checking a package

```bash
node scripts/release/verify.mjs cafemenu-cafe-0.1.0-beta.1.tar.gz --version 0.1.0-beta.1
```

With `SHA256SUMS` next to the archive, it checks:

1. The archive's SHA-256 against its line in `SHA256SUMS`, and against
   `--sha256 <hex>` if you pass one. With neither, it refuses.
2. That it unpacks (to 512 MB at most) into plain files and folders only, at
   paths that can't escape the folder they're unpacked into.
3. That `release.json` is well formed, that its channel matches its version,
   that the file name matches the version, and that the version is the one you
   asked for.
4. That the files in the archive are exactly the ones `release.json` lists,
   each with the right size and SHA-256.

It lists every problem it finds and exits 1. `--extract <empty folder>` unpacks
the package after it passes. The deployer can run it like that, or import it:

```js
// scripts/release/verify.mjs, imported by its path in the repository
import { verifyPackage, extractPackage } from "./scripts/release/verify.mjs";

const verified = await verifyPackage(archivePath, { version: "0.1.0-beta.1" });
await extractPackage(verified, workDir); // only ever what verifyPackage returned
```

`sha256sum -c SHA256SUMS` (or `shasum -a 256 -c SHA256SUMS` on macOS) checks
the archive's hash alone.

**What this protects against.** A corrupt or truncated download, and any
change to the archive or to a file inside it. `SHA256SUMS` sits in the same
release as the archive, though, so someone who can edit the repository's
releases could replace both. To close that gap, record the archive's SHA-256
somewhere they can't reach when a release is published (the platform's own
database, say) and pass it as `--sha256`. Signing releases, for example with
GitHub artifact attestations, would be a further step.

## Reproducible packages

The same inputs give a byte-identical archive. Entries are sorted, every entry
has the commit's time as its mtime, uid and gid 0, no owner names and mode 644
or 755, and gzip writes no timestamp and the same OS byte on every platform.
`createdAt` is the commit's time, or `SOURCE_DATE_EPOCH` when that is set.

Two things sit outside the package step:

- **`next build` isn't byte-reproducible yet.** Next.js picks a random build
  ID on every build, and it appears in the HTML and in a folder name. So
  rebuilding a tag gives a different `out/`, and therefore a different archive.
  Packaging the same `out/` twice does give the same bytes.
- **gzip's output comes from the zlib inside Node.** Use the Node version in
  `.nvmrc`, as CI does.

When two archives differ, compare their `release.json` files: the per-file
hashes show exactly which files changed.

## Trying it locally

```bash
npm ci
```

```bash
npm run build -w @cafemenu/cafe
```

```bash
node scripts/release/package.mjs --version 0.1.0-beta.1
```

```bash
node scripts/release/verify.mjs dist/cafemenu-cafe-0.1.0-beta.1.tar.gz
```

The package and `SHA256SUMS` land in `dist/`, which git ignores. Every option
(other input paths, `--out`, `--sha`, `--created-at`) is listed at the top of
`package.mjs`. The release scripts' tests:

```bash
node --test scripts/release/__tests__/*.test.mjs
```

## When a release goes wrong

- **The workflow failed before publishing.** Nothing is public yet. Fix the
  cause, then delete the tag and push it again:
  `git push --delete origin v0.1.0-beta.1`, then `git tag -d v0.1.0-beta.1`.
- **The publish job failed partway.** Check the repository's releases for a
  draft left behind and delete it before re-running the job.
- **A published release is broken.** Leave it in place and cut the next patch,
  or the next `beta.N`. The deployer's rollback handles cafes that already
  have it.
