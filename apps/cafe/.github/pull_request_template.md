## What and why

<!-- What changes, and the problem it solves. Link the issue: Closes #N / Refs #N -->

## How it was tested

<!-- Tick what you ran. Leave unticked what doesn't apply, and say why. -->

- [ ] `npm run verify` (lint, typecheck, tests, build)
- [ ] `npm run format:check` (CI does not run this one)
- [ ] `npm run test:rules`, if `firestore.rules` changed
      (`firebase emulators:exec --only auth,firestore --project demo-cafe "npm run test:rules"`)
- [ ] `npm run audit` and `node scripts/screenshot.mjs`, if anything visual changed
      (CI only runs these after the merge, on `main`)
- [ ] Tested in demo mode (no `.env.local`), at phone width
- [ ] Screenshots below, if the UI changed

## Screenshots

<!-- Before / after at phone width, for any UI change. Delete if none. -->

## Deploy notes

<!--
Merging to main deploys: once CI passes on main, the Deploy workflow ships
Firestore rules and hosting to toe-cafe.web.app (when auto-deploy is configured).
So say here if this needs anything beyond that: a Firestore index, a console
setting, a new repository variable, or a rules change that the old app (still
open on phones) cannot work with.
-->
