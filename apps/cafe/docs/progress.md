# Progress

Where the project stands, what is in flight, and what is waiting on a decision.
Updated as work lands, so a fresh contributor — or a fresh session — can pick up
from here without reading the git log.

_Last updated: 2026-09-30_

## Live

**https://toe-cafe.web.app** — the `toe-cafe` Hosting site in the Firebase
project `toi-cafe`. The project's original site, **https://toi-cafe.web.app**,
now only redirects: every path, query string included, goes to the same path on
toe-cafe.web.app, so old bookmarks and any QR card printed with the old address
still land on the right table. See [decisions](./decisions.md#a-second-hosting-site-not-a-new-project)
for why it is a second site rather than a rename.

`main` is live: **v0.3.0** (see the [changelog](../CHANGELOG.md)), last deployed on 2026-09-30 by hand with
`firebase deploy --only firestore,hosting:app`. The automatic deploy workflow
exists but is not switched on yet (its secret and variables are not set).

### What has been checked live, and how

- **v0.2.0, as a customer and a signed-out visitor** — 2026-09-28, at phone
  width on the live site:
  - Order on Table 6 → confirmation with live status; no console or permission
    errors; `sw.js` carries the stamped cache version
  - A second order within 30 s is refused with a countdown; after 30 s it goes
    through (#32)
  - `meta/counters` cannot be read or written; an order carrying its own
    number, or skipping the throttle stamp, is refused; signed-out and
    anonymous visitors cannot list orders or read another customer's (#30)
  - `/staff` and `/admin` show only sign-in screens when signed out
- **Everything since v0.2.0** — each change was checked in a demo-mode build by
  a separate tester before it was merged and deployed. After each deploy the
  live site was checked with `curl`: every route answers 200, pages and router
  data (`/admin`, `/admin.txt`) carry `Cache-Control: no-cache`, `sw.js`
  carries the new build's cache version, and toi-cafe.web.app answers 302 to
  the same path on toe-cafe.web.app.
- **`config/tables`** — an anonymous write is refused on the live project.

**Not checked live by the team's testers:** the staff board and the owner
screens signed in — the Orders | Owner switch, the owner landing on the
dashboard after sign-in, the new menu screen, the table list on _/admin/qr_,
the total-mismatch flag and the no-role message. The testers have no staff or
owner login. The cafe's own account now has the owner role and the owner is
using these screens; report anything odd as an issue.

v0.1.0 was verified end to end on the live site on 2026-09-27: customer order
to confirmation with live status, staff board receiving orders in ~2 s, owner
menu edits, reports and QR codes, and no cross-customer reads.

Baristas each need an account and a role document:
`npm run seed:staff -- --email=… --role=staff` — see the README.

## In flight

Work is built on a branch, checked by a separate tester, and only then merged
to `main`. Branches are pushed to GitHub as they go, so nothing lives only on
one machine.

| Branch         | Covers           | State                                                                                               |
| -------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `feat/stage-2` | UPI pay-at-table | Built, mostly uncommitted in a worktree (one pushed commit, a QR fix). Waiting on the cafe's UPI ID |

## Next

**v0.3.0 is the current finished version.** New work goes into the next
version, tracked as GitHub issues rather than here:

- [**v0.4.0**](https://github.com/shreyashp47/TOE/milestone/1) — fits the free
  plan: UPI pay-at-table (#36, needs the cafe's UPI ID), checking the table
  cards with real phones (#37), report print/PDF (#38), keeping the staff
  screen awake (#39), automatic deploys (#40), dependency upgrades (#34), and
  small fixes (#41–#44)
- [**Needs Blaze plan**](https://github.com/shreyashp47/TOE/milestone/2) — push
  notifications (#45), monthly report email (#46), dish photos (#47), App Check
  (#48), automatic retention (#49), server-side order totals (#27)

## Waiting on the owner

- **Approve new tables: on or off.** Off by default, so nothing changes until
  the owner switches it on at the top of the dashboard. It only really protects
  tables once table codes exist (below). With it on, the counter must watch the
  board's **New guests** section.
- **Turn on the table codes.** Deployed, but they protect nothing until the
  owner signs in, opens _Table QR codes_, presses **Create codes for all
  tables**, and replaces every card on the tables with a freshly printed one —
  at once, because the old cards stop working the moment codes exist.
- **UPI ID** for the cafe. Without it the payment screen ships switched off.
- **Blaze plan: yes or no.** Needed for the full fixes to #27 and #32, automatic
  order retention (#31), push notifications with the screen off, emailed
  monthly reports, and dish photos (new Storage buckets need Blaze). Everything
  else stays on the free tier.
- **The deploy secret** — a service-account key for `toi-cafe`, for
  `FIREBASE_SERVICE_ACCOUNT` above.
- **Go-ahead to delete the merged `wip/*` branches** on GitHub. Every one of
  them has landed on `main` (`wip/app-fixes` and `wip/rules-security` as
  reworked commits).

Issues #29, #30, #31, #32 and #33 are already closed on GitHub.

## Test data on the live site

Four test orders on Table 6 (#102–#105, ₹960 total) are completed and **count
in the September 2026 report**. Three older orders (Table 3 #101 and #102,
Table 5 #101) were still open at the time of testing; two share #101 because the
old counter had been reset. Those keep their stored numbers. Orders placed since
v0.2.0 use a 3-digit number derived from the order id, which is not unique —
use the table, or the _Order ID_ column in the CSV, to tell orders apart.

Three more test orders on Table 6 from the 2026-09-28 live test (#826, #315,
#156; one Cappuccino each, ₹540 total) are still _preparing_ unless the owner
has since cleared them. Complete or delete them from the owner account before
relying on the September report.

## Done

- 2026-09-30 — **v0.3.0** tagged and live. QR codes of version 7 and up now
  scan (needed for UPI links)
- 2026-09-30 — The first tap on a freshly opened staff board acts (the sound
  hint no longer shifts the board under the finger, at any text size), and
  _Order sound on_ shows only once sound really plays
- 2026-09-30 — **Approve new tables**, off by default, on the owner dashboard:
  with it on, a table's first order waits for staff to Accept, then the table
  is open for 3 hours. Enforced by the rules; 243 rules tests plus 49
  adversarial ones by the tester
- 2026-09-30 — Table codes last 3 hours on the phone and leave the address bar
- 2026-09-30 — Daily order numbers (#0001 each day) deployed with their rules
- 2026-09-28 — Table codes in the QR cards, order caps (20 lines, 20 of an item,
  ₹10,000) and a staff **Reject** with a reason; security-tested with 109
  bypass attempts against the rules, then deployed with the rules
- 2026-09-28 — Order history for the owner at _History_ (`/admin/orders`)
- 2026-09-28 — Owner menu screen redesigned: compact rows with a one-tap
  Available / Sold out switch, and an editor per item
- 2026-09-28 — The − 1 + stepper fits inside the menu card on two-column phones;
  every `rounded-pill` control is round again
- 2026-09-28 — The app moved to toe-cafe.web.app; toi-cafe.web.app redirects
- 2026-09-28 — Owner links no longer land on raw text at `/admin.txt` (pages and
  router data served `no-cache`, service worker fetches router data
  network-first)
- 2026-09-28 — The owner lands on the dashboard after signing in, and moves
  between board and dashboard with an Orders | Owner switch
- 2026-09-28 — The owner sets the cafe's tables on _/admin/qr_, saved in
  `config/tables`
- 2026-09-28 — The owner can pick or type a new category when adding an item
- 2026-09-28 — Deploy workflow added (not yet switched on, see _Next_)
- 2026-09-28 — v0.2.0 live: #29 #30 #32 #33 closed; #27 detection shipped, #31
  owner-run cleanup
- 2026-09-27 — Staff and owner screens live; README updated (#28 closed)
