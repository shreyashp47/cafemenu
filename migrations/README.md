# Migrations and the schema version

Each cafe's data has a schema version, kept in the cafe's own Firestore at
`config/meta.schemaVersion`. This folder defines which schema version the code
in this commit expects, and holds the migrations that move a cafe's data from
one version to the next. It sits at the root, not in `apps/cafe`, because the
deployer runs the migrations, not the cafe website.

## `schema.json`

```json
{
  "schemaVersion": 2,
  "minSchemaVersion": 2
}
```

- **`schemaVersion`**: the version a cafe's data is at once this release is
  deployed. Before it deploys the rules and the site, the deployer runs every
  migration above the cafe's current version, up to this one.
- **`minSchemaVersion`**: the oldest schema version whose releases still work
  on data at `schemaVersion`. The deployer won't roll a cafe back to a release
  whose own `schemaVersion` is below it. It's also the check that the release
  already live can keep running while an upgrade migrates its data.

Schema 1 is TOE's data from before CafeMenu, in whole rupees. Schema 2 is the
same in paise ([`0002-money-minor-units.mjs`](0002-money-minor-units.mjs)), and
nothing from before it may run on that, so `minSchemaVersion` is 2 too. Every
release package carries both numbers in its `release.json`
([docs/releases.md](../docs/releases.md)).

## Migrations

One file per schema version, named for the version it brings a cafe's data
to: `0002-money-minor-units.mjs` takes a cafe from schema 1 to schema 2. Code
the migrations share goes in a subfolder (`lib/`). Everything here except
`schema.json` and this README goes into each release package's `migrations/`
folder.

`scripts/release/package.mjs` refuses to build a release when the files don't
add up: each version from 2 to `schemaVersion` needs exactly one migration,
and none may go past it. The release-tooling tests run the same check on this
folder in every pull request that touches it.

A migration exports:

```js
export const from = 1; // the schema it migrates from
export const to = 2; // NNNN, the schema it brings the data to
export const describe = "what it does, in one line";
export async function up(db) {
  await db.each("menu", "menu", (item) => ({ price: item.price * 100 }));
}
```

The deployer runs them as the cafe's service account, in order, from the data's
schema up to the release's: `deployer deploy --version` with the package's, or
`deployer migrate --to <n>` with this folder's
([packages/deployer](../packages/deployer/README.md#migrate)). It refuses a
migration whose `from` isn't where the one before it ends.

`up(db)` changes documents only through `db`
([`src/migration-db.mjs`](../packages/deployer/src/migration-db.mjs)):

- `db.each(step, collection, change)` pages through a top-level collection in
  document-ID order. `change(data, {id, path, createTime})` returns the fields
  to set, or null to leave the document. It returns the step's counts:
  `{seen, changed, late}`.
- `db.update(step, path, change)` does the same for one document (`data` is
  null if it doesn't exist).
- `db.get(path)` reads one; `db.log`, `db.dryRun` and `db.startedAt` are there
  for the report.

Every page is one commit together with the migration's progress in
`config/meta.migration`, and each write needs its document unchanged since it
was read. So a run that stops anywhere carries on where it stopped without
doing anything twice, and `change` only ever sees a document in its old shape.
A document created after the migration started is left alone and counted as
`late`. In a dry run nothing is written, and the counts say what would change.
`step` names the progress: keep each one unique within the migration.

## Adding one

Migrations **expand, then contract** (house rule 4 in
[CONTRIBUTING.md](../CONTRIBUTING.md)):

1. **Expand**: add `000N-….mjs`, which adds the new fields next to the old
   ones, and set `schemaVersion` to N. Leave `minSchemaVersion` alone: the
   previous release still finds the old fields, so rolling back stays safe.
2. **Contract**, a release or more later: add the migration that removes the
   old fields and set `schemaVersion` to its number. Set `minSchemaVersion` to
   the schema version of the first release that stopped reading them, because
   older releases can't run on the data any more.

A migration that can't expand first, because it changes what existing fields
mean, sets `minSchemaVersion` to its own number. `0002` is one: it turns every
amount into paise in place, as
[apps/cafe/docs/decisions.md](../apps/cafe/docs/decisions.md) ("Any currency")
chose over carrying both units. The deploy won't run such a migration under the
release that is live (it can't read the result), so it runs with
`deployer migrate` while the cafe is closed, and the deploy follows.
