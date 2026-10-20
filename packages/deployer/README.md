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

Node 20.9 or later. No dependencies: built-in `fetch`, `node:crypto` to sign
the service-account JWT, `node:zlib` to gzip Hosting files, `node:util`
`parseArgs`.

## Commands

```bash
deployer check     --project <id>
deployer provision --project <id> --region <location> --site <name>
deployer deploy    --project <id> --rules firestore.rules --indexes firestore.indexes.json \
                   --site <name> --dir out --config firebase.json --target app
deployer rollback  --project <id> --site <name>
deployer owner     --project <id> --email <email> --name <name>
```

From the repo root, `node packages/deployer/bin/deployer.mjs <command> …`, or
`npm run deployer -w @cafemenu/deployer -- <command> …` once the root
workspace is in place. `deployer <command> --help` lists every option.

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

### `deploy`

Deploys any of three parts, in this order (rules and indexes before the
bundle that needs them):

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

Makes the site serve the version it served before the current one, by
releasing that version again. Hosting keeps old versions, so this takes effect
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
rollback it just did. Rules are not rolled back: in Phase 2 that comes from
the previous release package.

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

| Command     | Permission                        | For                                            |
| ----------- | --------------------------------- | ---------------------------------------------- |
| `provision` | `firebase.projects.get`           | look up the project and its number             |
|             | `serviceusage.services.get`       | see which APIs are on                          |
|             | `serviceusage.services.enable`    | turn on the missing APIs                       |
|             | `serviceusage.operations.get`     | wait for that to finish                        |
|             | `datastore.databases.getMetadata` | see whether the database exists                |
|             | `datastore.databases.create`      | create it                                      |
|             | `datastore.operations.get`        | wait for that to finish                        |
|             | `firebaseauth.configs.get`        | read the sign-in settings                      |
|             | `firebaseauth.configs.update`     | turn on Email/Password and Anonymous           |
|             | `firebase.clients.list`           | find the web app                               |
|             | `firebase.clients.create`         | register it                                    |
|             | `firebase.clients.get`            | read its config                                |
|             | `firebasehosting.sites.get`       | see whether the site exists                    |
|             | `firebasehosting.sites.create`    | create it                                      |
|             | `firebasehosting.sites.update`    | link it to the web app                         |
| `deploy`    | `firebaserules.releases.get`      | read which rules are live                      |
|             | `firebaserules.rulesets.get`      | compare them with the release's                |
|             | `firebaserules.rulesets.create`   | upload new rules                               |
|             | `firebaserules.releases.create`   | make rules live the first time                 |
|             | `firebaserules.releases.update`   | make new rules live                            |
|             | `datastore.indexes.list`          | see which indexes exist                        |
|             | `datastore.indexes.create`        | create the missing ones                        |
|             | `firebasehosting.sites.get`       | read the live version                          |
|             | `firebasehosting.sites.update`    | create, upload, finalize and release a version |
| `rollback`  | `firebasehosting.sites.get`       | list past releases                             |
|             | `firebasehosting.sites.update`    | release an earlier version again               |
| `owner`     | `firebaseauth.users.get`          | find the owner's account                       |
|             | `firebaseauth.users.create`       | create it                                      |
|             | `firebaseauth.users.sendEmail`    | send the set-password email                    |
|             | `datastore.entities.get`          | read `/staff/{uid}`                            |
|             | `datastore.entities.create`       | create it                                      |
|             | `datastore.entities.update`       | update it                                      |

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

**#6 (owner account and email)**

- Identity Toolkit `accounts:lookup`, `accounts` (create **without a
  password**), `accounts:sendOobCode` with `PASSWORD_RESET`.
- Firestore `documents.get` and `documents.patch` for `/staff/{uid}`.
- Whether `--continue-url` on the cafe's own site needs that domain added to
  Auth's authorized domains.

## Not in this draft

- **Rules rollback, migrations, smoke tests, `site.json`:** Phase 2
  ([#19](https://github.com/shreyashp47/cafemenu/issues/19)–[#22](https://github.com/shreyashp47/cafemenu/issues/22)).
- **Index `fieldOverrides`:** reported and skipped.
- **Rewrites to Cloud Functions or Cloud Run:** a cafe site is static, so
  only rewrites to a path are supported.
- **Old rulesets** pile up, one per rules change. `firebase-tools` deletes
  old ones; this doesn't yet.

## Development

```bash
node --test packages/deployer        # from the repo root
npm test                             # from packages/deployer
```

The tests run every command end to end against `tests/helpers/fake-google.mjs`,
a stateful model of the documented API behaviour: a second run sees what the
first one did, and every request is recorded. They cover the token exchange,
idempotent re-runs, a taken site name, Hosting uploading only the hashes it
asks for, dry runs making no write calls, and `check` reporting a missing
permission.

```
bin/deployer.mjs        the CLI entry point
src/cli.mjs             argument parsing, exit codes
src/auth.mjs            service-account key → JWT → access token
src/http.mjs            the one place requests are made (token, dry run, errors, retries, operations)
src/apis/*.mjs          one file per Google API, one function per call, each with its reference URL
src/commands/*.mjs      check, provision, deploy, rollback, owner
src/hosting-files.mjs   gzip + SHA-256 of the build, firebase.json → ServingConfig
src/permissions.mjs     what each command needs, and why
```

`src/index.mjs` exports the same pieces as a library, for the console's
provisioning job in Phase 3.
