# Changelog

Notable changes to CafeMenu, in the
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Versions
follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- The cafe app: [TOE](https://github.com/shreyashp47/TOE) v0.3.0 (TOE `main`
  at `74cff3c`) in `apps/cafe`, with TOE's exact dependency versions, inside an
  npm workspace (`apps/*`, `packages/*`). TOE's CI runs on it unchanged.
- The plan ([PLAN.md](./PLAN.md)), with a phase-by-phase timeline, and the
  roadmap as GitHub milestones and issues.
- MIT License, contributing guide, security policy, code of conduct, and issue
  and pull request templates.
- **A smoke test after every deploy** (#22). `deployer deploy --version` checks
  the cafe's live address with read-only requests (its pages, the new build's
  service worker, `site.json`, `init.json`, the security headers, a 404) and
  rolls the cafe back, recording both in the deploy log, if any check still
  fails after a few tries. The same checks run alone with
  `packages/deployer/bin/smoke.mjs`.
- **Rollout waves, with a pause on failures** (#32, #33). `deployer rollout`
  works out which cafes get a release from their channel and pin (a beta to
  beta cafes, a patch also to cafes pinned to its minor line, never down), then
  deploys the canary, the beta cafes and the stable cafes in batches, each with
  its smoke test and automatic rollback. It pauses when the canary fails or
  more than 1 in 5 of a batch does, and `--resume` carries on. `--dry-run`
  prints the plan only.
- **Owner emails** (#34), in `apps/platform-functions`: a new version for the
  cafes that stay on one, an upgrade required by a date, and a deploy that
  failed or was rolled back. A `MailSender` that logs by default and sends
  through Resend when configured (no secrets in the repository); plain-text and
  HTML templates; each email sent once per cafe per thing; the optional ones
  carry an unsubscribe link (`emails.releaseNotices` on the cafe), the
  essential ones (failures, required upgrades) always go.
- **The support window** (#35): only the latest two minor lines are supported.
  A cafe that stays on an older line sees a notice with the date to upgrade by
  in the owner area and gets an email, and `deployer rollout` moves it, and its
  pin, to the new line once that date has passed, recording why. One function
  in `@cafemenu/shared/support-window` does the maths for all three; the policy
  is in `docs/releases.md` and the terms.
- **The platform's backend** (#28), `apps/platform-functions`: Cloud Functions
  that set a brand-new cafe up (`check`, `provision`, the first `deploy`, the
  starting menu, the owner's account and set-password email) while writing each
  step's progress to its `deployments/{id}`, and that run the console's Check
  connection, Upgrade, Roll back and Save branding with the deployer. Runs are
  safe to repeat, carry on where they stopped, retry transient errors and fail
  in plain words with what to do next. The console calls them when
  `NEXT_PUBLIC_BACKEND_FUNCTIONS` is set. Tested on the Functions, Firestore and
  Auth emulators against the deployer's fake Google; not yet run against real
  Google (`[[SPIKE #3]]`).
- **The backend on GitHub Actions, for free** (#77). The console asks the
  backend with a `requests/{id}` document (connection check, setup, upgrade,
  roll back, branding sync), which the rules let an owner write only for their
  own cafe and never change. `.github/workflows/backend.yml` runs the worker
  (`npm run worker -w @cafemenu/platform-functions`) every 5 minutes: it claims
  each request in a transaction, does it with the same handlers as the Cloud
  Functions, writes progress and the result back, and runs the owner emails and
  the support window. It signs in with the platform service account's key from
  the `production` environment's `PLATFORM_SERVICE_ACCOUNT` secret, and its
  public log holds ids and outcomes only. The console uses it with
  `NEXT_PUBLIC_BACKEND=requests` ("this takes a few minutes", with live
  progress); demo mode stays the default, and the Cloud Functions stay for
  Blaze. Tested end to end on the Auth and Firestore emulators.
- **The super admin, and maintenance mode** (#78). The console's `/admin`
  lists every owner and cafe (search, five filters, CSV), opens one cafe's
  full history, and suspends, reactivates or deletes an owner, or puts a
  cafe's site into maintenance (one or several at once, resumable and
  revertable), each as a request the backend does and writes to an admin log
  nobody can edit; the owner is emailed with the reason. A cafe's own rules
  refuse new orders while CafeMenu's maintenance (`config/site.maintenance`,
  `deployer maintenance`) or the owner's own (from their dashboard) is in
  effect, on a schedule in the cafe's time zone; customers see a "back soon"
  page, and placed orders, the staff board and the dashboard keep working.
  Section 8's decisions are provisional, in `@cafemenu/shared/admin-policy`.
  The first admin is made with `npm run make-admin`; the deploy account now
  needs Firebase Authentication Admin.
