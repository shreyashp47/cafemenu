# CafeMenu — plan

Turn [TOE](https://github.com/shreyashp47/TOE) into a product any small cafe can
set up for itself: fill a form, follow a few steps, and get its own QR-ordering
website. The cafe owns its data; you keep shipping updates to every cafe.

_"CafeMenu" is a working name._

## Decisions so far

| Question | Decision |
| --- | --- |
| Where does a cafe's data live? | In **the owner's own Firebase project**, in their own Google account. They own the data and pay any Firebase bill (usually ₹0 on the free Spark plan, same as TOE). |
| Who updates the sites? | **You.** Your platform has deploy access to each owner's project and pushes new releases. |
| "Versions" | **Releases** (v1, v2, …). Each owner picks which release their cafe runs and when to upgrade. |
| Look | **Preset themes** + the cafe's own name, tagline, logo and accent colour. |
| Countries | **Any country from day one**: currency, time zone, date and number formats are per cafe. |
| Language | **English first**, with every string in a translation file so more languages are a drop-in later. |
| Pricing | **Free for now, paid later.** Leave room for plans without building billing yet. |
| Code and tracking | Public, MIT-licensed repo [shreyashp47/cafemenu](https://github.com/shreyashp47/cafemenu). One milestone per phase, one issue per piece of work. |
| Version 1.0 | Phases 0–4, then a full test of every feature ([v1.0 release testing](#v10-release-testing)) before tagging `v1.0.0`. |

## What TOE gives us, and what has to change

TOE (v0.3.0) is solid and already half generic:

- The owner runs everything in the browser: menu, sold-out, tables, QR cards,
  today's special, reports, order history.
- Storage is behind interfaces (`src/lib/data/types.ts`: `MenuRepository`,
  `OrderRepository`, `AuthRepository`, `ConfigRepository`, `SessionRepository`)
  with a Firestore backend and a localStorage demo backend.
- Demo mode needs no setup, so it doubles as a "try it" preview.
- `firestore.rules` is a real security boundary with 130 emulator checks.

Tied to one cafe today:

| Today in TOE | Needs to become |
| --- | --- |
| Firebase keys baked in at build time (`NEXT_PUBLIC_FIREBASE_*`), `.firebaserc` → `toi-cafe` | **One build per release, shared by every cafe.** Config is read at runtime. |
| Name from an env var; tagline, colours (`globals.css`), fonts, "Mochi" mascot, icons, manifest colours hardcoded | Per-cafe settings + theme presets |
| ₹/INR, `en-IN`, whole rupees, IST midnight for order numbers and reports (also inside `firestore.rules`, `dayKeyOf`) | Per-cafe currency (stored in minor units: paise, cents), locale and time zone |
| Owner and staff accounts made with `npm run seed:staff` from a terminal | Owner account made by the platform; staff added from the owner dashboard by invite link |
| Manual `firebase deploy` | Automatic deploys of a chosen release to each cafe's project |
| English text written inline in components | Strings in `messages/en.json` |

## How it fits together

```
 YOUR side (one Firebase project: "the platform")        EACH CAFE (owner's own Firebase project)
 ┌───────────────────────────────────────────┐           ┌──────────────────────────────────────┐
 │ Console site  cafemenu.web.app             │           │ Cafe site  their-cafe.web.app        │
 │  • landing + signup form                   │  deploy   │  • same release bundle for everyone   │
 │  • onboarding steps + progress             │ ────────► │  • + per-cafe site.json, manifest,    │
 │  • owner: pick release, upgrade, roll back │  (service │    logo                               │
 │  • you: cafes, releases, rollouts          │  account) │ Firestore: menu, orders, staff,       │
 │                                            │           │   config/site (theme, currency, tz)   │
 │ Deployer (Cloud Functions / CLI)           │           │ Auth: owner, staff, anonymous guests  │
 │  • provisions new projects                 │           │ Rules + indexes from the release      │
 │  • deploys releases, runs migrations       │           └──────────────────────────────────────┘
 │ Releases store: bundle + rules + indexes   │
 │   + migrations, per version                │
 └───────────────────────────────────────────┘
```

**One build per release, not per cafe.** The cafe app stops reading Firebase
keys at build time. Firebase Hosting serves each project's own web config at the
reserved URL `/__/firebase/init.json`, so the same bundle connects to whichever
project it is deployed to. Cafe settings (name, theme, accent, currency, time
zone, locale) live in that cafe's Firestore at `config/site`. A small
`site.json`, the manifest and the logo and icons are written at deploy time, so
the first paint and the home-screen icon are already branded.

**Which settings live where.** Things that change daily stay in the cafe's own
owner dashboard, as in TOE: menu, sold-out, tables, QR cards, today's special,
staff. Things baked into the deployed files are edited in the console: name,
logo, theme, accent, currency, time zone, language. Saving them updates
`config/site` and redeploys the cafe's small files on its current release, which
takes seconds.

**Deploy access.** The owner adds your platform's service account as a member
of their project, from the Firebase console's _Users and permissions_ page. From
then on the deployer can set the project up and push releases with Google's REST
APIs: Hosting, Firestore Admin, Firebase Rules, Identity Toolkit and Firebase
Management. Removing that member stops all updates, so the owner stays in
control. One catch: the Firebase console doesn't list service accounts among
the members. They only show on the Google Cloud IAM page, so the console must
link straight to that page for checking or revoking access.

**Web address.** A project's default Hosting site is named after the project ID,
which Google sometimes suffixes (`their-cafe-1a2b3`). The deployer adds a second
site named after the cafe (`their-cafe.web.app`) when that name is free, as TOE
already does with `toe-cafe`. Site names are unique across all of Firebase.

## Releases ("versions")

- A **release** is one versioned package: the static web bundle,
  `firestore.rules`, `firestore.indexes.json`, data migrations and release
  notes. Semantic versions: `1.4.2`.
- Each cafe stores `release: { channel, pinned, current, previous }`. The owner
  chooses one of:
  - **Auto-update (stable)**: the default.
  - **Auto-update (beta)**: gets new versions first.
  - **Stay on 1.4**: no feature changes until they press **Upgrade**.
    **Patch fixes (1.4.x) still apply automatically**, so security fixes reach
    everyone.
- **Upgrade** and **Roll back to previous** buttons, with release notes.
  Hosting keeps old versions, so a rollback is instant. Rules are re-deployed
  from the previous release.
- **Support window:** only the latest 2 minor lines are kept alive. Older pins
  get a "please upgrade by…" notice, then a forced move.
- **Schema versions:** each cafe's `config/meta.schemaVersion`. Migrations must
  be expand-then-contract (new fields first, remove old ones a release later),
  so the previous release keeps working against migrated data. TOE's 0.2.0
  upgrade, where rules and hosting had to ship together, is the case this
  prevents.
- **Rollout in waves:** your own TOE cafe first (the canary), then beta cafes,
  then stable in batches. After each deploy the deployer runs a smoke test
  (TOE's `test:entry` against the live URL) and rolls back automatically if it
  fails.

## The owner's steps ("steps to own it")

1. **Fill the form** on cafemenu.web.app:
   - cafe name, web address name (`their-cafe`), owner email
   - country, which pre-fills currency, time zone and Firestore region
   - number of tables
   - theme, accent colour (checked for readable contrast) and logo
   - starting menu: a template for the type of cafe, a blank menu, or a pasted
     list or CSV
2. **Verify their email** (link from your platform).
3. **Create a Firebase project** in their own Google account, guided by
   screenshots: Firebase console → Add project → free Spark plan.
4. **Give CafeMenu access**: in the Firebase console, Settings → _Users and
   permissions_ → **Add member**, paste
   `deploy@<platform>.iam.gserviceaccount.com`, pick the role the setup page
   names, then paste the project ID back into the form and press **Check
   connection**. The member won't appear in the Firebase console's list
   afterwards; the setup page says so and links to where it does appear.
5. **Wait about a minute** while it sets up. A progress screen shows each step:
   enable services, create the database, turn on sign-in, deploy the rules,
   deploy the site, load the menu and tables, create the owner account.
6. **Set a password** from the email the cafe's own Firebase project sends,
   then sign in at `their-cafe.web.app/staff`.
7. **Go live:** check the menu, print the QR cards from _Table QR codes_,
   invite staff by link, and optionally connect a custom domain (guided steps).

**Leaving.** An owner who stops using CafeMenu removes the member. Their site
keeps running on its last release, and the data was always theirs.

Later, steps 3–4 can become one **Connect with Google** button that creates the
project for them. That needs Google's OAuth app verification for Cloud scopes:
until an app is verified, Google shows a warning screen and caps it at 100 users
for the life of the project. So it isn't in the first version.

## Work plan

Each phase is a milestone on GitHub, and each bullet below is roughly one issue.
Every issue says why it's needed, what to do, when it's done and what it depends
on.

| Phase | Milestone | Issues | Estimate |
| --- | --- | --- | --- |
| 0 · Spike | [Phase 0](https://github.com/shreyashp47/cafemenu/milestone/1) | [#1](https://github.com/shreyashp47/cafemenu/issues/1)–[#7](https://github.com/shreyashp47/cafemenu/issues/7) | 8–13 days |
| 1 · Config-free cafe app | [Phase 1](https://github.com/shreyashp47/cafemenu/milestone/2) | [#8](https://github.com/shreyashp47/cafemenu/issues/8)–[#18](https://github.com/shreyashp47/cafemenu/issues/18) | 27–41 days |
| 2 · Release pipeline | [Phase 2](https://github.com/shreyashp47/cafemenu/milestone/3) | [#19](https://github.com/shreyashp47/cafemenu/issues/19)–[#23](https://github.com/shreyashp47/cafemenu/issues/23) | 11–17 days |
| 3 · Console | [Phase 3](https://github.com/shreyashp47/cafemenu/milestone/4) | [#24](https://github.com/shreyashp47/cafemenu/issues/24)–[#31](https://github.com/shreyashp47/cafemenu/issues/31) | 22–31 days |
| 4 · Automatic rollouts | [Phase 4](https://github.com/shreyashp47/cafemenu/milestone/5) | [#32](https://github.com/shreyashp47/cafemenu/issues/32)–[#35](https://github.com/shreyashp47/cafemenu/issues/35) | 8–12 days |
| v1.0 · Release testing | [v1.0 testing](https://github.com/shreyashp47/cafemenu/milestone/7) | [#41](https://github.com/shreyashp47/cafemenu/issues/41) | 10–17 days |
| Later | [Later](https://github.com/shreyashp47/cafemenu/milestone/6) | [#36](https://github.com/shreyashp47/cafemenu/issues/36)–[#40](https://github.com/shreyashp47/cafemenu/issues/40) | not estimated |

Estimates are in working days; see [Timeline](#timeline) for how they add up.

### Phase 0: Spike (prove the risky part first)

Set up the monorepo and bring in TOE's code (v0.3.0) as `apps/cafe`. Then,
using a throwaway Google account and Firebase project, prove that a script
running as **a service account from another project** can:

- enable the needed APIs, create the Firestore database in a chosen region, and
  turn on Email/Password + Anonymous sign-in
- register a web app and read its config, and confirm `/__/firebase/init.json`
  serves it
- add a named Hosting site, and deploy a hosting version to it with the Hosting
  REST API
- deploy rules + indexes
- create the owner's Auth user, write `/staff/{uid}`, and send a "set your
  password" email

Outputs: the **smallest set of IAM roles** the owner must grant, the exact
console steps (with screenshots) for steps 3–4, and a `deployer` CLI that does
all of the above for one project. Anything that can't be automated moves into
the owner's manual steps.

### Phase 1: Make the TOE app config-free (`apps/cafe`)

- Runtime config: `init.json` + `site.json` + `config/site`, no
  `NEXT_PUBLIC_*` needed in production. Keep demo mode.
- Theme presets as CSS variable sets (`data-theme="cozy" | "minimal" | "dark"
  | …`; TOE's look becomes "Cozy"), plus accent override and logo. The mascot
  and doodles belong to the Cozy theme only.
- Money in minor units with per-cafe currency; `formatINR` → `formatMoney`.
  Order caps per currency.
- Time zone per cafe for daily order numbers, reports and CSV. The rules'
  `dayKeyOf` adds a fixed 330 minutes (IST), which is only exact because India
  has no daylight saving. Proposed fix: `config/site` stores the zone's standard
  and daylight-saving offsets, and the rules accept a day key that matches
  either. This is the trickiest rules change.
- All UI text moves to `messages/en.json` through a small `t()` helper. No
  heavy i18n library, to stay inside TOE's ~103 kB first-load budget.
- Staff invites in the owner dashboard: the owner makes a one-time invite link;
  staff sign up with it, and the rules allow `/staff/{uid}` only against a
  valid unused invite. This replaces `seed:staff` and works on the free plan.
- Starter menus: a few templates by type of cafe, plus paste or CSV import on
  the owner's menu screen.
- A `plan` field and feature-flag check, unused for now, so paid plans can come
  later without rework.
- TOE keeps working throughout as a cafe whose settings are today's values
  (₹, IST, Cozy theme).

### Phase 2: Release pipeline

- CI builds a release package on a version tag and stores it.
- `deployer deploy --cafe <id> --version <x.y.z>`: migrations → rules +
  indexes → hosting (the shared bundle plus that cafe's `site.json`, manifest,
  logo and icons) → smoke test → mark current, or roll back.
- Migration runner + `schemaVersion`. Migrate TOE's whole-rupee prices to
  paise as the first real migration.
- Use it on TOE by hand until it's boring.

### Phase 3: The console (`apps/console`)

- Landing page, live demo, signup form, email verification.
- Onboarding wizard (steps above), connection check, provisioning progress.
- Owner area: current release, channel or pin, release notes, Upgrade, Roll
  back; branding and locale settings; how to check or revoke access; a link to
  their cafe's dashboard.
- Your admin: all cafes with version, health and last deploy; publish a
  release; start or pause a rollout.
- Privacy policy and terms, written before the first outside cafe signs up:
  what access is granted, what you can see, how to leave.

### Phase 4: Automatic rollouts

- Publishing a release schedules waves: TOE → beta → stable batches.
- Auto-rollback on a failed smoke test; pause the rollout if failures cross a
  threshold.
- Email owners about new releases and required upgrades. This needs an email
  provider on the platform, such as Resend or SendGrid on a free tier; the
  cafe's own Firebase only sends sign-in emails.

### v1.0 release testing

When every issue in Phases 0–4 is closed, test every feature end to end before
tagging `v1.0.0` ([#41](https://github.com/shreyashp47/cafemenu/issues/41)):

- **New cafe, from nothing:** a brand-new Google account goes through signup,
  onboarding and setup with no help, on desktop and on a phone.
- **Every TOE feature** for customers, staff and owners, on real phones
  (Android Chrome, iPhone Safari, a low-end Android on slow data), including
  printed QR cards.
- **Every per-cafe setting:** each theme, accent colours, logos, several
  currencies and time zones (including a daylight-saving change).
- **Releases:** stable and beta, staying on a version, patches, upgrade,
  rollback, rollout waves, auto-rollback, migrations, the support window.
- **Security:** the full rules suite, one owner against another in the console,
  revoking access, no secrets in the repo or the bundle.
- **Limits:** first-load size, accessibility, and a busy day's usage staying
  inside the Firebase free plan.
- **A real service:** TOE and at least one other cafe run a normal day on the
  release candidate.

Every problem found becomes an issue labelled `v1-blocker` or moves to a later
milestone. v1.0 ships when no `v1-blocker` is open and every check has passed.

### Later

- One-click "Connect with Google" project creation.
- Paid plans: billing on the platform, entitlements already in place.
- More languages; owner-editable customer text.
- Online payments per country: UPI for India (TOE's in-progress work), card
  payments elsewhere. Card payments need server code, so the Blaze plan on the
  owner's project.
- Custom domain helper.

## Timeline

Estimated in **working days for one developer**, at TOE's standard: tests and
docs included. Each issue carries its own estimate; these are the totals.

| Phase | Low | High |
| --- | ---: | ---: |
| 0 · Spike | 8 | 13 |
| 1 · Config-free cafe app | 27 | 41 |
| 2 · Release pipeline | 11 | 17 |
| 3 · Console | 22 | 31 |
| 4 · Automatic rollouts | 8 | 12 |
| v1.0 release testing (5–7 days testing, 5–10 days fixing) | 10 | 17 |
| **Total to v1.0** | **86** | **131** |

What that means on the calendar:

| Pace | To a first outside cafe (end of Phase 3) | To v1.0 |
| --- | --- | --- |
| Full-time, 5 days a week | 14–20 weeks | 17–26 weeks (about 4–6 months) |
| Part-time, about 2 focused days a week | 34–51 weeks | 43–66 weeks (about 10–15 months) |

Starting full-time in late October 2026, v1.0 lands roughly between
mid-February and late April 2027, not counting holidays.

**Assumptions**

- One developer, working through the issues in dependency order. Most phases
  are a chain, so a second developer helps mainly inside Phase 1 (themes,
  currency, time zones, text and staff invites can run side by side) and
  Phase 3.
- Time spent waiting on others isn't counted: a cafe's feedback, a lawyer
  reading the terms, Google's OAuth verification (that's in Later anyway).
- No new scope. Anything added to v1.0 adds its own estimate.

**What could move it**

- **Phase 0 is the biggest unknown.** If Google refuses a step for a service
  account, onboarding gains a manual step (a few days more). If the whole
  approach fails, the plan changes before Phase 1, and the later estimates
  change with it.
- **The rules changes** for currency ([#12](https://github.com/shreyashp47/cafemenu/issues/12)) and time zones ([#13](https://github.com/shreyashp47/cafemenu/issues/13)) sit in TOE's
  most carefully tested code. They are estimated generously, but they're the
  likeliest to run over.
- **Real-phone testing** usually finds layout and timing bugs that the
  automated checks miss. That is why release testing has its own fixing time.

<details>
<summary>Estimate for each issue</summary>

| Issue | Days |
| --- | --- |
| #1 Monorepo + TOE import | 1–2 |
| #2 Platform project, service account, test cafe | 0.5–1 |
| #3 Spike: access and roles | 1–2 |
| #4 Spike: set up a project | 2–3 |
| #5 Spike: deploy rules, indexes, site | 2–3 |
| #6 Spike: owner account and email | 1 |
| #7 Spike write-up, go/no-go | 0.5–1 |
| #8 Runtime Firebase config | 1–2 |
| #9 Cafe settings | 3–4 |
| #10 Theme presets and accent | 4–6 |
| #11 Logo and app icons | 2–3 |
| #12 Any currency (minor units) | 3–5 |
| #13 Any time zone | 3–5 |
| #14 UI text into `messages/en.json` | 4–6 |
| #15 Staff invite links | 3–4 |
| #16 Starter menus and import | 2–3 |
| #17 Plan field and feature flags | 1 |
| #18 TOE fixture in CI | 1–2 |
| #19 Release package | 2–3 |
| #20 Deploy, rollback, sync-branding | 4–6 |
| #21 Migrations (TOE prices to paise) | 3–4 |
| #22 Post-deploy smoke test | 1–2 |
| #23 TOE onto the pipeline | 1–2 |
| #24 Console app and platform database | 3–4 |
| #25 Landing page and demo | 2–3 |
| #26 Signup form | 3–4 |
| #27 Onboarding wizard | 3–4 |
| #28 Provisioning job | 4–5 |
| #29 Owner area | 3–5 |
| #30 Platform admin | 3–4 |
| #31 Privacy policy and terms | 1–2 |
| #32 Rollout waves | 3–4 |
| #33 Auto-rollback | 2–3 |
| #34 Owner emails | 2–3 |
| #35 Support window | 1–2 |
| #41 v1.0 release testing | 10–17 |

</details>

## Repository layout (proposed)

```
CAFEMENU/
  apps/cafe/          TOE, generalised: the thing that gets released
  apps/console/       platform site: signup, onboarding, owner updates, your admin
  packages/deployer/  provisioning + deploy (Google REST APIs), used by CLI and functions
  packages/shared/    types: CafeSettings, theme presets, money and time helpers
  docs/
```

Start from TOE's code in `apps/cafe` rather than a rewrite. TOE becomes the
first cafe on the platform once Phase 2 is done, and stays the canary for every
release.

## Costs

- **Each cafe:** free on Spark for a 6–10 table cafe, as TOE is today. Their own
  quota, not shared with other cafes. Custom domain optional (~₹500–800/year).
- **You:** the platform project on Blaze for Cloud Functions (provisioning and
  deploys run rarely, so expect around ₹0 to a few hundred a month), a domain
  for the console, and an email provider's free tier.

## Risks and open questions

- **Trust.** Deploying rules and running migrations needs near-admin access to
  the owner's project, including their order data. This needs a clear privacy
  policy and terms, and the console must say plainly what access is granted and
  how to revoke it.
- **Automation gaps.** Some Google steps may refuse a service account or need a
  click in the console (for example, accepting Firebase terms on a new account).
  Not yet confirmed: whether a service account can create the Firestore
  database and turn on sign-in methods in a project on the free Spark plan.
  Phase 0 decides this.
- **Many live versions** means more to test and support; the 2-minor-line
  support window keeps that bounded.
- **Web address names** (`their-cafe.web.app`) are globally unique across all of
  Firebase, so the form must check availability and suggest alternatives.
- **Time zones in the rules** (see Phase 1).
- **Price units change** (whole rupees → minor units) touches the rules, reports,
  CSV export and TOE's existing data.
