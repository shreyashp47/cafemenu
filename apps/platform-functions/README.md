# @cafemenu/platform-functions

The platform's backend: what sets a cafe up and runs its deploys, rollbacks
and branding syncs, with
[`@cafemenu/deployer`](../../packages/deployer/README.md) used as a library.
It acts as one service account of the **platform** Firebase project
(`getcafemenu`), which is the account every owner adds to their own project
([PLAN.md](../../PLAN.md#how-it-fits-together)). It runs in one of two ways,
from the same code:

|                     | **The worker on GitHub Actions**                         | **Cloud Functions (2nd gen)**                                      |
| ------------------- | -------------------------------------------------------- | ------------------------------------------------------------------ |
| Costs               | nothing: the repository is public, Firebase on Spark     | needs the Blaze plan                                               |
| The console asks by | writing a `requests/{id}` and watching it                | calling a function                                                 |
| Answers in          | minutes (the schedule runs every five)                   | seconds                                                            |
| The account's key   | a JSON key, a GitHub secret                              | none: the function's own identity                                  |
| Switch in console   | `NEXT_PUBLIC_BACKEND=requests` (**the plan**)            | `NEXT_PUBLIC_BACKEND=functions`                                    |
| Start here          | [The free way](#the-free-way-a-worker-on-github-actions) | [What it does](#what-it-does-cloud-functions) and everything after |

Blaze stays an option: the Cloud Functions are all still here, and the
worker calls the same handlers they do ([#77](https://github.com/shreyashp47/cafemenu/issues/77)).

> [!WARNING]
> **Nothing here has run against real Google yet.** The backend is tested
> against the deployer's fake Google and the Firebase emulators. The worker's
> key is not created, and the Phase 0
> spikes ([#2](https://github.com/shreyashp47/cafemenu/issues/2),
> [#3](https://github.com/shreyashp47/cafemenu/issues/3)) have not run. Every
> assumption that waits for them is marked `[[SPIKE #3]]` below and in the
> code.

## The free way: a worker on GitHub Actions

[`.github/workflows/backend.yml`](../../.github/workflows/backend.yml) runs
`npm run worker -w @cafemenu/platform-functions` every five minutes (GitHub's
shortest interval; a run can start a few minutes late), and when started by
hand (`gh workflow run backend.yml`). One run:

1. takes the console's queued **requests**, oldest first (at most 20, and none
   started after ten minutes), and does each with the handlers the callables
   use ([`src/requests.mjs`](./src/requests.mjs));
2. once an hour, sends the owner emails that are due: the new-release notices
   and the support window's upgrade notices ([`src/worker.mjs`](./src/worker.mjs)).

### A request

The console writes `requests/{id}` and listens to it. The rules
([`firestore.rules`](../console/firestore.rules)) let a verified owner create
one only for their own cafe, with a kind and the params that kind takes, and
nothing else; the admin may also create `publish` and `rollout` (the worker
does not run those yet and fails them as `unimplemented`). Nobody but the
backend updates or deletes one.

| Field                      | Written by | Meaning                                                                                          |
| -------------------------- | ---------- | ------------------------------------------------------------------------------------------------ |
| `cafeId`, `ownerUid`, `by` | console    | the cafe, its owner, who asked (all the same uid, but for the admin's)                           |
| `kind`, `params`           | console    | `check {projectId}` · `provision {}` · `deploy {version}` · `rollback {}` · `sync-branding {}`   |
| `status`                   | both       | `queued` → `running` → `done` or `failed`                                                        |
| `steps`, `detail`          | worker     | the progress, as a deployment's: the same steps, mirrored onto the request                       |
| `result`                   | worker     | a `check`'s answer (`connected`, `no-access`, `missing`), else `{deploymentId, status, siteUrl}` |
| `error`, `errorCode`       | worker     | why it failed, in words an owner can act on, and a Firebase-style code                           |
| `deploymentId`             | worker     | the deployment a setup, deploy, rollback or sync made                                            |
| `attempts`, `lease`        | worker     | who has it, until when                                                                           |

- **Claimed in a transaction**, with the rules deployments already use
  ([`claim.mjs`](./src/claim.mjs)): a request is `running` with a lease that is
  renewed while it works, so two runs never take the same one, and one whose
  run died is taken back once the lease ends. A request is picked up at most
  five times.
- **The document is not trusted.** The worker looks the asker up in Auth again
  (verified, and the `admin` claim) and runs the same checks the callables do:
  who owns the cafe, what state it is in, whether another deployment is under
  way. The rules are the first lock, not the only one.
- **A request that cannot be done is answered, not retried**: `failed`, with
  the code and words the console already has for it (`permission-denied`,
  `failed-precondition`, `invalid-argument`…). One that has to wait (Google
  slow, out of time in this run, another run holds its deployment) goes back to
  `queued` and carries on from the same deployment at the next run.
- A failed deployment emails its owner once, as `notifyOnDeployment` did.

### What it costs, and how fast

Free: GitHub does not bill a public repository's Actions minutes, and an idle
run is one query (a Firestore read) plus the install, about a minute. On
Spark that is a few hundred of the 50,000 daily reads; each request is a few
dozen reads and writes. The price is time: an owner who presses Upgrade waits
for the next run (up to five or six minutes) and then for the deploy, and the
console says "This takes a few minutes" and shows the progress. A request
nobody has picked up after 20 minutes is shown as late.

### Set it up (once, by the maintainer)

Nothing here has been done yet, and the repository does not do it for you.

1. **The service account.** In the Google Cloud console for `getcafemenu`
   (or with `gcloud`), create the account every owner will add to their own
   project, and give it the roles it needs on the **platform** project: read
   and write Firestore (`roles/datastore.user`) and look owners up in
   Authentication (`roles/firebaseauth.viewer`). It needs no role on the
   owners' projects: they grant those themselves.
   `[[SPIKE #3]]` which roles owners grant it (the console's setup page lists
   the permissions `deployer check` tests for) is settled by the spike.

   ```bash
   PROJECT=getcafemenu
   gcloud iam service-accounts create cafemenu-deploy --project "$PROJECT" \
     --display-name "CafeMenu deploy account"
   SA="cafemenu-deploy@$PROJECT.iam.gserviceaccount.com"
   for role in roles/datastore.user roles/firebaseauth.viewer; do
     gcloud projects add-iam-policy-binding "$PROJECT" \
       --member "serviceAccount:$SA" --role "$role" --condition=None
   done
   ```

   That address is what the console shows owners
   (`NEXT_PUBLIC_DEPLOY_SERVICE_ACCOUNT`).

2. **The key, straight into GitHub.** Create a JSON key, put it in the
   `production` environment's secrets, and delete your copy:

   ```bash
   gcloud iam service-accounts keys create key.json --iam-account "$SA"
   gh secret set PLATFORM_SERVICE_ACCOUNT --env production \
     --repo shreyashp47/cafemenu < key.json
   rm -P key.json 2>/dev/null || rm key.json
   ```

   Setting a secret creates the environment if it is not there. A Google
   Workspace organisation may forbid keys (`iam.disableServiceAccountKeyCreation`);
   a personal account does not.

3. **Keep the key from everything but `main`.** In the repository's
   Settings → Environments → `production`, set _Deployment branches_ to
   **main only**, and add no required reviewers (a run would wait for one).
   Protect `main` too (a pull request and a review to change it): whoever can
   change the workflow on `main` can read the key.
4. **Optional, for emails**: repository _variables_ `MAIL_PROVIDER` (`resend`),
   `MAIL_FROM`, `CONSOLE_URL`, and the secret `RESEND_API_KEY`, in the
   `production` environment ([Emails](#emails)). Without them the emails are
   not sent at all, and the log says only that they were not. Note the
   `unsubscribe` link is a Cloud Function, so without `UNSUBSCRIBE_URL` only
   the emails an owner can't switch off go out (a failed deploy, an upgrade
   that is required), not the new-release notices.
5. **Turn the console's real mode on** and deploy its rules and indexes, which
   now include `requests`: [the console's README](../console/README.md#turning-the-real-platform-on).
6. **Try it**: `gh workflow run backend.yml`, then watch the run under
   Actions. With the key missing the run only warns and stops.

To change or revoke the key: create a new one, `gh secret set` it, delete the
old one in Google Cloud (IAM → Service accounts → Keys). If it ever leaks, do
that at once: it reaches every cafe that added the account.

### The schedule stops after 60 days without a commit

GitHub switches **scheduled** workflows off in a public repository that has had
no activity for 60 days. The repository's own commits are the activity, and a
project that is being worked on has them; a quiet one does not, and the
backend would then stop without any error. To keep it alive:

- make a commit now and then. Releases and merged pull requests count; if
  nothing else is going on, `git commit --allow-empty -m "chore: keep the
schedule alive" && git push` on `main` (a protected `main` wants a pull
  request: merge any change) at least every 50 days;
- if it was switched off anyway, Actions → Backend → **Enable workflow**, or
  `gh workflow enable backend.yml`. Requests wait in the queue meanwhile; the
  console says a request is late after 20 minutes.

GitHub mails the repository's admins before and when it does this
(unverified): do not rely on it. Turning the schedule off does not lose
anything; it only stops the work.

### Run it yourself

```bash
npm run test:worker -w @cafemenu/platform-functions   # a request through the rules to the worker, on the emulators
npm run worker -w @cafemenu/platform-functions        # one run; needs GOOGLE_APPLICATION_CREDENTIALS, or the emulators
```

`test:worker` needs Node 22.18+ and Java 21 (see
[Running it locally](#running-it-locally)). It writes requests as a signed-in
owner through the console's real rules, runs the worker program as the
workflow does against the deployer's fake Google, and checks the answers: a
connection check, a setup, an upgrade, a rollback and a branding sync; the
refusals; two workers at once never taking the same request; and the upgrade
notice a cafe on a dropped line gets. The worker refuses to start for a pull
request (`GITHUB_EVENT_NAME`) and without a key, and logs only a line's
message and the ids it is about: the workflow's logs are public. To find out
why something failed, set the repository variable `WORKER_VERBOSE` to `1` for
a run (it adds one line of each error, which may name a project), and remove
it afterwards.

## What it does (Cloud Functions)

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

The console reaches the first five through
[`apps/console/src/lib/data/callables.ts`](../console/src/lib/data/callables.ts),
switched on with `NEXT_PUBLIC_BACKEND=functions` (or the older
`NEXT_PUBLIC_BACKEND_FUNCTIONS=1`). They need the Blaze plan; the free way
above does not use them. Off, and always in demo mode, nothing changes.

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

## Running it locally

```bash
npm test -w @cafemenu/platform-functions            # unit tests, any Node 20+
npm run test:emulator -w @cafemenu/platform-functions   # the Cloud Functions
npm run test:worker -w @cafemenu/platform-functions     # the worker (#77)
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

## Deploying to the platform project (Cloud Functions, Blaze)

Only for the Cloud Functions way; the worker on GitHub Actions needs none of
this ([set it up](#set-it-up-once-by-the-maintainer)). Done once, by the
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
8. **Console.** Build it with `NEXT_PUBLIC_BACKEND_FUNCTIONS=1`, and
   `NEXT_PUBLIC_FUNCTIONS_REGION` if the region isn't `us-central1`.

## Not done here

- **The worker does not run the admin's `publish` and `rollout` requests** (the
  rules let the admin write them; the worker fails them as `unimplemented`).
  Publishing a release record (#30) and starting a rollout (#32) still wait for
  their handlers. Nor does it serve the `unsubscribe` link, a Cloud Function.
- A request is not rate-limited beyond the rules and the 20 a run: an owner
  who writes hundreds can slow the others down for a few runs.
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
