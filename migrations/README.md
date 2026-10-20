# Migrations and the schema version

Each cafe's data has a schema version, kept in the cafe's own Firestore at
`config/meta.schemaVersion`. This folder defines which schema version the code
in this commit expects, and holds the migrations that move a cafe's data from
one version to the next. It sits at the root, not in `apps/cafe`, because the
deployer runs the migrations, not the cafe website.

## `schema.json`

```json
{
  "schemaVersion": 1,
  "minSchemaVersion": 1
}
```

- **`schemaVersion`**: the version a cafe's data is at once this release is
  deployed. Before it deploys the rules and the site, the deployer runs every
  migration above the cafe's current version, up to this one.
- **`minSchemaVersion`**: the oldest schema version whose releases still work
  on data at `schemaVersion`. The deployer won't roll a cafe back to a release
  whose own `schemaVersion` is below it. It's also the check that the release
  already live can keep running while an upgrade migrates its data.

Schema 1 is TOE's data as it is today. Every release package carries both
numbers in its `release.json` ([docs/releases.md](../docs/releases.md)).

## Migrations

One file per schema version, named for the version it brings a cafe's data
to: `0002-prices-to-paise.mjs` takes a cafe from schema 1 to schema 2. Code
the migrations share goes in a subfolder (`lib/`). Everything here except
`schema.json` and this README goes into each release package's `migrations/`
folder.

`scripts/release/package.mjs` refuses to build a release when the files don't
add up: each version from 2 to `schemaVersion` needs exactly one migration,
and none may go past it. The release-tooling tests run the same check on this
folder in every pull request that touches it.

What a migration module exports and how the deployer runs it (as the service
account, with a dry run) is for
[#21](https://github.com/shreyashp47/cafemenu/issues/21) to decide.

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

For TOE's prices, say `0002` adds paise next to whole rupees (schema 2,
minimum 1). Later, `0003` drops the rupees (schema 3, minimum 2): releases at
schema 1 still read rupees, so a cafe can't go back to them.
