# Security policy

TOE Cafe runs at <https://toe-cafe.web.app>, a Firebase Hosting site in the
Firebase project `toi-cafe`. <https://toi-cafe.web.app> only redirects there.
There is one supported version: whatever is on `main`. It is deployed by hand
until automatic deploys are switched on (README, _Automatic deploys from
`main`_).

## Reporting a vulnerability

Please **do not open a public issue, pull request or discussion** with the
details of a security problem.

Report it privately to the maintainer, [@shreyashp47](https://github.com/shreyashp47):

- If the repository's **Security** tab offers _Report a vulnerability_, use
  that. It keeps the report private until a fix ships.
- If it does not, open an issue titled "Security contact request" with **no
  details**, and the maintainer will reply with a private channel.

Include what you found, how to reproduce it, and the impact you believe it has.
You can expect an acknowledgement within a few days. This is a one-maintainer
project for one cafe, so there is no bug bounty.

Please test against your own Firebase project or the local emulators
(README, "Going live with Firebase"; `npm run test:rules` shows how the rules
are exercised), not against the live site. The live order book is a real cafe's
counter during service: don't place fake orders there, and don't script
requests against it.

## Scope

**In scope**, roughly in order of how much it matters:

- Any way around `firestore.rules`: reading someone else's order, listing the
  order book without a `/staff/{uid}` document, editing or deleting an order,
  skipping or reversing a status, writing the menu, `config` or `/staff`
  without an owner account, or getting a malformed `config/tables` past its
  shape check.
- Privilege escalation: an anonymous customer treated as staff, or `staff`
  becoming `owner`.
- Bypassing the order throttle (one order per anonymous uid per 30 seconds)
  **without** minting a new anonymous uid for each order.
- Script injection (XSS) through anything a customer or owner can type: order
  notes, menu names and descriptions, the table list, or a crafted `/order` URL.
- Bugs in the pricing maths or in the staff board's integrity check
  (`src/lib/order-integrity.ts`) that let a wrong total through **unflagged**.
- A secret committed to the repository, or a way for a pull request to reach
  the deploy credentials in `.github/workflows/`.

**Out of scope**, because they are public by design or already known:

- **The Firebase web config.** The `NEXT_PUBLIC_FIREBASE_*` values (API key,
  project id, app id and so on) ship in every page's JavaScript. They identify
  the project; they grant nothing. `firestore.rules` is what protects the data.
- **A forged order total being stored** (issue #27). The rules language cannot
  sum a list, so a tampered client can post any bounded total. The staff board
  re-derives every order from its lines and the live menu and flags the
  mismatch before payment. A real fix needs a server-side function on the Blaze
  plan.
- **Throttle bypass by signing in anonymously again** for each order. Firebase
  Auth's per-IP limit on new accounts slows this; stopping it needs App Check,
  which needs the Blaze plan.
- **Demo mode.** With no Firebase config, the app stores everything in the
  visitor's own `localStorage` and the staff PIN (`1122` by default) is in the
  source. It is a local sandbox, not a security boundary, and the live site
  does not run in it.
- Volumetric denial of service, spam, social engineering, and vulnerabilities in
  Firebase or Google Cloud themselves (report those to Google).
- Missing hardening headers or best-practice findings with no working exploit.

## What protects what

- **Customers** place orders with no login, by design (`docs/requirements.md`
  §3). Each one signs in anonymously so the rules can let them `get` their own
  order (`customerUid == request.auth.uid`) and nothing else. They can read the
  menu and `config`, and create orders.
- **Order creation** is the only public write, and the rule is written to be
  hostile: an exact field set, `status` pinned to `preparing`, `createdAt` equal
  to `request.time` (no backdating out of a report month), table 1–50, bounded
  item count, quantity and total. It must be written in the same batch as a
  stamp on `/orderThrottle/{uid}` naming that order, and the rules refuse the
  stamp within 30 seconds of the previous one. The stamp cannot be deleted,
  backdated, or written for another uid, and one stamp cannot carry two orders.
- **Staff and owners** sign in with email and password. Staff membership is the
  presence of a `/staff/{uid}` document, so the default is closed; the role in
  that document decides `staff` or `owner`. Staff can list orders and advance
  the status one legal step at a time, changing only `status` and
  `completedAt`. Completed orders cannot change. Only owners write the menu,
  `config`, and `/staff`, and delete orders.
- **The table list** (`config/tables`, saved on `/admin/qr`) is owner-only and
  shape-checked: only a `tables` field, 1–50 entries, first and last entries
  whole numbers 1–50. The client also drops any entry outside 1–50 when it
  reads the list (`normalizeTables` in `src/lib/tables.ts`).
- **The old `/meta/counters` document** is gone (issue #30), and `/meta`, like
  every path not listed in the rules, is denied to everyone. Daily order numbers
  come from `dayCounters/{YYYY-MM-DD}`, which only staff and the owner can read
  or write; it only steps up by one, cannot be deleted, and an order can only
  be given the counter's exact next number, once. Every counter write must name
  the one order it numbers in the same commit (`last`), so one commit cannot
  give two orders the same number, and the counter cannot be bumped on its own.
- **What a staff account can still do to the numbers:** staff are trusted with
  the board, and the rules do not rate-limit them. A hostile or compromised
  staff account could use up a day's 9,999 numbers (for example by numbering
  hand-crafted or rejected orders in a loop; on the emulator this runs at a few
  hundred a minute). The cafe keeps working: later orders that day stay
  unnumbered, the board says numbering has stopped, and tickets, History and
  the CSV fall back to the older three-digit number. Fix: remove that account's
  `/staff` document. Numbering starts again at #0001 the next day.
- **The Firebase SDK** is only loaded when the Firebase config is set, and it
  never holds a secret.

## Secrets that do matter

- **`FIREBASE_SERVICE_ACCOUNT`**, the deploy key stored as a GitHub Actions
  secret for `.github/workflows/deploy.yml`. It can deploy Hosting and Firestore
  rules, so whoever holds it can effectively rewrite the rules and open the
  whole database. It is only used by the deploy workflow, which runs on `main`
  after CI passes (never for a pull request), in the `production` environment.
  The secret is not set yet, so today the workflow does not deploy.
  Never commit it or keep a local copy. Rotate it by adding a new key in the
  Google Cloud console, setting the secret again, and deleting the old key.
- **The owner's `firebase login`.** `npm run seed:staff` and
  `npm run cleanup:orders` run on the owner's machine with the token that login
  stored, act as a project owner or editor over IAM, and bypass
  `firestore.rules`. They are only as safe as that laptop. Neither stores a
  credential or a generated password. `cleanup:orders` is a dry run unless given
  `--confirm`, and refuses to delete anything under six months old.
- **Staff and owner passwords.** `seed:staff` prints a generated password once
  and saves it nowhere.

## Keeping it that way

- CI attacks the rules on every pull request (`scripts/rules-test.mjs` against
  the emulators), alongside lint, typecheck, unit tests and a production build.
  Once automatic deploys are on, nothing deploys unless the whole CI workflow
  passed on `main`; until then the owner deploys by hand from a green `main`.
- Dependabot opens weekly dependency updates, and GitHub raises security
  updates regardless.
- Rules and hosting deploy in one command, so the app and the rules it was
  tested against go live together.

## Deployment notes for the owner

The one thing that is easy to get wrong: **deploy the rules**. A Firestore
database left in test mode lets anyone who knows the project id read and write
everything, which for this app means reading other people's orders and writing
their own at any price. The automatic deploy (not switched on yet) includes the rules; by hand, which
is how it is done today, it is:

```bash
npm run build && firebase deploy --only firestore:rules,hosting
```

Add `firestore:indexes` to `--only` when `firestore.indexes.json` changes; the
automatic deploy does not deploy indexes.

To confirm the rules took effect, open **Firestore → Rules** in the Firebase
console for `toi-cafe` and check they match `firestore.rules` on `main`, with
the latest publish time matching the deploy.
