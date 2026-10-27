# @cafemenu/platform-functions

The platform's backend: it sets a cafe up and runs its deploys, rollbacks and
branding syncs, with [`@cafemenu/deployer`](../../packages/deployer/README.md)
used as a library, and sends the owner emails. The same handlers run two ways:

- **On GitHub Actions, every 5 minutes** (chosen: free, the platform stays on
  Spark, #77). The console writes a request document; the worker
  ([`src/worker/`](./src/worker)) picks it up, does it and answers on it. It
  signs in as the platform service account with that account's JSON key,
  which is a GitHub secret and nowhere else. See
  [The backend on GitHub Actions](#the-backend-on-github-actions).
- **As Cloud Functions (2nd gen)** ([`src/index.mjs`](./src/index.mjs)), kept
  so that Blaze stays an option: callables answer at once and Firestore
  triggers do the work, as the platform project's runtime service account,
  with no key file at all. See [Deploying to the platform
  project](#deploying-the-cloud-functions-blaze).

Either way the account is the one every owner adds to their own project
([PLAN.md](../../PLAN.md#how-it-fits-together)).

> [!WARNING]
> **Nothing here has run against real Google yet.** The backend is tested
> against the deployer's fake Google and the Firebase emulators. The platform
> project's service account is not set up, and the Phase 0 spikes
> ([#2](https://github.com/shreyashp47/cafemenu/issues/2),
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
| `notifyOnRelease`     | a `releases/{version}` write       | emails the owners who stay on a version, and those whose line is no longer supported          |
| `notifyOnDeployment`  | a `deployments/{id}` update        | emails the owner when it ended `failed` or `rolled-back`                                      |
| `unsubscribe`         | the link in an email (HTTP)        | switches the release emails off (or on again) for one cafe                                    |

On Blaze, the console reaches the first five through
[`apps/console/src/lib/data/callables.ts`](../console/src/lib/data/callables.ts),
switched on with `NEXT_PUBLIC_BACKEND=functions`. On GitHub Actions it writes
requests instead ([`requests.ts`](../console/src/lib/data/requests.ts),
`NEXT_PUBLIC_BACKEND=requests`), and the worker calls the same five handlers
and the same `runDeploymentJob` work, and sends the same emails. Unset, and
always in demo mode, nothing changes.

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

## The backend on GitHub Actions

[`.github/workflows/backend.yml`](../../.github/workflows/backend.yml) runs
`node src/worker/main.mjs` (`npm run worker -w @cafemenu/platform-functions`)
every 5 minutes, GitHub's shortest schedule, and on **Run workflow**. A run
takes from a few seconds (nothing to do) to a few minutes (a setup).

### A request

The console writes `requests/{id}`, and listens to it:

| Field          | Written by | What                                                                                                                           |
| -------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `cafeId`       | the asker  | the cafe it is about; `null` for the admin's `appoint-admin` and `remove-admin`                                                |
| `kind`         | the asker  | `check`, `provision`, `deploy`, `rollback` or `sync-branding`; the admin's kinds (see [The super admin](#the-super-admin))     |
| `params`       | the asker  | `{projectId}` for a check (only the project saved on the cafe), `{version}` for a deploy, `{}` for the rest; the admin's below |
| `status`       | both       | `queued` when written; then `running`, and `done` or `failed`                                                                  |
| `createdAt`    | the asker  | the server's time                                                                                                              |
| `by`           | the asker  | their uid                                                                                                                      |
| `progress`     | backend    | `{steps: [{id, label, status}], detail}`: the deployment's steps as they move, or the check's one step                         |
| `result`       | backend    | a check's `ConnectionResult`; for the others `{deploymentId, outcome, siteUrl?}`                                               |
| `error`        | backend    | why it failed, in words for the owner (the callables' words, or the deployment's)                                              |
| `errorCode`    | backend    | `permission-denied`, `failed-precondition`, `invalid-argument`, `unavailable`, a deployment's code…                            |
| `deploymentId` | backend    | the deployment it became                                                                                                       |
| `notBefore`    | backend    | a suspension waiting for its notice period: the run leaves it queued until then                                                |
| (bookkeeping)  | backend    | `attempts`, `lease`, `startedAt`, `finishedAt`, `technical`                                                                    |

The shape is one module, [`@cafemenu/shared/requests`](../../packages/shared/src/requests.mjs),
which the console uses to write requests and the rules mirror. The rules
([`apps/console/firestore.rules`](../console/firestore.rules), tested in
[`scripts/rules-test.mjs`](../console/scripts/rules-test.mjs)) let a verified
owner create one only for their own cafe (the admin, for any cafe), in their
own name, queued, at the server's time, with a kind and params that fit, and
nothing the backend writes. Only the admin may write the admin's kinds. Nobody can change or delete a request from a
browser. Its asker and the admin can read it.

### One run

[`src/worker/worker.mjs`](./src/worker/worker.mjs):

1. **Requests.** The queued ones, and running ones whose run died, oldest
   first but taking turns between cafes. Each is **claimed in a transaction**
   with a 30-minute lease (`decideClaim` in [`src/claim.mjs`](./src/claim.mjs),
   the deployments' own): a second run that meets it leaves it alone, so no
   request is done twice, and one whose run died is picked up again once its
   lease is out, at most four times. The asker is looked up in the platform's
   Auth (gone, disabled or unverified: refused), and the request goes to the
   **same handlers the Cloud Functions use**
   ([`src/worker/requests.mjs`](./src/worker/requests.mjs)): `checkConnection`,
   or `startProvisioning` / `requestUpgrade` / `requestRollback` /
   `requestSyncBranding` and then `runDeployment` from
   [`src/jobs.mjs`](./src/jobs.mjs). So a request is refused for exactly the
   reasons a callable is, with the same words, and runs exactly as a
   deployment does: resumable, with retries and the explanations in
   [`src/explain.mjs`](./src/explain.mjs). The deployment's steps are copied
   to the request as they move. A deployment that has to wait (Google busy,
   out of time) puts the request back in the queue with its `deploymentId`,
   and the next run carries on from there. Anything unexpected fails the
   request with a reference (its id) and turns the run red. An owner whose
   account is suspended has every request refused, with the reason; the
   admin's kinds go to [`src/worker/admin.mjs`](./src/worker/admin.mjs)
   (see [The super admin](#the-super-admin)).
2. **Deployments queued any other way** (a callable on Blaze, a rollout, one a
   request put back) are run too: on Blaze a trigger would.
3. **Emails and the support window**
   ([`src/worker/background.mjs`](./src/worker/background.mjs)). A failed or
   rolled-back deployment emails its owner as the worker finishes it. At most
   hourly (or with `--jobs`, **Run workflow**'s checkbox), the releases are
   compared with what the worker saw last time (`backend/worker`, a document
   no rule lets a browser near), and each new or changed one goes through
   `notifyRelease`, as the `notifyOnRelease` trigger would. Once a day, every
   cafe on a line the support window has dropped is told to upgrade by its
   date. Every email still goes once per cafe per thing. At the same hourly
   pace, each new, promoted or withdrawn release is written to the admin log,
   and every account in Authentication is copied to the admin's owners
   directory (`owners/{uid}`), writing only what changed.

A run starts nothing new after 5 minutes or 25 requests; the rest wait for
the next run. The workflow stops a run after 20 minutes.

**One at a time.** The workflow's `concurrency` never starts a run beside
another (a run that is due waits), and the transaction makes it safe even if
two did meet, or the Cloud Functions ran too.

### What the log shows

The repository is public, so **its Actions logs are public**. The worker
prints one line per request and deployment (its id, kind and outcome) and a
summary of the emails, and nothing else: no email addresses, cafe names,
project IDs, deployer output or error messages beyond fixed words
([`src/worker/log.mjs`](./src/worker/log.mjs)). What happened in detail is on
the request and deployment documents, which only their owner and the admin
can read. `--verbose` prints everything, for your own machine only.

### Setting it up

Done once, by the maintainer, in this order. It assumes the platform's
Firestore database exists and the console is switched to real mode: see the
[console README](../console/README.md#real-mode-the-platform-project).

1. **Create the service account in `getcafemenu`.** In the Google Cloud
   console for the project: **IAM & Admin → Service accounts → Create
   service account**, named `cafemenu-deploy`. Or:

   ```bash
   gcloud iam service-accounts create cafemenu-deploy \
     --project getcafemenu --display-name "CafeMenu deploy"
   ```

   Its address, `cafemenu-deploy@getcafemenu.iam.gserviceaccount.com`, is the
   one owners add to their projects: put it in the console's
   `NEXT_PUBLIC_DEPLOY_SERVICE_ACCOUNT`.

2. **Give it its platform roles**, in `getcafemenu` only:

   | Role                                                       | For                                                                                                                                                                                |
   | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Cloud Datastore User (`roles/datastore.user`)              | reading and writing the platform's Firestore: requests, cafes, deployments, releases, the owners directory, the admin log                                                          |
   | Firebase Authentication Admin (`roles/firebaseauth.admin`) | looking up who asked (verified, disabled, admin) and the owners' names and emails; and, for the super admin, disabling, enabling and deleting an owner's login and setting `admin` |

   The super admin (#78) needs the Admin role: the Viewer role, enough before
   it, can't suspend, reactivate or delete a login, nor set the `admin` flag.
   If you set the backend up before #78 with `roles/firebaseauth.viewer`,
   swap it for `roles/firebaseauth.admin` (and remove the Viewer binding).

   ```bash
   SA=cafemenu-deploy@getcafemenu.iam.gserviceaccount.com
   for role in roles/datastore.user roles/firebaseauth.admin; do
     gcloud projects add-iam-policy-binding getcafemenu \
       --member "serviceAccount:$SA" --role "$role"
   done
   ```

   Nothing else in `getcafemenu`. What it may do in **owners'** projects is
   the role each owner grants it there, which is `[[SPIKE #3]]`: the smallest
   set is what the Phase 0 spike settles. Also `[[SPIKE #3]]`: whether
   `getcafemenu` itself must have the Google APIs the deployer calls enabled
   (Cloud Resource Manager, Service Usage, Firebase Management, Firestore,
   Firebase Rules, Firebase Hosting, Identity Toolkit), since some Google APIs
   count a service account's calls against its own project.

3. **Make its JSON key**, and hand it straight to GitHub. **Service accounts
   → cafemenu-deploy → Keys → Add key → Create new key → JSON** downloads it,
   or:

   ```bash
   gcloud iam service-accounts keys create ~/cafemenu-deploy.json \
     --iam-account "$SA"
   ```

   An organisation's policy can forbid keys (`iam.disableServiceAccountKeyCreation`,
   on by default in organisations made since 2024); a personal Google account
   has no organisation, so this works there.

4. **Create the `production` environment**: the repository's **Settings →
   Environments → New environment**, `production`. Under **Deployment
   branches and tags**, choose **Selected branches and tags** and add `main`,
   so nothing but `main` can use its secret. (Don't add required reviewers:
   every run would wait for one.)

5. **Store the key as its secret, then delete your copy:**

   ```bash
   gh secret set PLATFORM_SERVICE_ACCOUNT --env production \
     --repo shreyashp47/cafemenu < ~/cafemenu-deploy.json
   rm ~/cafemenu-deploy.json
   ```

   **Before the `rm`**, make yourself the first super admin with the same key
   (sign up on the console first, then [The super admin](#the-super-admin)'s
   `npm run make-admin`), since nothing else can.

   The key can rewrite the rules of every connected cafe: it must never be
   committed, pasted anywhere else or kept on disk. Make a new one and delete
   the old one (**Keys** tab) if it might have leaked, and once a year anyway.

6. **Emails** (optional). Without them the worker sends no email (the `log`
   provider, which writes nothing to the public log either). For Resend:
   **Settings → Environments → production**, variables `MAIL_PROVIDER` =
   `resend`, `MAIL_FROM` = `CafeMenu <hello@your-domain>` (a domain Resend has
   verified) and `CONSOLE_URL` = the console's address, and the secret
   `RESEND_API_KEY`. See [Emails](#emails). On GitHub Actions there is no
   `unsubscribe` function to link to, so the one optional email,
   `release-available`, isn't sent; failures and required upgrades are.

7. **Switch the console** to `NEXT_PUBLIC_BACKEND=requests`, rebuild and
   redeploy it (the console README).

8. **Try it.** **Actions → Backend → Run workflow** on `main`. The log should
   end with `nothing to do`, or a line per request. Then press **Check
   connection** in the console as an owner: within about 5 minutes the page
   shows the answer.

Until step 5, every run stops at its first step, with a notice, and costs
nothing.

### The super admin

The admin page of the console (`/admin`) asks the backend for these, as
requests, for an account with the `admin` claim only (the rules refuse
anyone else; the worker checks again). Each is safe to retry, writes one
entry to the admin log under the request's id (so a retry logs nothing
twice), and emails the owner once, with the reason. The policy (the reasons,
notice periods and section 8's other provisional decisions of
[docs/super-admin-requirements.md](../../docs/super-admin-requirements.md#8-decisions-provisional-used-in-the-build))
is [`@cafemenu/shared/admin-policy`](../../packages/shared/src/admin-policy.mjs).

| Kind              | Params                                                      | What the worker does                                                                                                                                                                                                                                                                                                    |
| ----------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `suspend`         | `{reason, note, effectiveAt}`                               | Disables the owner's login and revokes their sessions, marks each of their cafes `suspended` (keeping what it was), and refuses their requests with the reason from then on. Rollouts skip a cafe that isn't live. A reason with notice (non-payment: 7 days) emails a notice now and waits, queued, for `effectiveAt`. |
| `reactivate`      | `{reason, note}`                                            | All of that undone; a suspension still waiting for its date is called off.                                                                                                                                                                                                                                              |
| `delete-owner`    | `{reason, note, confirm}`, `confirm` the cafe's web address | Emails the owner, logs it, then deletes their login, directory entry, cafes (with `setup/` and `emails/`), deployments and requests. The admin log stays. Nothing in the owner's own project is touched. Never an admin's account.                                                                                      |
| `maintenance-on`  | `{reason, note, message, until, startsAt, endsAt, batch}`   | Writes `config/site.maintenance` in the cafe's own project with the deployer's `maintenance` command (only that field), and the same, with the reason, on `cafes/{id}.maintenance`. The cafe's site follows it live; its rules refuse new orders while it's in effect.                                                  |
| `maintenance-off` | `{note, batch}`                                             | Clears both.                                                                                                                                                                                                                                                                                                            |
| `appoint-admin`   | `{email, note}`, no cafe                                    | Sets the `admin` claim on that account, if the policy allows (`APPOINT_OTHER_ADMINS`, off for now).                                                                                                                                                                                                                     |
| `remove-admin`    | `{email, note}`, no cafe                                    | Clears it, unless it's the last admin.                                                                                                                                                                                                                                                                                  |

`batch` ties a bulk action's requests together, so the console can resume or
revert it. **Timing:** an action takes effect at the backend's next run, so
within about 5 minutes on GitHub Actions (section 5 asks this of suspension;
it asks 1 minute of maintenance, which a 5-minute schedule can't promise: the
cafe's page then follows the setting within seconds). **Run workflow** does
it at once.

**The first admin** is made once, by the maintainer, with the platform service
account's key (or against the emulators):

```bash
GOOGLE_APPLICATION_CREDENTIALS=~/cafemenu-deploy.json \
  npm run make-admin -w @cafemenu/platform-functions -- --email you@example.com
```

It sets the claim on the account with that email (sign up on the console
first), marks it in the directory, and logs it. Sign out and in again to have
it. `--remove` takes it away.

**The owners directory** (`owners/{uid}`: email, name, sign-up, last sign-in,
admin, disabled, status) is copied from Authentication by the hourly jobs,
since a browser can't list Authentication's accounts. A new account can take
up to an hour to appear; the console falls back on the cafe's own email.

**Tests:** [`tests/unit/admin.test.mjs`](./tests/unit/admin.test.mjs), and
end to end on the emulators in
[`tests/emulator/admin.emulator.mjs`](./tests/emulator/admin.emulator.mjs)
(part of `npm run test:emulator:worker`): the admin's requests through the
real rules, the suspended owner's sign-in refused (`auth/user-disabled`) and
request refused with the reason, maintenance written to the cafe's
`config/site`, and the log out of the owner's reach.

### When GitHub pauses the schedule

**GitHub turns a public repository's scheduled workflows off after 60 days
with no activity in it** (no commits). From then on nothing answers
requests: owners see them wait. To keep it alive, push something now and
then (any commit to `main` counts). To start it again: **Actions → Backend →
Enable workflow**, then **Run workflow** once. Requests written in the meantime are still queued and are
done on the next run.

### Running it locally

```bash
npm run test:emulator:worker -w @cafemenu/platform-functions   # Java 21, Node 22.18+
```

starts the Auth and Firestore emulators (no Functions), serves the deployer's
fake Google, signs an owner in with the Firebase client SDK as the console
does, writes requests through the real rules, and runs the worker CLI on them,
checking what the owner's listener sees, that two runs at once do a request
once, and that the log holds no address or project ID. With
`CAFEMENU_WORKER_DIR=.deploy` it runs the staged worker, installed as the
workflow installs it (CI does both).

To use the console against it: run the console's emulators
(`npm run emulators -w @cafemenu/console`), set `NEXT_PUBLIC_FIREBASE_EMULATORS=1`
and `NEXT_PUBLIC_BACKEND=requests` in `apps/console/.env.local`, and beside them:

```bash
cd apps/platform-functions
FIRESTORE_EMULATOR_HOST=127.0.0.1:8180 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9199 \
GCLOUD_PROJECT=demo-cafemenu npm run worker -- --loop 10 --verbose
```

A check then fails ("couldn't be done"): Google isn't there. For setups and
deploys, also serve the fake Google (`startFakeGoogle` in
`tests/helpers/fake-google-server.mjs`) and add
`CAFEMENU_FAKE_GOOGLE=http://127.0.0.1:8399`; the worker only takes it with
the emulators and a `demo-` project.

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

## Emails

Owners are emailed by the platform, never by their own project (which only
sends sign-in emails). Three emails, each triggered by a write the backend
already makes ([`src/mail/`](./src/mail)):

| Email               | Sent when                                                                                                                                                  | To                                                                                 | Can be switched off |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------- |
| `release-available` | a release is written that is stable, not withdrawn and on a newer line than the cafe's pin (also when a beta is promoted)                                  | live cafes that stay on a line (`release.pinned`)                                  | yes                 |
| `upgrade-required`  | any release write, for each pinned cafe whose line the [support window](../../docs/releases.md#the-support-window) has dropped and whose date has not come | the same, once per line and date; with the date and what the cafe will be moved to | no                  |
| `deploy-failed`     | a deployment goes to `failed` or `rolled-back` (a deploy, rollback, branding sync or setup, whoever queued it)                                             | the cafe's owner, with `error` as the deployment wrote it                          | no                  |

A patch of the line a cafe stays on isn't announced: it is applied by itself.
A cafe that is told to upgrade isn't also told about the release. The
window's maths is one function, shared with the console and the deployer
([`packages/shared/src/support-window.mjs`](../../packages/shared/src/support-window.mjs));
the backend only decides who to tell.

- **Once per thing.** Before sending, the backend records a key such as
  `deploy-failed:<deployment id>` in `cafes/{id}/private/mail` (a transaction),
  so an event delivered twice, or a later release write that checks the same
  cafes, sends nothing twice. A send that fails gives its key back, so the next
  write tries again. One cafe's failure never stops the others; each outcome is
  logged.
- **Unsubscribe.** The emails that can be switched off carry a link and a
  `List-Unsubscribe` header (with the one-click `List-Unsubscribe-Post`). The
  link is `UNSUBSCRIBE_URL?c=<cafe>&t=<token>`, the token being a random
  string of the cafe's own in `cafes/{id}/private/mail`, which no browser can
  read. A GET shows a page with a button and changes nothing, because mail
  scanners fetch every link; a POST sets `emails.releaseNotices` on the cafe to
  `false` (and to `true` again, for the button on that page). Without `UNSUBSCRIBE_URL` those emails are not
  sent at all. The essential emails ignore the setting.
- **The address** is the one on the owner's account, else the one the cafe was
  made with.

### The mail provider

Behind a small `MailSender` ([`src/mail/sender.mjs`](./src/mail/sender.mjs)):
`send({to, subject, text, html, headers})`. There are two:

- **`log`**, the default: each email is written to the function's log, to
  nobody. The emulators and a platform with no provider use it, and the
  emulator test sends all three this way.
- **`resend`**, [Resend](https://resend.com)'s HTTP API (its free tier is a few
  thousand emails a month). SendGrid would be another thirty lines.

Nothing secret is in the repository. The settings are environment variables
in `.env.<platform-project>` next to `package.json` (git ignores it; see
[`.env.example`](./.env.example); staging copies it to what Firebase uploads),
except the API key, which is a Secret Manager secret:

| Variable          | Meaning                                                                                  |
| ----------------- | ---------------------------------------------------------------------------------------- |
| `MAIL_PROVIDER`   | `log` (default) or `resend`                                                              |
| `MAIL_FROM`       | with `resend`: `CafeMenu <hello@your-domain>`, on a domain verified with Resend          |
| `RESEND_API_KEY`  | with `resend`: **the secret**, `npx firebase-tools functions:secrets:set RESEND_API_KEY` |
| `CONSOLE_URL`     | the console's address, for the "open Updates" link                                       |
| `UNSUBSCRIBE_URL` | the deployed `unsubscribe` function's address, which `firebase deploy` prints            |

The secret is bound to the two notify functions only when `MAIL_PROVIDER` is
`resend` at deploy time, so a platform that sends nothing deploys without one.
A setting that doesn't add up (Resend with no key) doesn't break the deploys:
it is logged, and every email then fails with the reason. **Nothing here has
sent a real email yet** `[[SPIKE #3]]`: the Resend request is checked against
its documented shape in tests, the deploy-time reading of `.env` and the
secret binding wait for the platform project.

The templates ([`src/mail/templates.mjs`](./src/mail/templates.mjs)) are plain
text and a simple HTML page with inline styles, no images or scripts, with
everything an owner typed (the cafe's name) escaped.

## Running the Cloud Functions locally

```bash
npm test -w @cafemenu/platform-functions            # unit tests, any Node 20+
npm run test:emulator -w @cafemenu/platform-functions
```

The unit tests run the callables, the deployment jobs and the GitHub Actions
worker against the deployer's fake Google (`packages/deployer/tests/helpers/`)
and the platform's data in memory.
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
#   NEXT_PUBLIC_BACKEND=functions
```

It serves the console's ports (Auth 9199, Firestore 8180) and Functions on
5101, with a copy of the console's rules. A setup needs the fake Google
running too (`startFakeGoogle` in `tests/helpers/fake-google-server.mjs`); Check
connection and the request callables don't.

Emails show up in the emulators' log (`MAIL_PROVIDER` unset), with the links
pointing at `localhost:3100` and the local `unsubscribe` function.

> Installing under Node 20 skips firebase-admin's optional Firestore package,
> which wants Node 22. `npm ci` on Node 22 installs it.

## Deploying the Cloud Functions (Blaze)

Only if the platform moves to Blaze; on Spark, [the GitHub Actions
backend](#the-backend-on-github-actions) does this work. Done once, by the
maintainer. **All of this waits for the platform project and [[SPIKE #3]].**

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
6. **Emails** (optional). Copy `.env.example` to `.env.<platform-project>`;
   with Resend, verify a sending domain there, set `MAIL_FROM`, store the key
   with `firebase functions:secrets:set RESEND_API_KEY`, and set
   `MAIL_PROVIDER=resend` before deploying. Deploy once, copy the `unsubscribe`
   function's address into `UNSUBSCRIBE_URL` (and the console's into
   `CONSOLE_URL`) and deploy again. [Emails](#emails) says what is sent.
7. **Firestore rules and indexes** are the console's: `firebase deploy --only
firestore` from `apps/console`. The functions need no new index.
8. **Console.** Build it with `NEXT_PUBLIC_BACKEND=functions`, and
   `NEXT_PUBLIC_FUNCTIONS_REGION` if the region isn't `us-central1`.
9. **Stop the GitHub Actions backend**, or leave it: both claim each request
   and deployment before working on it, so they never do one twice.

## Not done here

- **No rate limit on requests.** An owner can write as many as they like;
  the worker takes turns between cafes and answers at most 25 a run, so a
  flood from one cafe slows others down rather than stopping them. Each write
  counts against the platform's free Firestore quota, as an owner's edits to
  their cafe already do.
- **On GitHub Actions, no `release-available` emails** (no unsubscribe
  function to link to; see [Setting it up](#setting-it-up), step 6), and
  answers take up to 5 minutes, or longer when GitHub's schedule runs late.
- **The super admin's actions need the worker.** On Blaze, nothing picks up
  the admin's requests (there is no trigger for `requests/`); run the worker
  (the workflow, or `npm run worker`) beside the functions.
- **Rollout starts and pauses aren't in the admin log yet:** rollouts are the
  deployer's command and the console's stub for #32. Releases published,
  promoted and withdrawn are (the hourly jobs).
- **The console can't start a setup yet:** the `provision` request is done by
  the worker (and tested), but no button writes it
  (`apps/console/src/components/setup/Connected.tsx`, `TODO(#28)`).

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
- **No reminders.** `upgrade-required` goes out when a release is written and
  again on any later release write while the date is ahead; nothing sends "one
  week left" on its own. A scheduled function over `listPinnedCafes` could.
- **No switch in the console** for the release emails: unsubscribing is the
  link, and `emails.releaseNotices` on the cafe is there for a toggle to read.
