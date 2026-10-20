# Changelog

Notable changes to this project. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Work that is built but not yet merged is tracked in
[docs/progress.md](./docs/progress.md).

## [Unreleased]

## [0.3.0] — 2026-09-30

The owner's release: order history, a redesigned menu screen, the cafe's own
table list, daily order numbers, table codes on the QR cards and **Approve new
tables**, plus the move to toe-cafe.web.app.

### Upgrading

- Deploy rules and hosting together:
  `firebase deploy --only firestore,hosting:app`
- Nothing changes for customers until the owner acts. **Approve new tables** is
  off by default, and table codes protect nothing until the owner presses
  **Create codes for all tables** on _/admin/qr_ and reprints every card

### Added

- Daily order numbers: every day starts again at **#0001** (midnight India
  time) and counts up in arrival order, shown on the staff board, the
  customer's live status, History (searchable as `#0007`, `0007` or `7`),
  Reports and the CSV. The staff board assigns them, in a transaction on a
  staff-only `dayCounters/{YYYY-MM-DD}` document that the rules check, so no
  number is handed out twice even with two boards open; nothing a customer can
  write is involved (issue #30). The customer sees "number coming…" until then.
  Older orders keep their three-digit number
- A _Placed (IST)_ column in the orders CSV, beside the UTC _Placed at_, so the
  date an order's day number counts in is readable without converting
- **Approve new tables** (staff confirm new guests), a switch near the top of
  the owner dashboard (_/admin_), **off by default**: with it off every order
  goes straight to the kitchen, as before. With it on, a table's first order
  waits as _Waiting for
  the counter_ (`pending`) in a **New guests — check the table** section at the
  top of the staff board, with a chime. **Accept** sends it to the kitchen and
  opens the table (`tableSessions/{n}`), so the group's next orders skip the
  wait; **Reject** suggests _No one at this table_. Tables close by themselves
  3 hours after staff last accepted or moved on one of their orders, or with
  **Close** in the board's new **Open tables** strip. The customer's phone
  says _"Waiting for the counter to confirm your table"_ and moves on by
  itself. While it is on, the rules only take a straight-to-the-kitchen order
  from an open table. Stored in `config/ordering`; a missing document means
  off. Accept takes every waiting order from that table at once; **Close** asks
  first; only staff can list which tables are open. Waiting orders are left out of report revenue, and get their day number
  only once accepted, so a turned-away order never uses one up

- A secret code per table, carried in its QR card (`/order?table=N&k=CODE`)
  and checked by the order rules, so an order can no longer be placed from
  anywhere by typing the address. The owner turns it on with **Create codes for
  all tables** on _/admin/qr_ and reprints the cards; **New code** renews one
  table's card. Tables without a code keep taking orders as before
- **Reject** on the staff board for a _Preparing_ or _Ready_ order, confirmed
  on the ticket with an optional quick reason. The customer's phone says the
  counter couldn't accept it, and rejected orders are left out of report
  revenue (they stay in the CSV, with the reason)
- _History_ (`/admin/orders`) for the owner: past orders for Today, Yesterday,
  the last 7 days, this month or any range up to 31 days, filterable by status
  and table, searchable by order number or item, each row expanding to its
  items, times, payment and order ID, with Refresh and a CSV of the filtered
  view. One capped query per look (at most 1,000 orders) keeps it inside the
  free tier
- The owner sets the cafe's tables on _/admin/qr_: a number of tables with −/+,
  or typed-out numbers with ranges (`1-8, 12, 14`). The list is saved to
  `config/tables`, and the customer's table picker, the check on a scanned table
  number and the printed QR cards all follow it live
- A labelled **Orders | Owner** switch in the header, shown only to the owner,
  to move between the order board and the owner dashboard. It replaces an
  unlabelled chart icon (and a cart icon back). Baristas see no change
- A one-tap **Available / Sold out** switch on every item of the owner's menu
  screen, and a labelled **Show to customers** switch for today's special,
  which says when a change is not live until saved
- Automatic deploys (`.github/workflows/deploy.yml`): once its secret and
  variables are set, every push to `main` that passes CI deploys the rules and
  hosting together to `toi-cafe`, never over a newer commit, then checks the
  live site serves the new build

### Changed

- A scanned table code now lasts 3 hours on the phone (scanning again restarts
  it) and is taken out of the address bar at once, so it is never left in
  history, bookmarks or a shared confirmation link. After that the menu asks
  the customer to scan again before they build a basket
- `/order` without a usable table asks the customer to scan the QR code on
  their table instead of offering a grid of table numbers, which could not
  carry a table's code
- Orders are capped at 20 different items, 20 of each and ₹10,000 (was
  ₹1,00,000), in the rules and with a plain message at checkout
- The app now lives at <https://toe-cafe.web.app>, a second Hosting site in the
  same `toi-cafe` project, since a project id cannot be renamed. The old
  address redirects every path there, query string included, so old links and
  QR codes keep working
- The owner goes straight to the owner dashboard after signing in on `/staff`.
  Opening `/staff` while already signed in, which is where the switch's
  _Orders_ side goes, still shows the order board
- The owner's menu screen (_/admin_) is a list of compact rows grouped by
  category; tapping a row opens its edit form (Save, Cancel, Delete) for that
  one item. A summary line and category shortcuts sit at the top, and _Add
  item_ opens the add form on demand and confirms each item added. The
  decorative feature tiles are gone. At 390px the page went from about 6,800px
  tall to about 1,900px
- The category box in the add-item form is a list of the menu's categories with
  a _New category…_ choice, as the edit form already had
- The − 1 + control on the menu cards and in the cart is one joined pill, with
  the same 44px buttons
- `/order` waits for the saved table list before judging a scanned table
  number, so a valid QR code is never briefly shown "that table number looks
  odd". If the list cannot be loaded it uses the default
- `NEXT_PUBLIC_TABLES` is now only the default until the owner saves a list, and
  ignores numbers above 50, which the order rules have always refused
- Pages and their router data are served `no-cache` (revalidated on every load,
  a 304 when unchanged) instead of cached for an hour, and the service worker
  fetches router data network-first

### Fixed

- QR codes of version 7 and up (111 bytes or more) never scanned: the encoder
  did not write the version information those versions require. Table cards
  (version 3–4) were never affected; a UPI payment link would have been
- The first tap on a freshly opened staff board did nothing: it switched the
  order sound on and removed the _Tap anywhere to switch the order sound on_
  line, which moved the board up under the finger, so that first **Accept** or
  **Mark ready** was lost. The line now keeps the same height at any text size
  and reads _Order sound on._ once the sound is on
- The staff board could say the order sound was on while the browser still
  blocked it (in Chrome a touch press alone does not unlock audio). It now
  tries again on release and click, and says so only once sound can play
- Tapping between owner screens after a deploy could land on raw text at
  `/admin.txt`. A tab already stranded on a `.txt` address is sent back to its
  page
- Adding an item, the category box snapped back to the first category on every
  keystroke, so an item could not be put in another category or a new one
- A new item could be filed under a category that had just left the menu,
  bringing the old section back
- Every pill-shaped control (buttons, chips, badges, toggles) rendered square:
  `rounded-pill` had no matching theme token
- The owner's availability toggle had its knob outside its track, covering the
  first letter of its label
- On a two-column phone menu (380–419px wide) the − 1 + control spilled out of
  the item card and cut off the + button

### Security

- `config/tables` is owner-write only and shape-checked in the rules: only a
  `tables` field, a list of 1–50 entries whose first and last are whole numbers
  1–50. The app drops any other bad entry when it reads the list. Other
  `config` documents are unchanged

## [0.2.0] — 2026-09-28

Closes the two open holes in the rules, and fixes the service-worker cache, the
setup of staff accounts and the dead _Complete_ button. Deployed to
<https://toi-cafe.web.app> on 2026-09-28, rules and hosting together.

### Upgrading

- **Deploy rules and hosting together**, in one `firebase deploy`, at a quiet
  time. The shape of an order write changed: the old app against the new rules,
  or the reverse, refuses every order.
- **Reload the staff board** on the counter phone, and any open customer pages.
  An old board shows new orders as #0. From now on the app offers a _Reload_ bar
  when a new version is ready.
- **Order numbers are now 3 digits and not unique.** They are what a barista says
  out loud; the table is what tells two orders apart. Orders placed before this
  release keep their old number. The report CSV gains an _Order ID_ column — group
  by that, not by _Order #_.

### Added

- The staff board flags an order whose total does not match its lines or the
  current menu — "Total doesn't match menu — check before charging" — and
  _/admin/reports_ lists such orders
  ([#27](https://github.com/shreyashp47/TOE/issues/27))
- A signed-in account with no role gets a "your account isn't set up yet" screen
  with the exact command to fix it, and `npm run seed:staff` creates a staff or
  owner account and its role document in one command
  ([#33](https://github.com/shreyashp47/TOE/issues/33))
- `npm run cleanup:orders` counts orders older than six months, and deletes them
  with `--confirm`; it refuses any cutoff under six months
  ([#31](https://github.com/shreyashp47/TOE/issues/31))
- A _Reload_ bar when a new version of the app is ready, instead of a silent
  reload that would disarm the order chime
- An _Order ID_ column in the report CSV
- `docs/progress.md` — what is live, what is in flight, and what is waiting on a
  decision
- This changelog, issue and pull request templates

### Changed

- The order number is derived from the order's id (100–999) rather than taken
  from a shared counter ([#30](https://github.com/shreyashp47/TOE/issues/30))
- An order is written as one two-document batch with the customer's throttle
  stamp, instead of a read-then-write transaction
- The role is read from `/staff/{uid}` on every sign-in change, the same way the
  rules read it, instead of a cached guess that defaulted to staff
- Dependabot no longer opens a pull request per major version; majors are
  upgraded deliberately, one at a time. Security updates still arrive

### Fixed

- The service worker's cache version is stamped per build, so old caches are
  actually cleared ([#29](https://github.com/shreyashp47/TOE/issues/29))
- _Complete_ on a _Ready_ ticket did nothing; _Ready_ now offers only _Mark
  served_, and a failed status change says so on the ticket
- Firestore refusals showed customers the raw "Missing or insufficient
  permissions"; sign-in errors showed Firebase's developer text
- The "wait before ordering again" message no longer misjudges a phone whose
  clock disagrees with the server's
- The rules test suite counted any error as a denial; it now only counts
  `permission-denied`
- Docs no longer claim the rules recompute the order total, or that an order
  costs no reads
- `npm run preview` works (it called `serve`, which was not installed), and
  `npm run flow` and `npm run audit`, which the README described, exist

### Security

- Nobody can write the order counter any more; `/meta` is denied to everyone
  ([#30](https://github.com/shreyashp47/TOE/issues/30))
- Order creation is throttled in the rules to one per customer every 30 seconds
  ([#32](https://github.com/shreyashp47/TOE/issues/32)). A script that signs in
  afresh for each order is slowed only by Firebase Auth's limit on new accounts;
  App Check is the Blaze-plan follow-up

### Known issues

- The order total is still supplied by the customer's phone. The staff board now
  detects a mismatch, but preventing it needs a Cloud Function and so the Blaze
  plan ([#27](https://github.com/shreyashp47/TOE/issues/27))
- Six-month retention is an owner-run command, not automatic; a TTL policy or
  scheduled function needs Blaze
  ([#31](https://github.com/shreyashp47/TOE/issues/31))

## [0.1.0] — 2026-09-27

First version live on Firebase Hosting at <https://toi-cafe.web.app>, with the
customer, staff and owner flows verified end to end on the live site.

### Added

- Customer ordering from a table QR code: menu with category rail, cart sheet,
  order confirmation and a live status timeline — no app, no account
- Staff order board with live arrival, status actions and a new-order chime
- Owner menu management, monthly and date-range reports with CSV export, and
  printable per-table QR cards
- Zero-config demo mode backed by `localStorage`, live across browser tabs
- Installable PWA with an offline page
- Firestore security rules with an emulator test suite
- CI: lint, typecheck, unit tests, build, a self-check that proves the tests fail
  on a broken money rule, and a WCAG AA audit in Chromium and WebKit

### Fixed

- Customers can read back their own order through an anonymous sign-in, without
  opening the order book to everyone else
- The staff board no longer refuses its own status updates
- Tapping a table number opens the menu
- A dropped chunk request on flaky Wi-Fi no longer kills the page

### Known issues

- The order total is supplied by the customer's phone
  ([#27](https://github.com/shreyashp47/TOE/issues/27))
- The order counter is publicly writable
  ([#30](https://github.com/shreyashp47/TOE/issues/30))
- _Complete_ on a _Ready_ ticket does nothing

[Unreleased]: https://github.com/shreyashp47/TOE/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/shreyashp47/TOE/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/shreyashp47/TOE/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/shreyashp47/TOE/releases/tag/v0.1.0
