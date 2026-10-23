# @cafemenu/deployer

Sets up a cafe owner's Firebase project and deploys CafeMenu to it, as the
platform's service account, over Google's REST APIs. This is the `deployer`
from [PLAN.md](../../PLAN.md#how-it-fits-together): the owner adds the
platform's service account as a member of their own project, and from then on
this package does the rest.

> [!WARNING]
> **Not yet run against real projects.** Every request and response shape
> comes from Google's REST reference, and every command is tested against a
> fake Google (`tests/helpers/fake-google.mjs`). None of it has been run
> against a real Firebase project yet, because the platform project and the
> test cafe from [#2](https://github.com/shreyashp47/cafemenu/issues/2) don't
> exist yet. Each call that still needs a real run has an
> `// UNVERIFIED: run in spike #N` comment; the
> [list is below](#what-the-spikes-need-to-check). Don't point it at a real
> cafe until the spikes are done.

Node 20.9 or later. No third-party dependencies: built-in `fetch`,
`node:crypto` to sign the service-account JWT, `node:zlib` to gzip Hosting
files, `node:util` `parseArgs`. From the repository it uses
[`@cafemenu/shared`](../shared/README.md) for a cafe's own files and
`scripts/release/verify.mjs` to check release packages, so it runs from a
checkout of the repository. `@cafemenu/shared` is TypeScript, which only a
Node that strips types can import, so **`deploy --version` and
`sync-branding` need Node 22.18 or later**; on Node 20 they stop with a
message saying so. The other commands, and every test, run on Node 20.

## Commands

```bash
deployer check     --project <id>
deployer provision --project <id> --region <location> --site <name>
deployer deploy    --project <id> --site <name> --version <x.y.z> --settings <cafe-settings.json> [--logo <png>]
deployer deploy    --project <id> --rules firestore.rules --indexes firestore.indexes.json \
                   --site <name> --dir out --config firebase.json --target app
deployer migrate   --project <id> --to <n>
deployer rollback  --project <id> --site <name>
deployer sync-branding --project <id> --site <name> --settings <cafe-settings.json> [--logo <png>]
deployer owner     --project <id> --email <email> --name <name>
```

From the repo root, `npm run deployer -w @cafemenu/deployer -- <command> …`
or `node packages/deployer/bin/deployer.mjs <command> …`.
`deployer <command> --help` lists every option.

Every command takes:

| Option           | What it does                                                                 |
| ---------------- | ---------------------------------------------------------------------------- |
| `--project <id>` | The cafe's Firebase project ID. Required.                                    |
| `--key <path>`   | The service-account JSON key. Defaults to `$GOOGLE_APPLICATION_CREDENTIALS`. |
| `--dry-run`      | Read everything, print what would change, change nothing.                    |

The key is the most sensitive thing in this project: it can rewrite the rules
of every connected cafe. Keep it out of the repository
([SECURITY.md](../../SECURITY.md)). The deployer never prints the key or the
access token, keeps the private key out of anything it logs, and only sends
the token to `https://*.googleapis.com`.

### `check`

Tests which of the permissions the other commands need the service account
holds on the project, and names each missing one with what it's for. This is
what the console's **Check connection** button will run, and its list is the
starting point for the smallest role set
([#3](https://github.com/shreyashp47/cafemenu/issues/3)).

```bash
deployer check --project lantern-cafe-1a2b
deployer check --project lantern-cafe-1a2b --for provision,owner
```

Exits 3 if anything is missing. The call itself needs no permission, but
Google answers 403 when the service account can't see the project at all,
and the deployer says so.

### `provision`

Turns a fresh Firebase project into one a cafe can run on, in this order:

1. **Firebase project:** looks it up, and gets its project number.
2. **APIs:** turns on whichever of these are off: Firebase Management,
   Hosting, Rules, Firestore, Identity Toolkit, Secure Token, Cloud Resource
   Manager.
3. **Firestore database:** creates `(default)` in Native mode in `--region`
   (for example `eur3`, `nam5`, `asia-south1`). An existing database is kept,
   with a warning if it's in another region, since a database can't move.
4. **Sign-in methods:** turns on Email/Password (password required) and
   Anonymous, setting only what's off.
5. **Web app:** registers a web app named `CafeMenu` (`--app-name` to change)
   and reads its config. An app with that name is reused.
6. **Hosting site:** creates `<site>.web.app` linked to that web app, so
   `/__/firebase/init.json` serves its config. A site already in this project
   is reused and linked if it isn't.

Every step reads first and changes only what's missing, so **running it twice
changes nothing**. When a step needs a person, the others still run, and the
command ends with exit 3 and every such step listed:

- **Site name taken:** names are unique across all of Firebase. The deployer
  checks a few nearby names (`<site>-cafe`, `<site>-menu`, …) and suggests
  the free ones.
- **Authentication never set up:** on a project without billing, Google
  only lets the console do this (the API's `initializeAuth` is for
  billing-enabled projects), so the owner presses Authentication → **Get
  started** once. This is what we expect; spike #4 confirms it.

```bash
deployer provision --project lantern-cafe-1a2b --region eur3 --site lantern-cafe --dry-run
deployer provision --project lantern-cafe-1a2b --region eur3 --site lantern-cafe
```

### `deploy --version`: a release

Deploys one CafeMenu release to one cafe, in the order PLAN.md gives. Each
step compares with what is live and skips itself when nothing would change, so
a run that failed part way is finished by running it again.

1. **Package.** Downloads `cafemenu-cafe-<version>.tar.gz` and `SHA256SUMS`
   from the GitHub Release (public, no token), or takes `--package <archive>`
   with `SHA256SUMS` next to it, and runs every check of
   `scripts/release/verify.mjs` ([docs/releases.md](../../docs/releases.md#checking-a-package)).
   `--sha256 <hex>` adds a hash from somewhere trusted more than the release.
   A package that fails is refused before anything in the project is touched
   (exit 3).
2. **Schema.** Reads the data's schema version from `config/meta` (1 without
   it: TOE's data as it is). Refuses a package whose `minSchemaVersion` is
   above it (the release live during the upgrade couldn't run on the migrated
   data: deploy one in between first, or `migrate` with the cafe closed), or
   whose `schemaVersion` is below the cafe's schema floor (see
   [the deploy log](#the-deploy-log)).
3. **Migrations.** Runs the package's `migrations/` from the data's schema up
   to the package's, as [`migrate`](#migrate) does. Only migrations the live
   release can run alongside get here: one that raises `minSchemaVersion` to
   its own number is refused in step 2, and runs with `migrate` while the
   cafe is closed.
4. **Rules and indexes** from the package, as below.
5. **Settings.** Writes the cafe's settings to `config/site`, which the rules
   read (the order cap, the time zone) and which the app lets win over
   `site.json` field by field, so the two must agree. The money unit stays
   the data's: if `config/site` counts minor units and the settings say
   `"major"` (TOE's file after 0002), it keeps `"minor"`, converts
   `maxOrderTotal`, writes that to `config/site` and `site.json` alike, and
   warns. Only a migration changes the unit.
6. **Hosting.** The package's `site/` with its `firebase.json` headers, the
   build's demo files replaced by the cafe's own, made by `@cafemenu/shared`
   from `--settings` and `--logo`: `site.json`, `manifest.webmanifest`,
   `logo.png` (only with a logo) and every app icon. Only files Hosting
   doesn't have are uploaded.
7. **Smoke test.** `smokeTest` in `src/smoke-test.mjs`, the hook
   [#22](https://github.com/shreyashp47/cafemenu/issues/22) fills in; skipped
   for now.
8. **Record.** The release becomes current in the deploy log and the one it
   replaced becomes previous. A failed run is recorded as failed, with the
   step it stopped at. Once Hosting is live, the release counts as current even if
   a later step fails, so `rollback` goes back to the one before it.

```bash
deployer deploy --project lantern-cafe-1a2b --site lantern-cafe \
  --version 1.4.2 --settings lantern.json --logo lantern.png
```

`--settings` is the cafe's `CafeSettings` as JSON (what the console keeps in
`cafes/{id}.settings`), checked with `validateCafeSettings`: every field, the
current schema. A logo must be a PNG; if the settings' `logo` is `/logo.png`,
`--logo` is required.

### `migrate`

Brings a cafe's data to a schema version outside a deploy, with the
migrations in the repository's `migrations/` folder, so run it from a
checkout of the release you deploy next. `--migrations <dir>` takes them from
somewhere else.

```bash
deployer migrate --project toe-cafe --to 2 --dry-run   # counts, writes nothing
deployer migrate --project toe-cafe --to 2
deployer deploy  --project toe-cafe --site toe-cafe --version 0.2.0 --settings toe.json
```

1. Reads `config/meta.schemaVersion` (1 without it). At or past `--to`, it
   does nothing.
2. Loads every `NNNN-what-it-does.mjs`. Each exports `from`, `to` (NNNN),
   `describe` and `up(db)`. It refuses one whose `from` isn't where the one
   before it ends (or the data's schema, for the first), before anything
   runs: a "contract" never runs on data its "expand" hasn't reached.
3. Runs them in order. `up(db)` changes documents through
   `src/migration-db.mjs`: `db.each(step, collection, change)` pages through
   a top-level collection in document-ID order, 300 at a time, and
   `db.update(step, path, change)` does one document. Each page is one commit
   with the migration's progress in `config/meta.migration`, and each
   document's write requires it unchanged since it was read. So a run that
   stops anywhere carries on where it stopped, without doing a page twice,
   and a page something else wrote to meanwhile is refused whole and read
   again on the next run. A document created after the migration started is
   left alone and reported, since it may already be in the new shape.
4. Records `config/meta.schemaVersion = to` and removes the progress, one
   migration at a time.

`--dry-run` reads everything and prints the counts it would change. Each
migration in it sees the data as it is now, not as the one before would have
left it.

**[0002](../../migrations/0002-money-minor-units.mjs)**, TOE's whole rupees to
paise, as [apps/cafe/docs/decisions.md](../../apps/cafe/docs/decisions.md)
("Any currency") planned: `menu/*.price`, `orders/*.total` and every
`orders/*.items[].price` times 100 (10 to the currency's digits), then
`config/site` at settings schema 2 with `"moneyUnit": "minor"` and
`"maxOrderTotal": 1000000`. A cafe whose `config/site` already counts minor
units has nothing to change. It never reads `dayCounters`, `tableKeys` or
`staff`. Until `config/site` changes, open pages show the migrated amounts
100 times too large and the rules refuse big orders, so run it with the cafe
closed; `site.json` follows on the next deploy or `sync-branding`.

### `deploy`: rules, indexes and a folder

Deploys any of three parts, in this order (rules and indexes before the
bundle that needs them). Nothing is recorded in the deploy log.

- **Rules** (`--rules firestore.rules`): uploads the file as a new ruleset
  and points the `cloud.firestore` release at it. Skipped when the live rules
  are the same text.
- **Indexes** (`--indexes firestore.indexes.json`): starts building each
  composite index the project doesn't have yet. Existing indexes that aren't
  in the file are left alone. The build takes a few minutes, and queries that
  need an index fail until it's ready. `fieldOverrides` aren't deployed yet
  (TOE has none).
- **Hosting** (`--site <name> --dir <build>`): gzips and hashes every file,
  creates a version, tells Hosting each path's hash, uploads **only the files
  Hosting asks for**, finalizes the version and releases it. Skipped when the
  live version already serves the same files with the same config.
  `--config firebase.json` (and `--target app` when it has several hosting
  entries) carries over its headers, redirects, rewrites, `cleanUrls`,
  `trailingSlash` and `ignore` list. Without it, dotfiles, `node_modules` and
  `firebase.json` are ignored, as `firebase-tools` does.

By default it deploys every part whose files are given. `--only
rules,indexes,hosting` picks parts. `--message <text>` is stored with the
Hosting release.

```bash
deployer deploy --project lantern-cafe-1a2b \
  --rules apps/cafe/firestore.rules --indexes apps/cafe/firestore.indexes.json \
  --site lantern-cafe --dir apps/cafe/out --config apps/cafe/firebase.json --target app
```

If a Hosting deploy stops halfway, the unfinished version is never released
and Hosting discards it after 12 hours. Re-running starts a new version, and
files already uploaded aren't uploaded again.

### `rollback`

With a release recorded in the deploy log, goes back to the previous
release:

1. **Schema.** Refuses if the cafe's data has been migrated past what the
   previous release can read: its `schemaVersion` is below the cafe's schema
   floor (the `minSchemaVersion` of the releases deployed so far). Going back
   over an "expand" migration is fine; over a "contract" one it isn't
   ([migrations/README.md](../../migrations/README.md)).
2. **Rules.** Points `cloud.firestore` at the previous release's ruleset
   again. If that ruleset has been deleted, it says to deploy that version
   instead.
3. **Hosting.** Releases the previous release's version again. If the cafe's
   own files (`site.json`, manifest, logo, icons) have changed since then, it
   makes a version of the previous release's files with today's instead, so a
   rollback never brings back old branding. Hosting already has every one of
   those files, so nothing is uploaded.
4. **Record.** The previous release becomes current, with no previous: a
   second rollback refuses rather than going forward again. Deploy a version
   to move on.

```bash
deployer rollback --project lantern-cafe-1a2b --site lantern-cafe
```

Re-running a rollback that stopped part way is safe: the steps already done
are skipped.

With no release recorded for the project, or with `--to`, only Hosting rolls
back, and the deploy log is left as it is. Hosting-only rollback makes the site serve the
version it served before the current one, by releasing that version again. Hosting keeps old versions, so this takes effect
at once. "Before the current one" means before the live version _first_ went
live, so a second rollback steps back again instead of flipping between two
versions. Only the releases Hosting still keeps for the live channel
(its `retainedReleaseCount`) can be gone back to.

```bash
deployer rollback --project lantern-cafe-1a2b --site lantern-cafe
deployer rollback --project lantern-cafe-1a2b --site lantern-cafe --to 3f9a2c1d
```

`--to <version>` releases that version instead and does nothing if it's
already live, so retrying it is safe. The command prints the `--to` for the
rollback it just did.

### `sync-branding`

What the console runs when an owner edits their branding: writes the settings
to `config/site`, then serves the live Hosting version's files with the cafe's
own (`site.json`, manifest, `logo.png`, icons) made again from `--settings`
and `--logo`. Every other file keeps its hash, so only the cafe's files are
uploaded, and the release doesn't change. Without a logo, `/logo.png` is
dropped. Running it again with the same settings changes nothing. The money
unit stays the data's, as in a deploy.

```bash
deployer sync-branding --project lantern-cafe-1a2b --site lantern-cafe \
  --settings lantern.json --logo lantern.png
```

### The deploy log

`deploy --version`, `rollback` and `sync-branding` remember what each cafe
runs in a deploy log, `--log <file>` (default `cafemenu-deploys.json` in the
current folder). It is the record `rollback` relies on, so keep it.
`src/deploy-log.mjs` defines the `DeployLog` interface (`get(project)`,
`record({deployment, cafe})`). The CLI's implementation is that JSON file:

```jsonc
{
  "format": 1,
  "cafes": {
    "lantern-cafe-1a2b": {
      "site": "lantern-cafe",
      "current": {
        "version": "1.4.2",
        "schemaVersion": 1,
        "minSchemaVersion": 1,
        "sha256": "…", // the package's
        "hostingVersion": "sites/lantern-cafe/versions/…",
        "rulesetName": "projects/lantern-cafe-1a2b/rulesets/…",
        "cafePaths": ["/apple-touch-icon.png", "…"], // the cafe's own files
        "deployedAt": "…",
      },
      "previous": { "version": "1.4.1", "…": "…" },
      "schemaFloor": 1,
    },
  },
  "deployments": [
    {
      "id": "…",
      "project": "…",
      "site": "…",
      "kind": "deploy",
      "version": "1.4.2",
      "fromVersion": "1.4.1",
      "status": "succeeded",
      "steps": [{ "id": "package", "label": "…", "status": "done" }],
      "error": null,
      "createdAt": "…",
      "finishedAt": "…",
    },
  ],
}
```

A platform-Firestore implementation for the console comes later (TODO in
`src/deploy-log.mjs`): it writes `cafes/{id}.release.{current,previous}` and
`deployments/{id}`, the shapes in `apps/console/src/lib/platform/model.ts`.

### `owner`

Sets up the owner's first account, which TOE does today with
`npm run seed:staff -- --role=owner` (`scripts/lib/seed-staff.mjs`):

1. Creates an Email/Password account for `--email`, **with no password**, if
   there isn't one.
2. Writes `/staff/{uid}` = `{ name, role: "owner" }`, touching only those two
   fields, as `seed-staff` does.
3. Sends the project's own password-reset email, so the owner picks their
   own password and the platform never handles one. Skipped once they've set
   a password, so re-running only re-sends the email while it's still needed.
   `--no-email` skips it.

```bash
deployer owner --project lantern-cafe-1a2b --email asha@lantern.cafe --name Asha \
  --continue-url https://lantern-cafe.web.app/staff
```

`--continue-url` is where the reset page sends them afterwards. Its domain must
be an authorized domain in the project's Authentication settings. The
project's own default domains are; whether a second site such as
`lantern-cafe.web.app` needs adding is for spike #6 to find out.

## Output and exit codes

Each step prints a `>` line, and every line under it starts with a marker:

```
Setting up project lantern-cafe-1a2b
> Firestore database
  = (default) exists in eur3
> Sign-in methods
  + set signIn.anonymous.enabled
> Hosting site "lantern-cafe"
  + created https://lantern-cafe.web.app
```

| Marker | Meaning                                     |
| ------ | ------------------------------------------- |
| `=`    | Already as it should be; nothing to do.     |
| `+`    | Changed.                                    |
| `~`    | Dry run: would change this.                 |
| `!`    | Needs a look, but isn't an error by itself. |

| Exit | Meaning                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------- |
| 0    | Done, or nothing to do.                                                                                               |
| 1    | A call failed. Re-running is safe: finished steps are skipped.                                                        |
| 2    | The command line is wrong. Nothing was called.                                                                        |
| 3    | A person has to do something first (grant a permission, press a console button, pick another site name). Then re-run. |

`--dry-run` makes only reads, plus three POSTs that change nothing:
`testIamPermissions`, `accounts:lookup` and a validate-only site create. The
HTTP client also refuses any other write during a dry run, as a second line
of defence.

## IAM permissions

What `deployer check` tests, from Google's IAM reference for each API
([Firebase](https://firebase.google.com/docs/projects/iam/permissions),
[Firestore](https://docs.cloud.google.com/firestore/native/docs/security/iam),
[Hosting](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasehosting),
[Auth](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaseauth),
[Rules](https://docs.cloud.google.com/iam/docs/roles-permissions/firebaserules),
[Service Usage](https://docs.cloud.google.com/iam/docs/roles-permissions/serviceusage)).
The source of truth is [`src/permissions.mjs`](src/permissions.mjs).

| Command         | Permission                        | For                                                  |
| --------------- | --------------------------------- | ---------------------------------------------------- |
| `provision`     | `firebase.projects.get`           | look up the project and its number                   |
|                 | `serviceusage.services.get`       | see which APIs are on                                |
|                 | `serviceusage.services.enable`    | turn on the missing APIs                             |
|                 | `serviceusage.operations.get`     | wait for that to finish                              |
|                 | `datastore.databases.getMetadata` | see whether the database exists                      |
|                 | `datastore.databases.create`      | create it                                            |
|                 | `datastore.operations.get`        | wait for that to finish                              |
|                 | `firebaseauth.configs.get`        | read the sign-in settings                            |
|                 | `firebaseauth.configs.update`     | turn on Email/Password and Anonymous                 |
|                 | `firebase.clients.list`           | find the web app                                     |
|                 | `firebase.clients.create`         | register it                                          |
|                 | `firebase.clients.get`            | read its config                                      |
|                 | `firebasehosting.sites.get`       | see whether the site exists                          |
|                 | `firebasehosting.sites.create`    | create it                                            |
|                 | `firebasehosting.sites.update`    | link it to the web app                               |
| `deploy`        | `firebaserules.releases.get`      | read which rules are live                            |
|                 | `firebaserules.rulesets.get`      | compare them with the release's                      |
|                 | `firebaserules.rulesets.create`   | upload new rules                                     |
|                 | `firebaserules.releases.create`   | make rules live the first time                       |
|                 | `firebaserules.releases.update`   | make new rules live                                  |
|                 | `datastore.indexes.list`          | see which indexes exist                              |
|                 | `datastore.indexes.create`        | create the missing ones                              |
|                 | `firebasehosting.sites.get`       | read the live version                                |
|                 | `firebasehosting.sites.update`    | create, upload, finalize and release a version       |
|                 | `datastore.entities.get`          | read `config/meta` and `config/site`                 |
|                 | `datastore.entities.list`         | page through what a migration changes                |
|                 | `datastore.entities.create`       | write `config/site` and `config/meta` the first time |
|                 | `datastore.entities.update`       | write `config/site`, and what a migration changes    |
| `migrate`       | `datastore.entities.get`          | read `config/meta` and `config/site`                 |
|                 | `datastore.entities.list`         | page through what a migration changes                |
|                 | `datastore.entities.create`       | write `config/meta` the first time                   |
|                 | `datastore.entities.update`       | write what a migration changes                       |
| `rollback`      | `firebasehosting.sites.get`       | list past releases                                   |
|                 | `firebasehosting.sites.update`    | release an earlier version again                     |
|                 | `datastore.entities.get`          | read `config/meta`'s schema version                  |
|                 | `firebaserules.releases.get`      | read which rules are live                            |
|                 | `firebaserules.rulesets.get`      | check the earlier rules still exist                  |
|                 | `firebaserules.releases.update`   | make them live again                                 |
| `sync-branding` | `datastore.entities.get`          | read `config/site`                                   |
|                 | `datastore.entities.create`       | write it the first time                              |
|                 | `datastore.entities.update`       | write it                                             |
|                 | `firebasehosting.sites.get`       | read the live version's files                        |
|                 | `firebasehosting.sites.update`    | create and release a version                         |
| `owner`         | `firebaseauth.users.get`          | find the owner's account                             |
|                 | `firebaseauth.users.create`       | create it                                            |
|                 | `firebaseauth.users.sendEmail`    | send the set-password email                          |
|                 | `datastore.entities.get`          | read `/staff/{uid}`                                  |
|                 | `datastore.entities.create`       | create it                                            |
|                 | `datastore.entities.update`       | update it                                            |

### Toward the smallest role set (#3)

What the IAM reference says the candidate roles cover, for #3 to confirm and
narrow:

| Role                                                                                               | Covers                                                                                                                                                      |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firebase Develop Admin (`roles/firebase.developAdmin`)                                             | Hosting, Rules, Auth and Firestore (`datastore.*`), plus `serviceusage.services.get`. Not `serviceusage.services.enable` and not `firebase.clients.create`. |
| Service Usage Admin (`roles/serviceusage.serviceUsageAdmin`)                                       | `serviceusage.services.enable` and `serviceusage.operations.get`                                                                                            |
| Firebase Admin (`roles/firebase.admin`) or Firebase Editor (`roles/firebase.editor`)               | `firebase.clients.create`, the only roles the reference shows with it                                                                                       |
| Firebase Hosting Admin, Firebase Rules Admin, Firebase Authentication Admin, Cloud Datastore Owner | the narrower per-product roles, if Develop Admin turns out to be more than needed                                                                           |

Two things to keep in mind:

- The Firebase permissions page says custom roles **can't control Hosting**
  yet, so Hosting access has to come from a predefined role.
- Both missing pieces are setup-only: `serviceusage.services.enable` and
  `firebase.clients.create` are needed by `provision`, not by `deploy`,
  `rollback` or `owner`. One option for #3 is to ask for more at setup and
  less afterwards.

### The platform project needs these APIs on too

A service account's requests can count against **its own** project for some
APIs. When that happens Google answers "API has not been used in project
<platform number>". So the platform project (#2) should have the same APIs on:
Service Usage, Cloud Resource Manager, Firebase Management, Hosting, Rules,
Firestore and Identity Toolkit. Spike #3 confirms which of them it really
needs.

## What the spikes need to check

Each item is a `// UNVERIFIED: run in spike #N` comment above the call in
`src/`.

**#2 (platform project, service account)**

- `POST https://oauth2.googleapis.com/token`: the JWT-bearer token exchange
  (`src/auth.mjs`).

**#3 (access and roles)**

- `POST v3/projects/{id}:testIamPermissions`: that it answers for a service
  account from another project, and that every name in `src/permissions.mjs`
  is one it accepts (it rejects the whole call over one bad name, which
  `check` reports as a deployer bug).

**#4 (set up a project)**

- Service Usage `services:batchGet`, `services:batchEnable` and
  `operations.get`, called with `projects/{number}`.
- Firebase Management `projects.get`, `webApps.list`, `webApps.create` (and
  its operation), `webApps.getConfig`.
- Firestore `databases.get`; `databases.create` (and its operation) **on
  Spark with no billing account**, the open question in PLAN.md.
- Identity Toolkit v2 `getConfig` (does a fresh project answer
  `CONFIGURATION_NOT_FOUND`?) and `updateConfig` **without Identity
  Platform**.
- Hosting `sites.get` (does a site in another project answer 404 or 403?),
  `sites.create` (what status and message does a taken name get? `isNameTaken`
  in `src/commands/provision.mjs` guesses 409 `ALREADY_EXISTS`), `sites.patch`
  `appId`. Does creating a second site need the default site to exist first?
- How long a just-enabled API keeps answering `SERVICE_DISABLED`
  (`provision` retries for up to two minutes).

**#5 (deploy rules, indexes, site)**

- Rules `releases.get`, `rulesets.get`, `rulesets.create`, `releases.create`,
  `releases.patch`.
- Firestore `collectionGroups/-/indexes` list, and `indexes.create`.
- Hosting `versions.create`, `populateFiles`, the upload POST,
  `versions.patch` (finalize), `releases.create`, `channels.get` for `live`,
  `channels.releases.list`, `versions.files.list`. Check that a re-deploy of
  an unchanged build is skipped, which needs the live version's `config` to
  come back the way it was sent.
- Confirm `/__/firebase/init.json` on the new site serves the linked web
  app's config.
- Hosting `versions.get` (a rollback reads the old version's `config`).
- `sync-branding` and `rollback` make a version from another version's file
  list, uploading only the cafe's files or nothing at all: check that
  `populateFiles` doesn't ask again for content an earlier version uploaded.
- `rulesets.get` on a deleted ruleset answers 404 (rollback then says to
  redeploy).
- Not Google, but still unrun: downloading a real GitHub Release's assets
  (the URL redirects to GitHub's storage, which `fetch` follows).

**#6 (owner account and email)**

- Identity Toolkit `accounts:lookup`, `accounts` (create **without a
  password**), `accounts:sendOobCode` with `PASSWORD_RESET`.
- Firestore `documents.get` and `documents.patch` for `/staff/{uid}`, and
  for `config/meta` and `config/site` (maps, arrays and nulls in the
  settings).
- Firestore `documents:runQuery` and `documents:commit`, which migrations
  page and write with (`src/apis/firestore.mjs`). Both already run against
  the Firestore emulator (`tests/emulator/`), preconditions included; the
  real API, the service account's permissions and a commit of 300 orders are
  what's left.
- Whether `--continue-url` on the cafe's own site needs that domain added to
  Auth's authorized domains.

## Not in this draft

- **The smoke test:** a hook only, filled in by
  [#22](https://github.com/shreyashp47/cafemenu/issues/22).
- **Migrating down.** Migrations only go forward; a rollback over one is
  refused by the schema floor instead.
- **The platform-Firestore deploy log** for the console (Phase 3).
- **Choosing a version** by channel and minor line from the releases API:
  `deploy --version` takes an exact version.
- **Index `fieldOverrides`:** reported and skipped.
- **Rewrites to Cloud Functions or Cloud Run:** a cafe site is static, so
  only rewrites to a path are supported.
- **Old rulesets** pile up, one per rules change. `firebase-tools` deletes
  old ones; this doesn't yet.

## Development

```bash
npm test -w @cafemenu/deployer       # from the repo root, as CI does
node --test packages/deployer        # the same, without npm
npm run test:emulator -w @cafemenu/deployer   # migrations on the Firestore emulator (Java 21)
```

`.github/workflows/deployer.yml` runs them on every pull request and push to
`main` that touches `packages/deployer/` or `migrations/`, and the emulator
test in a job of its own. The root `npm test` and `npm run verify` include
the unit tests too; without `FIRESTORE_EMULATOR_HOST`, the emulator test is
skipped.

The tests run every command end to end against `tests/helpers/fake-google.mjs`,
a stateful model of the documented API behaviour: a second run sees what the
first one did, and every request is recorded. They cover the token exchange,
idempotent re-runs, a taken site name, Hosting uploading only the hashes it
asks for, dry runs making no write calls, and `check` reporting a missing
permission. `tests/release.test.mjs` covers the release commands with packages
built by `scripts/release/package.mjs`: a deploy end to end, a tampered
package, the schema guards, rollback, `sync-branding` touching only the
cafe's files, and dry runs writing neither Google nor the deploy log.
`tests/migrations.test.mjs` covers the runner and 0002: order, a refused
`from`, a run cut off halfway and carried on, a dry run, documents created
mid-run, and a cafe already in minor units. `tests/emulator/migrate.test.mjs`
runs 0002 on the Firestore emulator over TOE's settings, a menu and a month of
orders: every amount times 100 exactly once, the reports the same in paise,
a lost commit answer, a write racing a page, and a second run that changes
nothing. Under
Node 20 they use a stand-in for `@cafemenu/shared`
(`tests/helpers/release.mjs`); on a Node that strips types, one more test
runs the real one.

```
bin/deployer.mjs        the CLI entry point
src/cli.mjs             argument parsing, exit codes
src/auth.mjs            service-account key → JWT → access token
src/http.mjs            the one place requests are made (token, dry run, errors, retries, operations)
src/apis/*.mjs          one file per Google API, one function per call, each with its reference URL
src/commands/*.mjs      check, provision, deploy, migrate, rollback, owner, and
                        release.mjs: deploy --version and sync-branding
src/release-package.mjs fetch a release package and verify it (scripts/release/verify.mjs)
src/cafe-files.mjs      a cafe's site.json, manifest, logo and icons (@cafemenu/shared)
src/deploy-log.mjs      the DeployLog interface and its JSON-file implementation
src/migrations.mjs      config/meta's schema version; loading, chaining and running migrations
src/migration-db.mjs    what a migration's up(db) gets: pages, commits, progress in config/meta
src/smoke-test.mjs      the smoke-test hook (#22)
src/hosting-files.mjs   gzip + SHA-256 of the build, firebase.json → ServingConfig
src/permissions.mjs     what each command needs, and why
```

`src/index.mjs` exports the same pieces as a library, for the console's
provisioning job in Phase 3.
