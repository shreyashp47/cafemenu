# CafeMenu: requirements

Every requirement for CafeMenu in one place. Status as of 2026-10-25. The
how and the order of work are in [PLAN.md](../PLAN.md); super admin and
maintenance mode are specified in detail in
[super-admin-requirements.md](./super-admin-requirements.md).

## 1. Goal

Any small cafe, in any country, can get its own QR table-ordering website by
filling in a form, without a developer. The cafe owns its data in its own
Firebase project. CafeMenu keeps every cafe updated with releases the owner
chooses. Built from [TOE](https://github.com/shreyashp47/TOE), a QR ordering
app already running at a real cafe.

## 2. Decisions

| Topic                           | Decision                                                                                                                                     |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Where a cafe's data lives       | The owner's own Firebase project, in their own Google account, usually on the free Spark plan                                                |
| Where CafeMenu's own data lives | Firebase project `getcafemenu`: Firestore `(default)` in `asia-south1`, free Spark plan                                                      |
| Database                        | **Firebase only:** Cloud Firestore for data, Firebase Authentication for logins, Firebase Hosting for websites. No other database or server. |
| Backend                         | The same code runs either on **GitHub Actions** (free, chosen: a job every 5 minutes) or as Cloud Functions (needs Blaze; kept as an option) |
| Updates                         | You publish releases; each owner picks auto-update stable, auto-update beta, or stay on a minor line (patches still apply)                   |
| Look                            | Preset themes (Cozy, Minimal, Dark, Bistro) plus the cafe's name, tagline, logo and accent colour                                            |
| Countries                       | Any country from day one: currency, time zone, locale per cafe                                                                               |
| Language                        | English first; every UI string in `apps/cafe/messages/en.json`, ready for more                                                               |
| Pricing                         | Free for now; a `plan` field and feature flags are in place for paid plans later                                                             |
| Licence                         | MIT, public repository                                                                                                                       |
| v1.0 scope                      | **Lean:** generic cafe sites set up and updated by you with the deployer. Self-serve signup and automatic rollouts are v1.1.                 |

## 3. Users and roles

| Role                  | What they do                                                                                               | Where                                        |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| **Super admin** (you) | Sees all owners and cafes, publishes releases, runs rollouts, suspends owners, puts sites into maintenance | CafeMenu console, `/admin`                   |
| **Owner**             | Signs up, connects their Firebase project, picks releases and branding, runs their cafe                    | CafeMenu console, plus their cafe's `/admin` |
| **Staff**             | Works the live order board                                                                                 | Their cafe's `/staff`                        |
| **Customer**          | Scans a table's QR code, orders, follows the order live                                                    | Their cafe's `/order?table=N`, no login      |

## 4. The cafe website (`apps/cafe`)

Everything TOE does, for any cafe.

**Customers**

- Scan a table's QR card to reach the menu: no app, no login.
- Browse categories, see sold-out items and today's special.
- Cart with quantity limits and a per-order cap in the cafe's currency.
- Place an order. There's a 30-second gap between orders from one phone.
- A live status screen: Received → Preparing → Ready → Served, plus Rejected
  with a reason. The daily order number (#0001…) appears live.
- Optional "Approve new tables": a table's first order waits for the counter.
- Table codes expire after 3 hours. Cards printed before codes existed are
  refused once codes are on.
- An offline page when the wifi drops.

**Staff**

- Join by an invite link from the owner (single use, expires in 7 days).
- A live order board with a chime and vibration.
- Accept or reject new guests, and see and close open tables.
- Advance or reject orders.
- A warning when a ticket's total doesn't match the menu.
- Daily numbers that reset at the cafe's local midnight.
- Installable as an app, with the cafe's icon.

**Owner**

- Menu: add, edit, delete, reorder, sold-out switch.
- Start from a starter menu, or import a CSV with row-by-row errors.
- Today's special.
- Tables and QR codes: create a code per table, issue a new code for one
  table, print cards with the cafe's logo.
- Reports by month or custom range, with best sellers and CSV export.
- Order history.
- Staff: invite, cancel an invite, remove, change role. The last owner can't be
  removed.

**Per cafe, from one build**

- Firebase config read at runtime from `/__/firebase/init.json`.
- Settings from `site.json` (written at deploy time) and Firestore
  `config/site` (live).
- **A real cafe never falls back to demo data:** if its config can't load, it
  shows a retry screen.
- Themes with a contrast guard (WCAG AA), plus the cafe's logo and app icons.
- Any currency, with money stored as integer minor units (paise, cents; 0
  decimals for e.g. yen).
- Any time zone, including daylight saving, in the app and in the database
  rules.
- Locale-aware dates and numbers.
- A demo mode with zero configuration, for local development and the public
  demo.

## 5. The CafeMenu console (`apps/console`)

- **Landing page:** what CafeMenu is, how it works, cost, FAQ, sign-up.
- **Signup:**
  - cafe name, web address, email and password, country (fills in currency,
    time zone, locale and region), tables, theme, accent, logo, starting menu;
  - email verification;
  - creates `cafes/{id}` as a draft.
- **Onboarding wizard:**
  - create a Firebase project (Spark);
  - add CafeMenu's deploy account as a member;
  - paste the project ID;
  - **Check connection**.

  It tells the owner that the member won't appear in the Firebase console's own
  list, and links to the Google Cloud IAM page where it does.

- **Automatic setup:** check → provision → first deploy → seed the menu and
  tables → create the owner's account → set-password email. Progress shows
  live.
- **Owner area:**
  - release channel or pin, release notes, Upgrade, Roll back;
  - branding and locale;
  - access, and how to remove it;
  - support-window notices.
- **Admin:**
  - every cafe with its version, channel, health and errors;
  - publish releases, start or pause rollouts;
  - an audit log.

  Super admin powers are being extended per
  [super-admin-requirements.md](./super-admin-requirements.md)
  ([#78](https://github.com/shreyashp47/cafemenu/issues/78)).

- **Owner emails:** new release available, upgrade required by a date, deploy
  failed and was rolled back. Owners can unsubscribe from the non-essential
  ones.
- **Platform rules:**
  - owners read and write only their own cafe;
  - owners can change only the channel or pin of their release;
  - releases, deploys and requests are written by the backend only;
  - admin is a custom claim.

## 6. Deployer, releases and backend

- **Release packages:** a version tag builds the cafe app once and produces a
  reproducible, checksummed package: site, rules, indexes, migrations,
  manifest. It's published as a GitHub Release, and the deployer verifies it
  before using it.
- **Deployer** (`packages/deployer`), running as CafeMenu's service account:
  - `check`, `provision`, `owner`;
  - `deploy --version`: schema guard → migrations → rules and indexes →
    Hosting with the cafe's own files → after-deploy check → automatic
    rollback on failure;
  - `rollback`, `sync-branding`, `migrate`, `rollout`, `smoke`.
- **Migrations:** ordered, resumable and idempotent, with a dry-run mode; they
  expand, then contract. The first one moves TOE's whole rupees to paise; it
  runs while the cafe is closed.
- **Rollouts:** TOE first as the canary, then beta cafes, then stable cafes in
  batches. A rollout pauses when failures cross a threshold, and can be
  resumed. Patches also reach pinned cafes; no cafe ever moves down a version.
- **Support window:** only the latest two minor lines get fixes. Cafes on
  older lines get a notice, then a forced move after the date.
- **Backend:** setup, connection checks, deploy, rollback and branding
  requests, owner emails, and support-window jobs, on GitHub Actions
  ([#77](https://github.com/shreyashp47/cafemenu/issues/77)).

## 7. Super admin and maintenance mode

Full detail in [super-admin-requirements.md](./super-admin-requirements.md).

- **Directory:** every owner and cafe, with search, filters and CSV export.
  The admin can never see a cafe's orders.
- **Owner status:** suspend, reactivate (with a reason and an email to the
  owner) and delete. Delete never touches the owner's own project.
- **Maintenance mode for any cafe's site:**
  - customers see a "back soon" page, and QR codes keep working;
  - the staff board and owner dashboard keep working;
  - new orders are refused by the database rules;
  - it takes effect within 1 minute, with no redeploy;
  - it can be scheduled or bulk, and survives updates;
  - an owner can start their own maintenance, but can't end one the admin
    started.
- **Admin log:** append-only. Admins can appoint other admins.

## 8. Non-functional requirements

- **Cost:**
  - cafes run on Firebase's free Spark plan;
  - the backend runs free on GitHub Actions;
  - the only optional cost is a custom domain.
- **Security:**
  - every boundary is in the Firestore rules, with emulator tests;
  - no credentials in the repo;
  - the deploy account's key lives only in a GitHub secret;
  - the release workflow publishes without running npm code.
- **Performance:**
  - the cafe app's first load is about 103 kB;
  - an order reaches the staff board within a few seconds.
- **Accessibility:** WCAG AA, checked in Chromium and WebKit, for every theme.
- **Reliability:**
  - every deployer step is safe to re-run;
  - an after-deploy check runs, with automatic rollback;
  - migrations are resumable.
- **Ownership:**
  - owners keep their data and can leave at any time; their site keeps
    running on its last release;
  - the privacy policy and terms are drafted
    ([docs/legal](./legal/README.md)) and need a lawyer's review before the
    first outside cafe signs up.

## 9. Not in v1

Tracked in the [Later milestone](https://github.com/shreyashp47/cafemenu/milestone/6):

- one-click "Connect with Google" project creation;
- paid plans and billing;
- more languages;
- online payments (UPI first);
- a custom domain helper.

## 10. Open items

| Item                                                    | Who               | Issue                                                                                                         |
| ------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Platform deploy service account and a test cafe project | You               | [#2](https://github.com/shreyashp47/cafemenu/issues/2)                                                        |
| First real runs of the deployer against Google          | Claude, after #2  | [#3](https://github.com/shreyashp47/cafemenu/issues/3)–[#7](https://github.com/shreyashp47/cafemenu/issues/7) |
| Backend on GitHub Actions                               | Claude            | [#77](https://github.com/shreyashp47/cafemenu/issues/77)                                                      |
| Super admin and maintenance mode                        | Claude, after #77 | [#78](https://github.com/shreyashp47/cafemenu/issues/78)                                                      |
| Move TOE onto the platform                              | Claude, with you  | [#23](https://github.com/shreyashp47/cafemenu/issues/23)                                                      |
| Lawyer's review of the terms                            | You               | [#31](https://github.com/shreyashp47/cafemenu/issues/31)                                                      |
| v1.0 test pass                                          | Both              | [#41](https://github.com/shreyashp47/cafemenu/issues/41)                                                      |
| Six super-admin decisions                               | You               | [super-admin-requirements.md §8](./super-admin-requirements.md)                                               |
