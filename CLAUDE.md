# CafeMenu: start here

CafeMenu turns TOE (a QR cafe-ordering app) into a platform where any cafe
gets its own ordering site in its **own** Firebase project, kept up to date
with releases the owner chooses.

## Where things stand

1. **[PLAN.md → Progress](./PLAN.md#progress):** every issue, done or open,
   with the PR that did it.
2. **[docs/user-guide.md](./docs/user-guide.md) §12:** where to restart, in
   order.
3. **[docs/requirements.md](./docs/requirements.md):** every requirement.
   [docs/super-admin-requirements.md](./docs/super-admin-requirements.md) has
   the super admin and maintenance-mode spec.

**Next step** (as of 2026-10-27):

1. Review the free backend, #77. Compare PR #83 (cloud) with PR #82 (local),
   merge the better one with "Rebase and merge", and close the other.
2. Review and merge PR #84 (#78, super admin). It's stacked on #83; check its
   `firestore.rules` changes.
3. The branch `feature/backend-and-super-admin` holds #83 and #84 together.

After that, the remaining work needs the maintainer's Firebase setup (#2).

## Layout

| Path                      | What it is                                                                    |
| ------------------------- | ----------------------------------------------------------------------------- |
| `apps/cafe`               | The cafe website: Next.js static export, Firebase, demo mode with zero config |
| `apps/console`            | The CafeMenu website: signup, onboarding, owner area, admin                   |
| `apps/platform-functions` | The backend: GitHub Actions worker, and Cloud Functions if Blaze is ever used |
| `packages/deployer`       | CLI and library that set up and deploy cafes in owners' projects              |
| `packages/shared`         | Cafe settings, themes, money, time zones, menus, shared by the others         |
| `scripts/release`         | Release packages, built and published on version tags                         |
| `scripts/deploy-live.sh`  | Redeploys getcafemenu.web.app and getcafemenu-demo.web.app                    |

## Rules that matter

- **Never delete `package-lock.json`.** Resolving the workspace from scratch
  crashes npm (`edgesOut`); `npm install` from the lockfile works.
- **All data stays in Firebase.** CafeMenu never reads a cafe's orders.
- **No Blaze.** The backend runs on GitHub Actions.
- **Rules and app change together.** Every rules change needs emulator tests
  (Java 21).
- **Never test against a real cafe** (toe-cafe.web.app). Use demo mode and the
  emulators.
- **Never commit credentials.** The deploy key lives only in a GitHub secret.
- **Git workflow:** branch, then PR, then "Rebase and merge". Conventional
  Commits. Run `npm run verify` at the root before opening a PR.
- **Usage is limited.** Work one session at a time, and keep this file and
  PLAN.md's Progress section up to date when work lands.
