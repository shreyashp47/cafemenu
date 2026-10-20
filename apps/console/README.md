# CafeMenu console

The CafeMenu website: what CafeMenu is, and, as Phase 3 lands, where a cafe
owner signs up, connects their own Firebase project and picks which release
their cafe runs, and where the maintainer runs releases. It is hosted on the
platform's own Firebase project. A cafe's menu and orders never come here;
they live in the owner's project ([PLAN.md](../../PLAN.md#how-it-fits-together)).

Today it has the landing page ([#25](https://github.com/shreyashp47/cafemenu/issues/25)),
a "coming soon" sign-up page, and the platform's data model, sign-in and
security rules ([#24](https://github.com/shreyashp47/cafemenu/issues/24)),
which the sign-up form (#26), onboarding (#27), owner area (#29) and admin
(#30) build on.

Same stack as the cafe app, on the same versions: Next.js 15 (static export),
React 19, TypeScript, Tailwind CSS v4, Firebase 12, Vitest.

<p align="center">
  <img src="docs/screens/landing-phone.jpg" width="320" alt="The landing page on a phone: the early-development notice, the CafeMenu header with Sign up, the headline 'QR table ordering for your cafe, on your own Firebase.', Sign up and Try the demo buttons, and the cafe app's menu and order board side by side">
</p>

## Run it

From the repository root, once:

```bash
npm ci
```

Then:

```bash
npm run dev -w @cafemenu/console     # http://localhost:3100
```

Port 3100, so the cafe app can run on 3000 beside it.

### Three backends

| Mode          | How                                                           | What it talks to                                                                   |
| ------------- | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Demo**      | the default: no `.env.local`                                  | localStorage in your browser. No account, nothing sent, no email.                  |
| **Emulators** | `NEXT_PUBLIC_FIREBASE_EMULATORS=1` and `npm run emulators`    | the Auth and Firestore emulators, project `demo-cafemenu`. Java 21                 |
| **Firebase**  | the six `NEXT_PUBLIC_FIREBASE_*` values from the platform app | the real platform project ([#2](https://github.com/shreyashp47/cafemenu/issues/2)) |

See [.env.example](./.env.example). Demo mode applies the same checks as the
rules, with the same error codes, so a page built against it does not then
fail on permissions. It sends no verification email: `demoVerifyEmail()` in
`src/lib/data/demo.ts` stands in for the link.

The emulators' ports (Auth 9199, Firestore 8180, UI 4010) differ from the cafe
app's, so both can run at once.

## The platform database

Types in [`src/lib/platform/model.ts`](./src/lib/platform/model.ts), rules in
[`firestore.rules`](./firestore.rules).

| Path                 | What                                                       | Written by                                      | Read by                      |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------- | ---------------------------- |
| `cafes/{cafeId}`     | one per cafe                                               | its owner (some fields), the backend (the rest) | its owner, the admin         |
| `releases/{version}` | one per published release, id `1.4.2`                      | the backend only                                | any verified account         |
| `deployments/{id}`   | one per setup, deploy, rollback or branding sync of a cafe | the backend only                                | that cafe's owner, the admin |

A cafe:

| Field                    | Meaning                                                                      | Owner may set                   |
| ------------------------ | ---------------------------------------------------------------------------- | ------------------------------- |
| `ownerUid`               | the platform account that owns it                                            | at creation, as self            |
| `ownerEmail`             | that account's email                                                         | at creation, as own             |
| `projectId`              | the owner's Firebase project; `null` until the access step                   | while `draft`                   |
| `site`                   | Hosting site name: `their-cafe` → their-cafe.web.app                         | while `draft`                   |
| `settings`               | `CafeSettings` from `@cafemenu/shared`: name, theme, accent, currency, zone… | yes, except `plan`              |
| `release.channel`        | `stable` or `beta`                                                           | yes                             |
| `release.pinned`         | a minor line (`"1.4"`) to stay on, or `null`; patches of it still apply      | yes                             |
| `release.current`        | the version deployed now; `null` before the first deploy                     | **never**                       |
| `release.previous`       | the version before it: where Roll back goes                                  | **never**                       |
| `status`                 | `draft` → `provisioning` → `live`; or `failed`, `disconnected`, `suspended`  | **never** (`draft` at creation) |
| `createdAt`, `updatedAt` | server time                                                                  | stamped by the server           |

A deployment carries `cafeId`, `ownerUid` (copied, so an owner's query can be
proved by the rules), `kind` (`provision`, `deploy`, `rollback`, `branding`),
`version`, `fromVersion`, `status` (`queued`, `running`, `succeeded`,
`failed`, `rolled-back`), `trigger` (`owner`, `rollout`, `admin`), `steps` for
the progress screen, `error`, `createdAt` and `finishedAt`.

A release carries `channel`, Markdown `notes`, `publishedAt`, the
`schemaVersion` it expects in each cafe's database, and `withdrawn`.

**Accounts.** Email and password, with email verification: the rules refuse
every write from an unverified account, reading `email_verified` from the ID
token, so the console refreshes the token after the link is clicked
(`AuthRepository.refresh()`). The maintainer has the custom claim
`admin: true`, which only the Admin SDK can set; an admin reads everything,
and writes through the backend like everyone else.

**The backend** (the deployer, and the Cloud Functions to come in
[#28](https://github.com/shreyashp47/cafemenu/issues/28)) writes with the
platform service account, which Firestore does not hold to the rules. It is
the only writer of releases, deployments, a cafe's status, its plan and
`release.current`/`previous`. Upgrade and Roll back (#29) will be requests to
it, not client writes.

## Checks

```bash
npm run verify -w @cafemenu/console        # lint, typecheck, unit tests, build
npm run format:check -w @cafemenu/console
```

Rules and Firebase code, against the emulators (Java 21+; from `apps/console`):

```bash
npm run emulators            # terminal 1
npm run test:rules           # terminal 2: attacks firestore.rules
npm run test:emulators       # terminal 2: the console's Firebase adapters through them
```

or in one go:

```bash
firebase emulators:exec --only auth,firestore --project demo-cafemenu "npm run test:rules && npm run test:emulators"
```

Both wipe the emulators' data first and refuse a project ID that does not
start with `demo-`.

Pages, with Playwright (`npx playwright install chromium webkit` once):

```bash
npm run screenshot           # every page at 4 widths into .screenshots/; fails on overflow
npm run audit                # WCAG 2.1 A/AA with axe, in Chromium and WebKit
```

CI runs all of it in [`.github/workflows/console.yml`](../../.github/workflows/console.yml)
on every pull request, and checks that the rules test fails when a rule is
deliberately broken.

## Design

The console has its own look, separate from any cafe's theme: warm paper,
espresso ink, a basil green. Colours are tokens in
[`src/app/globals.css`](./src/app/globals.css); never put a hex in a component.
Text pairs and their contrast (WCAG AA needs 4.5:1):

| Text            | On               |     Ratio |
| --------------- | ---------------- | --------: |
| `text`          | `paper`          |      11.7 |
| `muted`         | `paper` / `sunk` | 6.1 / 5.5 |
| `brand-ink`     | `paper`          |       8.2 |
| white           | `brand`          |       6.5 |
| `brand-soft`    | `brand`          |       5.4 |
| `accent-ink`    | `accent-soft`    |       5.9 |
| `on-dark`       | `espresso`       |      13.9 |
| `on-dark-muted` | `espresso`       |       8.6 |
| `accent`        | `espresso`       |       6.5 |

Headings use Fraunces at one weight, self-hosted by `next/font`; body text is
the system font. Every word is in [`messages/en.json`](./messages/en.json),
with `**bold**`, `` `code` `` and `[links](https://…)` rendered by
`<Rich>`, never as HTML.

The screenshots in `public/screens` are the cafe app's, from
`apps/cafe/docs/screens`, except `06-qr-cards.png`: that one is retaken in
demo mode, because the original shows a live cafe's address and the top of
its table codes. **Never link people to a real cafe's site to try ordering.**
