# @cafemenu/platform-functions

The platform's backend: the Cloud Functions (2nd gen) that set a cafe up and
run its deploys, rollbacks and branding syncs, with
[`@cafemenu/deployer`](../../packages/deployer/README.md) used as a library.
They run in the **platform** Firebase project, as its runtime service account,
which is the account every owner adds to their own project
([PLAN.md](../../PLAN.md#how-it-fits-together)); no key file exists anywhere.

> [!WARNING]
> **Nothing here has run against real Google yet.** The functions are tested
> against the deployer's fake Google and the Firebase emulators. The platform
> project (Blaze, on the maintainer's side) is not set up, and the Phase 0
> spikes ([#2](https://github.com/shreyashp47/cafemenu/issues/2),
> [#3](https://github.com/shreyashp47/cafemenu/issues/3)) have not run. Every
> assumption that waits for them is marked `[[SPIKE #3]]` below and in the
> code.

## What it does

| Function              | Called by                          | Does                                                                                          |
| --------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------- |
| `checkConnection`     | the wizard's **Check connection**  | `deployer check` on the cafe's project, answered as the console's `ConnectionResult`          |
| `startProvisioning`   | the wizard, once the check passes  | queues the cafe's first setup (see [Provisioning](#provisioning))                             |
| `requestUpgrade`      | the owner area's **Upgrade**       | queues `deployer deploy --version <v>`                                                        |
| `requestRollback`     | **Roll back**                      | queues `deployer rollback`                                                                    |
| `requestSyncBranding` | **Save branding**                  | queues `deployer sync-branding`, with the cafe's settings and `setup/logo`                    |
| `runDeploymentJob`    | a `deployments/{id}` being created | does the work of whatever was queued, and writes its progress and result to the same document |

The console reaches the first five through
[`apps/console/src/lib/data/callables.ts`](../console/src/lib/data/callables.ts),
switched on with `NEXT_PUBLIC_BACKEND_FUNCTIONS=1` (off, and always in demo
mode, nothing changes).

### Who may call

The cafe's owner, or the platform admin (the `admin: true` custom claim), and
only with a verified email, as the Firestore rules demand of every write.
Anyone else gets `permission-denied`, whether or not the cafe exists. The
request handlers also refuse, before anything is queued, with the codes the
console already has words for:

| Code                  | When                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `permission-denied`   | not the owner (or admin), or an unverified email                                                                                     |
| `failed-precondition` | the cafe isn't live (a setup: isn't a draft or failed), another deployment is queued or running, or there is nothing to roll back to |
| `invalid-argument`    | an upgrade to a release that doesn't exist, is withdrawn, or is a beta for a stable cafe                                             |

`checkConnection` only answers for the project already saved on the cafe, so
it can't be used to ask whether the deploy account belongs to any project
there is.

### Why a callable plus a trigger

Provisioning is asked for by a **callable**, which queues a `deployments/{id}`;
a **Firestore trigger** on that document does the work. The other way, a
request document the owner writes themselves, would need rules that let an
owner create a document in `deployments`, which the rules keep for the backend
so the history is what really happened. A callable checks the caller, the
cafe's state and whether another run is under way before anything exists, and
answers with an error the page can show at once. The trigger rather than the
callable does the work because setup takes minutes (the HTTP request would
have to be held open), and because a trigger with `retry: true` is run again
by Cloud Functions when it fails, which the resumability below builds on.

## Provisioning

`startProvisioning({cafeId})` checks the cafe is a `draft` or `failed` one with
a project, a site name and a region; picks the release its first deploy puts
online (the newest one its channel and pin allow); sets the cafe `provisioning`;
and queues `deployments/{id}` (`kind: "provision"`, all steps `pending`). It
answers `{deploymentId}`. The wizard listens to that document.

The worker then runs, one step at a time, each written to the document as it
starts and ends:

| Step        | Does                                                                                                                |
| ----------- | ------------------------------------------------------------------------------------------------------------------- |
| `check`     | `deployer check`: may the deploy account do everything below?                                                       |
| `provision` | `deployer provision`: the APIs, the Firestore database, sign-in, the web app, the Hosting site                      |
| `deploy`    | `deployer deploy --version <the release>` with the cafe's settings and logo (`cafes/{id}/setup/logo`), smoke-tested |
| `menu`      | the starting menu (`setup/menu`) into the cafe's `menu/`, once ([below](#the-starting-menu-and-the-tables))         |
| `owner`     | `deployer owner`: the owner's account, their `/staff` record, and the set-password email                            |

The cafe then goes `live`, with `release.current` set. The deployment carries
`status`, `steps: [{id, label, status}]`, `detail` (what the current step is
doing, from the deployer's own output), `error` and `errorCode` when it failed,
`siteUrl` when it succeeded, and for the backend `attempts`, `lease` and
`technical`.

### Safe to run again, and resumable

- Every deployer command reads before it writes, so running one again changes
  nothing that is already right. `startProvisioning` on a `failed` cafe is just
  another run: it finishes whatever the last one didn't.
- A deployment is picked up by one invocation at a time: it holds a **lease**,
  renewed every 30 seconds while it works. Cloud Functions delivers an event at
  least once, so two invocations can meet; the second waits (and is retried) or
  finds the deployment finished and goes away.
- **Transient errors** (Google answering 429/5xx, an operation timing out, no
  answer at all) are retried in place after 2 and 10 seconds. If they last, or
  an invocation runs out of its 7½ minutes (an event-triggered function may run
  for 9), the deployment goes back to `queued` and the function throws, so
  Cloud Functions runs it again; the steps already `done` are skipped. A
  deployment is picked up at most four times, and then fails with an
  explanation rather than retrying for ever.
- A deployment that never finished (queued or running with no sign of life for
  two hours) stops blocking its cafe: the next request closes it.

### When it fails

Every failure ends the deployment as `failed` with `error` in plain words: what
happened, then what to do next, in one string (the console shows `error` as it
is). [`src/explain.mjs`](./src/explain.mjs) writes them; the deployer's own
messages are for someone at a terminal ("re-run with --site"). A failed
**setup** puts the cafe back to `draft` when the owner has to change something
the rules only let them change on a draft (the web address), and to `failed`
otherwise.

| `errorCode`           | What the owner reads                                                                                                                            | Cafe      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `site-name-taken`     | the web address is used by someone else; here are free ones                                                                                     | `draft`   |
| `missing-permissions` | the deploy account can't do X; give it a role that includes these in IAM `[[SPIKE #3]]`                                                         | `failed`  |
| `no-access`           | the deploy account can't get into the project; add it as a member again (link)                                                                  | `failed`  |
| `auth-not-started`    | sign-in isn't switched on; press **Get started** in the console (link). Google only lets billing-enabled projects do this by API `[[SPIKE #4]]` | `failed`  |
| `invalid-details`     | the cafe's saved settings, logo or menu can't be used; fix them                                                                                 | `failed`  |
| `google-slow`         | Google didn't answer even after several tries; nothing is broken, try again in a few minutes                                                    | `failed`  |
| `smoke-test-failed`   | the new version didn't pass its checks on the live site (and was rolled back, when there was something to go back to)                           | as it was |
| `unexpected`          | something unexpected; try again, and tell the maintainer this reference                                                                         | `failed`  |

The technical message is kept in `technical` on the deployment, and in the
function's logs with the deployment's id: not in `error`.

### The starting menu, and the tables

The `menu` step does what the cafe app's menu import does
(`apps/cafe/src/lib/data/firestore.ts`, `importItems`): one `menu/start-001`,
`start-002`… document per item, priced in minor units, in order. The rows and
the currency are checked again here (the rules can't look inside them), and
the items and a marker `config/setup` go in one atomic commit, so a second run
finds the marker and leaves the menu alone, even after the owner has changed it.

**The tables need no seeding.** They are `tables` in the settings that the
first deploy writes to `config/site`, which the app uses until the owner saves
a list of their own (`config/tables`). Writing that list here would pin it, and
a later change of the table count in the console would no longer reach the
cafe. Table codes (`tableKeys`) are the owner's to create on `/admin/qr`; the
platform never holds a cafe's secret codes.

## Upgrades, rollbacks and branding

`requestUpgrade`, `requestRollback` and `requestSyncBranding` check what
[`DeployRequests`](../console/src/lib/data/types.ts) says they must (a live
cafe, nothing else queued or running, a release the cafe may have), queue a
`deployments/{id}` with the deployer's own step ids, and answer
`{deploymentId}`. The worker runs the deployer command and, as the backend,
writes `deployments/{id}` and the cafe:

- the deployer's steps (`package`, `migrations`, `rules`, … `smoke`) replace the
  plan's when it finishes, and move live as the deployer prints each one;
- `release.current` and `release.previous` follow the deployer's record
  (`rollback`: the previous version is current and previous is null);
- an upgrade across a minor line moves a **pinned** cafe's `release.pinned` to
  the new line, so the next patch of the old one doesn't undo it;
- a deploy that fails its smoke test is rolled back by the deployer; the
  deployment ends `rolled-back`, with its smoke step failed and the cafe on the
  version it had.

Rollout waves (#32) can create `deployments` with `trigger: "rollout"` the same
way; the worker doesn't care who queued one.

### Where the deploy record lives

`deployer deploy` remembers what each cafe runs (the Hosting version and rules
each release went out as, the schema floor) so `rollback` can go back. On the
platform that is `cafes/{id}/private/deployRecord`, written through
[`src/deploy-log.mjs`](./src/deploy-log.mjs), and the versions are copied to
`cafes/{id}.release` for the console. No rule matches `private`, so nothing in a
browser can read or write it (a case in
[`apps/console/scripts/rules-test.mjs`](../console/scripts/rules-test.mjs)).

## Running it locally

```bash
npm test -w @cafemenu/platform-functions            # unit tests, any Node 20+
npm run test:emulator -w @cafemenu/platform-functions
```

The unit tests run the callables and the worker against the deployer's fake
Google (`packages/deployer/tests/helpers/`) and the platform's data in memory.
The emulator test needs **Node 22.18 or later** (firebase-admin 14, and
`@cafemenu/shared` is TypeScript that Node imports as it is) and **Java 21**
(`/opt/homebrew/opt/openjdk@21/bin` on this machine). It starts the Auth,
Firestore and Functions emulators with the real functions, serves the
deployer's fake Google over HTTP behind them, and then, as a brand-new owner:
asks for a setup and watches the progress document fill in until the cafe is
live; upgrades, rolls back and syncs branding; and is refused as a stranger.

The functions send Google's calls to that fake only when
`FUNCTIONS_EMULATOR` is set, the project starts with `demo-` and
`CAFEMENU_FAKE_GOOGLE` names it (`.env.demo-cafemenu`), so a deployed function
can never take that path.

To use the console against them:

```bash
npm run emulators -w @cafemenu/platform-functions     # instead of the console's own
# apps/console/.env.local
#   NEXT_PUBLIC_FIREBASE_EMULATORS=1
#   NEXT_PUBLIC_BACKEND_FUNCTIONS=1
```

It serves the console's ports (Auth 9199, Firestore 8180) and Functions on
5101, with a copy of the console's rules. A setup needs the fake Google
running too (`startFakeGoogle` in `tests/helpers/fake-google-server.mjs`); Check
connection and the request callables don't.

> Installing under Node 20 skips firebase-admin's optional Firestore package,
> which wants Node 22. `npm ci` on Node 22 installs it.

## Deploying to the platform project

Done once, by the maintainer. **All of this waits for the platform project and
[[SPIKE #3]].**

1. **Blaze.** Cloud Functions (2nd gen) need the platform project on the Blaze
   plan. Provisioning and deploys run rarely, so expect around ₹0 to a few
   hundred a month ([PLAN.md](../../PLAN.md#costs)). Set a budget alert.
2. **APIs.** Cloud Functions, Cloud Build, Artifact Registry, Cloud Run,
   Eventarc, Firestore. `firebase deploy` offers to turn on the ones it needs.
3. **The runtime service account.** Decide which account the functions run as,
   and give it the platform-side roles it needs: Cloud Datastore User
   (`roles/datastore.user`, to read and write `cafes`, `deployments`,
   `releases`) and Firebase Authentication Viewer (`roles/firebaseauth.viewer`,
   to read the owner's name). That account's address is **the one owners add to
   their own project** at the "Give CafeMenu access" step. The default is the
   project's App Engine / Compute default account, which holds far more than
   this needs; a dedicated one is better:

   ```bash
   gcloud iam service-accounts create cafemenu-deploy --project <platform-project>
   # the address to share:
   #   cafemenu-deploy@<platform-project>.iam.gserviceaccount.com
   ```

   Put it in `NEXT_PUBLIC_DEPLOY_SERVICE_ACCOUNT` for the console, and
   `DEPLOY_SERVICE_ACCOUNT` when deploying the functions (below). The role to
   ask owners to grant it, and whether the metadata server answers inside a 2nd
   gen function (the functions use it only to name the account in messages), are
   `[[SPIKE #3]]`.

4. **Deploy:**

   ```bash
   cd apps/platform-functions
   DEPLOY_SERVICE_ACCOUNT=cafemenu-deploy@<platform-project>.iam.gserviceaccount.com \
   CAFEMENU_REGION=us-central1 \
     npx firebase-tools deploy --only functions --project <platform-project>
   ```

   (or `npm run deploy -w @cafemenu/platform-functions` with the same
   variables). `firebase.json` stages first: `scripts/stage.mjs` copies the
   functions into `.deploy/` with the deployer, `@cafemenu/shared` and
   `scripts/release/` beside them, as a package of its own, because Firebase
   uploads one folder and Cloud Build has no repository. It also cuts a
   `package-lock.json` for it out of the repository's
   (`scripts/prune-lock.mjs`), so Cloud Build runs `npm ci` on the versions the
   tests ran on: npm 10 crashes resolving this repository's tree from nothing
   ([CONTRIBUTING.md](../../CONTRIBUTING.md)). CI runs `npm ci` and `npm ls` in
   the staged package and loads the functions from it.

   `CAFEMENU_REGION` must be the **location of the platform's Firestore
   database**, which Firestore triggers require `[[SPIKE #3]]`.

5. **The admin claim.** The maintainer's account needs `admin: true`, set with
   the Admin SDK; nothing sets it yet (#30).
6. **Firestore rules and indexes** are the console's: `firebase deploy --only
firestore` from `apps/console`. The functions need no new index.
7. **Console.** Build it with `NEXT_PUBLIC_BACKEND_FUNCTIONS=1`, and
   `NEXT_PUBLIC_FUNCTIONS_REGION` if the region isn't `us-central1`.

## Not done here

- **No screen starts a setup or shows its progress yet.** The wizard stops at
  "connected" (`apps/console/src/components/setup/Connected.tsx` has the
  `TODO(#28)`): a button calling `startProvisioning` and a view of the
  deployment's steps and `error` are the console half of #28.
- The set-password email sends no `continueUrl`: the cafe's site is not an
  authorised domain of its own project until the deployer adds it
  `[[SPIKE #4]]`, and Google refuses a link to one that isn't.
- `checkConnection` is not rate-limited.
- Everything marked `UNVERIFIED` in the deployer, which is most of what the
  functions call; and `[[SPIKE #3]]` above.
