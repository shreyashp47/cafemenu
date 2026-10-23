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
