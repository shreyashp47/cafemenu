# Contributing

Thanks for helping. This is a small, self-contained project, so the bar is
mostly "keep it small and keep it honest".

The app is **TOE Cafe**, live at <https://toe-cafe.web.app> (Firebase project
`toi-cafe`; the old <https://toi-cafe.web.app> redirects there).

## Getting set up

```bash
git clone https://github.com/shreyashp47/TOE.git
cd TOE
npm ci
npm run dev
```

Node 20.9+ (`.nvmrc` pins 20). **No Firebase account is needed to work on
this.** With no `.env.local` the app runs in demo mode against a localStorage
backend, which is genuinely live across tabs in the same browser. The demo
staff PIN is `1122`.

Work in demo mode unless your change is specifically about Firebase. If you do
have a `.env.local` with real Firebase keys, remember that `npm run dev`, and
every Playwright script that starts it, will talk to that real project.

## How a change gets to the live site

1. Branch off `main`, commit, push, open a pull request.
2. CI runs on the PR (see below). It has to be green.
3. After the merge, CI runs again on `main`. When it passes,
   `.github/workflows/deploy.yml` deploys that commit (Firestore rules and
   Hosting) to `toe-cafe.web.app`. **Merging to `main` is deploying**, once the
   repository has the `FIREBASE_SERVICE_ACCOUNT` secret and the `NEXT_PUBLIC_*`
   variables that workflow needs (README, "Automatic deploys from `main`").

Don't push straight to `main`, and don't deploy from your own machine unless
you are the owner and the automatic deploy is unavailable. The manual deploy is:

```bash
npm run build && firebase deploy --only firestore:rules,hosting
```

Rules and hosting go out together on purpose: an app and rules from different
releases can refuse each other's writes.

## Before you open a PR

```bash
npm run verify         # lint → typecheck → test → build
npm run format:check   # Prettier; `npm run format` fixes it
```

What CI runs, and when:

| Job                                    | Runs on        | What it does                                                         |
| -------------------------------------- | -------------- | -------------------------------------------------------------------- |
| `lint · typecheck · test · build`      | PRs and `main` | The same four steps as `npm run verify`                              |
| `firestore security rules`             | PRs and `main` | `scripts/rules-test.mjs` against the Firestore and Auth emulators    |
| `tests actually fail on a broken rule` | `main` only    | Breaks the money calculation and fails if the test suite stays green |
| `mobile layout smoke test`             | `main` only    | `screenshot.mjs --quick`, `entry.mjs` and `audit.mjs` on the build   |

CI does not run `format:check`, so run it yourself. And because the layout and
accessibility job only runs on `main`, a PR can be green and still fail after
the merge, which blocks the deploy. If you touched anything visual, run the
scripts below locally.

If your change touches money maths, order totals, the status machine, the QR
encoder or report aggregation, add or update a test that would fail without
your change. The self-check job exists to prove the suite catches that kind of
break.

### Firestore rules

If you touched `firestore.rules`, run the rules tests. They need the Firestore
and Auth emulators, which need Java 21+:

```bash
firebase emulators:exec --only auth,firestore --project demo-cafe "npm run test:rules"
```

or, in two terminals, `npm run emulators` and then `npm run test:rules`.

### Playwright scripts

These check what a unit test cannot. Each one starts `next dev` itself, or uses
`BASE_URL` if you set it. Install the browsers once with
`npx playwright install chromium webkit`.

```bash
node scripts/screenshot.mjs   # every screen at 5 widths; fails on overflow
npm run audit                 # WCAG A/AA, in Chromium *and* WebKit (not `npm audit`)
npm run test:entry            # every way a customer reaches the menu
npm run flow                  # customer → staff → customer, end to end
npm run preview               # serve an existing ./out build on port 4320
```

**`npm run flow` is demo-only.** It signs in to the staff board with the demo
PIN and places a real order. Never point it at the live site with `BASE_URL`,
and move any `.env.local` with real keys aside first, or the dev server it
starts will place that order in the real project.

Run `screenshot.mjs` after any styling change and **look at the PNGs** in
`.screenshots/`. It fails on horizontal overflow, but it cannot tell you the
card grid is ugly.

Run `npm run audit` after any change to a colour. The palette is a fixed set of
warm mid-tones and several of them sit below the WCAG AA contrast floor on light
surfaces, so "it looks fine" is not good enough; two of them were only caught by
the audit. If you need text on terracotta, sage or berry, use the `-deep`
variant rather than lightening the background.

## House rules

These exist because of specific problems, not taste.

1. **Never hardcode a colour.** The palette is locked in
   `docs/anime-theme.md` §2 and lives in CSS variables in `src/app/globals.css`.
   Add a token there; don't put a hex in a component.

2. **Never trust the client for money, and know that today we have to.**
   Order totals are recomputed from line items in `src/lib/money.ts`, but that
   runs on the customer's phone. The `create` rule in `firestore.rules` only
   checks the total is a bounded integer; it _cannot_ recompute it (no loops, no
   lambdas), so a doctored total is stored as sent. What catches it is
   `src/lib/order-integrity.ts`, which the staff board runs on every ticket
   against the live menu: detection at the counter, not prevention (issue #27;
   the real fix needs a Blaze-plan function). If you add a field that affects
   what a customer pays, it needs handling in `money.ts` _and_ in that check.

3. **Status changes go through the machine.** Use `transition()` /
   `actionsFor()` from `src/lib/order-status.ts`, not a hand-written status
   string. The Firestore rules enforce the same transitions independently, and
   a test walks the whole chain.

4. **Rules and client change together.** The order create rule pins an exact
   field set and needs the `/orderThrottle/{uid}` stamp in the same batch, and
   `config/tables` has its own shape check. A new order field or a new
   Firestore path needs a rule, a case in `scripts/rules-test.mjs`, and a note
   in the PR about deploy order.

5. **Keep the staff view functional.** Theme doc §5: the board is for speed
   during a rush. No new animation there without a reason a barista would
   notice mid-service.

6. **Add a runtime dependency reluctantly.** Theme doc §6: this app loads on
   cafe wifi and mobile data. The QR encoder and the report chart are both
   hand-written for exactly this reason. If you add one, say what it replaced
   and what it costs in bundle size.

7. **No licensed anime or manga IP.** The mascot is original, and must stay
   that way. Theme doc §7 is explicit.

8. **Never put body text on a mid-tone palette colour.** Use the `-deep` token
   variants. `npm run audit` will fail otherwise.

## Commit messages

Conventional Commits, one logical change per commit:

```
feat(staff): group the board by table when a rush starts
fix(money): recompute the total when an item is removed mid-session
test(qr): round-trip version 3 payloads through the decoder
docs: record the payment decision
```

## Pull requests

The template asks for the essentials. In short:

- Reference the issue it closes (`Closes #12`).
- Say what you verified. "Ran `npm run flow` in demo mode" is useful; "should
  work" is not.
- If it changes the UI, include a screenshot at phone width.
- Small PRs get reviewed. A 2,000-line PR that mixes a refactor with a feature
  will sit.

## Reporting a bug

Use the bug report template. Say whether it happened on the live site
(toe-cafe.web.app) or locally, and if locally, whether in demo mode: the errors
you see with Firebase configured are completely different.

Security problems go through [SECURITY.md](./SECURITY.md), not a public issue.
