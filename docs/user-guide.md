# CafeMenu: your guide

For you, the person running CafeMenu. It covers what's live, how to run and
deploy everything yourself, how to set up a cafe, and what still needs doing.
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

The backend runs as a GitHub Actions job every 5 minutes (#77), not as Cloud
Functions, so no paid plan is needed. Once #77 is merged:

1. **Create CafeMenu's deploy account.** In the Google Cloud console for
   `getcafemenu`, go to IAM & Admin → Service accounts → Create, give it the
   roles the #77 README lists, then Keys → Add key → JSON.
2. **Give the key to GitHub, then delete your copy:**
   ```bash
   gh secret set PLATFORM_SERVICE_ACCOUNT --env production < ~/Downloads/key.json
   rm ~/Downloads/key.json
   ```
3. **Ask Claude to switch the console to real mode:** create the Firestore
   database (`asia-south1`), turn on Email/Password sign-in, deploy the
   platform rules, and rebuild the console with its Firebase settings.
4. **Make yourself the super admin** (the one-time command in the console
   README).

GitHub pauses scheduled jobs on a public repo after 60 days with no commits.
Push something now and then, or re-enable the job under **Actions**.

## 8. Your super-admin powers

Today, `/admin` on the CafeMenu website shows:

- every cafe and its owner;
- each cafe's version, channel and health;
- the deploy history;
- publishing releases, and starting or pausing rollouts.

Coming with [#78](https://github.com/shreyashp47/cafemenu/issues/78), per
[super-admin-requirements.md](./super-admin-requirements.md):

- an owners directory;
- suspend, reactivate and delete an owner;
- **maintenance mode** for any cafe's website;
- an admin log nobody can edit;
- appointing other admins.

Before that's built, answer the six decisions in section 8 of that doc.

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

| Step                                                             | Who                |
| ---------------------------------------------------------------- | ------------------ |
| Free disk space so new sessions can start                        | You, or ask Claude |
| The backend on GitHub Actions (#77)                              | Claude             |
| Deploy account key as a GitHub secret (#2, section 7)            | You                |
| First real deployer runs and fixes (#3–#7)                       | Claude             |
| A test cafe project in a spare Google account (#2)               | You                |
| Super admin and maintenance mode (#78), after your six decisions | You, then Claude   |
| Move TOE onto CafeMenu (#23), at a quiet hour                    | Claude, with you   |
| Lawyer's review of privacy and terms (#31)                       | You                |
| v1.0 test on real phones and a real cafe day (#41)               | Both               |
