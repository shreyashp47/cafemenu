# CafeMenu: your guide

For you, the person running CafeMenu. It covers what's live, how to run and
deploy everything yourself, how to set up a cafe, and what still needs doing.
**Status 2026-10-27: paused for a few days.** Everything is on GitHub `main`; no session is running. Restart with section 12.

The requirements are in [requirements.md](./requirements.md), the design in
[PLAN.md](../PLAN.md).

## 1. What's live now

| Address                            | What it is                                                                              | Mode                                                                                                    |
| ---------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| <https://getcafemenu.web.app>      | The CafeMenu website: landing, signup, onboarding, owner area, admin                    | **Demo:** sign-ups stay in the visitor's browser until the backend is on                                |
| <https://getcafemenu-demo.web.app> | A demo cafe ("Mochi & Beans"). Customers: `/order?table=3`. Staff: `/staff`, PIN `1122` | **Demo:** orders stay in the browser; customer and staff see each other in two tabs of the same browser |
| <https://toe-cafe.web.app>         | TOE, your real cafe, still on TOE v0.3.0 from its own repo                              | Live. **Don't test there.**                                                                             |

Both CafeMenu sites are in the Firebase project **`getcafemenu`** (free Spark
plan), on two Hosting sites: `getcafemenu` and `getcafemenu-demo`.

## 2. Run it on your Mac

```bash
cd ~/Documents/CAFEMENU
npm ci                                   # once, and after pulling new code
npm run dev                              # the cafe app: http://localhost:3000
npm run dev -w @cafemenu/console         # the CafeMenu website (another terminal)
npm run verify                           # every check: lint, types, tests, build
```

- **Never delete `package-lock.json`.** Rebuilding it from scratch crashes npm.
- The database rules tests need Java 21. They run on GitHub automatically.

## 3. Redeploy the live sites

One command builds both sites from the current code and deploys them to
`getcafemenu`:

```bash
firebase login                           # once; as the owner of getcafemenu
./scripts/deploy-live.sh
```

Run it after merging changes to `main`. It takes a few minutes. Afterwards,
check both addresses from section 1 load.

## 4. Where the data is

**All data is in Firebase.**

- **CafeMenu's own data** is in project `getcafemenu`: owner sign-ups, cafes,
  releases, deploy history, requests, and the admin log (planned). It's in
  Firestore `(default)`, region `asia-south1`.
- **Each cafe's data** is in that owner's own Firebase project: menu, orders,
  staff, settings. You never read it.
- **Logins** are in Firebase Authentication: CafeMenu accounts in
  `getcafemenu`, each cafe's staff and owner in that cafe's project.
- **GitHub** keeps the code, the release packages, and (soon) the backend job
  and its secret key.

The `getcafemenu` Firestore database isn't created yet. It comes with turning
the backend on (section 7).

## 5. Set up a cafe yourself (lean v1.0)

Until self-serve signup is switched on, you set up each cafe with the
deployer.

**The owner:**

1. Creates a Firebase project (free Spark plan).
2. Adds CafeMenu's deploy account as a member: Settings → Users and
   permissions → Add member. The steps and wording owners see are in
   [docs/legal/access-explained.md](./legal/access-explained.md).

**You:**

```bash
export GOOGLE_APPLICATION_CREDENTIALS=~/keys/cafemenu-deploy.json   # the deploy account's key; never commit it
D="node packages/deployer/bin/deployer.mjs"

$D check     --project their-project
$D provision --project their-project --region asia-south1 --site their-cafe
$D deploy    --project their-project --site their-cafe --version 1.0.0 --settings their-cafe.json --logo logo.png
$D owner     --project their-project --email owner@example.com --name "Owner name"
```

Add `--dry-run` to any command to see what it would do without changing
anything. The owner then gets a set-password email, signs in at
`https://their-cafe.web.app/staff`, and prints the QR cards from
**Table QR codes**.

Every flag and option is in
[packages/deployer/README.md](../packages/deployer/README.md). The settings
file is the same shape as
[apps/cafe/fixtures/toe.json](../apps/cafe/fixtures/toe.json).

> The deployer has only been tested against a fake Google so far. Its first
> real run is the Phase 0 spike (#3–#7), which needs the deploy account (#2).

## 6. Releases and updates

1. Add the version's notes to `CHANGELOG.md`.
2. Tag and push:
   ```bash
   git tag v1.0.0 && git push origin v1.0.0
   ```
   GitHub builds, checks and publishes the release package. A `-beta.N` suffix
   makes it a beta. Details are in [docs/releases.md](./releases.md).
3. Roll it out:
   ```bash
   $D rollout --version 1.0.0 --cafes cafes.json --dry-run    # see who gets it
   $D rollout --version 1.0.0 --cafes cafes.json
   ```
   It goes to TOE first, then beta cafes, then stable cafes in batches, and
   pauses if deploys fail. Resume with `--resume <rollout-id>`.
4. Other updates:
   - **One cafe:** `$D deploy … --version x.y.z`.
   - **Undo:** `$D rollback --project … --site …`.
   - **Branding only:** `$D sync-branding …`.

## 7. Turn the backend on (free, no Blaze)

The backend runs as a GitHub Actions job every 5 minutes (#77,
`.github/workflows/backend.yml`), not as Cloud Functions, so no paid plan is
needed. Once #77 is merged:

1. **Switch the console to real mode**, steps 1–3: create the Firestore
   database (`asia-south1`), turn on Email/Password sign-in, deploy the
   platform rules and indexes. The
   [console README](../apps/console/README.md#real-mode-the-platform-project)
   has each click and command.
2. **Create CafeMenu's deploy account and its key**: in the Google Cloud
   console for `getcafemenu`, IAM & Admin → Service accounts → Create, give it
   the two platform roles, then Keys → Add key → JSON. The
   [platform-functions README](../apps/platform-functions/README.md#setting-it-up)
   lists the roles and the commands.
3. **Create the `production` environment** (Settings → Environments, limited
   to `main`), **give it the key, make yourself the super admin with it, then
   delete your copy.** Sign up on the console with your own email first;
   then:
   ```bash
   gh secret set PLATFORM_SERVICE_ACCOUNT --env production < ~/Downloads/key.json
   GOOGLE_APPLICATION_CREDENTIALS=~/Downloads/key.json \
     npm run make-admin -w @cafemenu/platform-functions -- --email you@example.com
   rm ~/Downloads/key.json
   ```
   Sign out of the console and in again to have the admin flag.
4. **Rebuild the console** with its Firebase settings and
   `NEXT_PUBLIC_BACKEND=requests`, and redeploy (`./scripts/deploy-live.sh`).
5. **Try it:** Actions → Backend → Run workflow, then Check connection as a
   test owner.
6. **If you set this up before #78**, the deploy account has the Firebase
   Authentication **Viewer** role: swap it for **Admin**
   (`roles/firebaseauth.admin`), which suspending and deleting logins need.

GitHub pauses scheduled jobs on a public repo after 60 days with no commits.
Push something now and then, or re-enable the job under **Actions → Backend**.
The job's log is public, so it shows request ids and outcomes only.

## 8. Your super-admin powers

`/admin` on the CafeMenu website (sign in with your admin account) has, per
[super-admin-requirements.md](./super-admin-requirements.md):

- **every owner and cafe**: who, when they signed up and last signed in, the
  address, project, status, maintenance, plan, version and health. Search,
  filter, and download it as CSV;
- **one cafe's history**: its requests, deploys, status changes, maintenance
  windows and the emails its owner got;
- **suspend, reactivate and delete** an owner, each with a reason from the
  list (and 7 days' notice for non-payment). The owner is emailed each time;
  a suspended owner can't sign in, and their requests are refused with the
  reason. Delete asks you to type the cafe's address, and never touches their
  own Firebase project;
- **maintenance mode** for a cafe's website, or several at once (resumable,
  and revertable): customers see a "back soon" page and can't order, staff
  and the owner's dashboard keep working, and only you can end it;
- **an admin log** nobody can edit, filterable and downloadable;
- publishing releases, and starting or pausing rollouts.

Each action is done by the backend's next run, so within about 5 minutes
(**Actions → Backend → Run workflow** does it at once). Owners can also turn
maintenance on themselves, from their cafe's dashboard, for a holiday or a
renovation.

The six decisions in section 8 of that doc are answered **provisionally**
with the suggested choices (separate suspension and maintenance, a fully
working staff board, delete keeps only the log, just you as admin). Confirm
or change them in `packages/shared/src/admin-policy.mjs` before the first
outside cafe signs up, and have the terms' new section on suspension and
maintenance reviewed with the rest.

## 9. Staff accounts at a cafe

Owners invite staff from their dashboard (**Staff → Invite**). For the very
first owner account of a project that wasn't set up by the deployer, the
fallback is `npm run seed:staff -w @cafemenu/cafe -- --email=… --role=owner`.

## 10. Working with Claude on this

- **Resuming:** say "continue" in this session. Claude merges green PRs and
  starts the next issue. Work runs one session at a time when usage is tight.
- **Your plan's limits:** the 5-hour and weekly limits are shared by every
  session. When a limit hits, sessions pause with their work saved and resume
  after the reset.
- **Disk space:** each session's worktree needs about 5 GB free. Old ones live
  in `CAFEMENU/.claude/worktrees` and can go once their PRs are merged (ask
  Claude to clean them up).
- **Keeping your Mac awake:** `caffeinate -ims` while sessions run; close the
  terminal tab or run `pkill caffeinate` to stop it.

## 11. What's left, and who does it

| Step                                                             | Who              |
| ---------------------------------------------------------------- | ---------------- |
| The backend on GitHub Actions (#77)                              | Claude           |
| Deploy account key as a GitHub secret (#2, section 7)            | You              |
| First real deployer runs and fixes (#3–#7)                       | Claude           |
| A test cafe project in a spare Google account (#2)               | You              |
| Super admin and maintenance mode (#78), after your six decisions | You, then Claude |
| Move TOE onto CafeMenu (#23), at a quiet hour                    | Claude, with you |
| Lawyer's review of privacy and terms (#31)                       | You              |
| v1.0 test on real phones and a real cafe day (#41)               | Both             |

## 12. Restarting after a break

Say **"continue"** to Claude in this project, then:

1. **Backend on GitHub Actions (#77).** Its session never started, because the
   disk was full at the time; there's room now (22 GB free). Restart it from
   that session, or ask Claude to start it again.
2. **Your part of #2.** Create the deploy account and its key, then the
   `PLATFORM_SERVICE_ACCOUNT` GitHub secret (section 7), plus a test cafe
   project in a spare Google account.
3. **First real deployer run (#3–#7)** against that test cafe, then a real cafe
   site live on Firebase with orders across phones.
4. **Super admin and maintenance mode (#78),** after your six decisions in
   [super-admin-requirements.md](./super-admin-requirements.md) §8.
5. **Housekeeping:**
   - Four Dependabot PRs are waiting: #43, #44, #46, #52. Merge them when CI
     is green.
   - Old session worktrees in `.claude/worktrees` can be cleaned up: all their
     work is on `main`.
