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
