# Design decisions

The two spec documents ([`requirements.md`](./requirements.md) and
[`anime-theme.md`](./anime-theme.md)) each ended with open questions. This file
records the answers and the reasoning, so the "why" survives the handoff instead
of living in someone's head.

## 1. The three open questions in `requirements.md` §11

### "Should customers see live order status updates on their own screen, or just a confirmation?"

**Decision: yes, live.**

A customer's real question after ordering is _"is it coming?"_. A static
confirmation number makes them either ask the counter or get up and look, both of
which cost the cafe a staff interaction per table. Listening to their own order
document costs one Firestore read per open screen and removes that interaction
entirely.

Implemented at `/order/confirmation` via `onSnapshot` on the single order — not a
polling loop, and not a subscription to the whole orders collection, so a busy
service does not multiply a customer's read cost.

> Requirements §5.3 only _required_ the live listener for staff, but §4.1 step 6
> promised customers "live status: Received → Preparing → Ready/Served". This
> resolves that in favour of the customer-facing promise.

### "Single staff login shared across employees, or individual accounts?"

**Decision: individual accounts, with a shared-PIN convenience in demo mode only.**

Firestore rules can only enforce "this person may update orders" if there _is_ a
person. A shared login means a leaked password gives anyone write access to every
order and no way to attribute a mistake.

The compromise: `Firebase Authentication` email + password per employee, with the
role read from `/staff/{uid}` (the shape §8 already anticipates, marked "Phase 2
if role-based access needed" — it turned out to be needed immediately, because
menu management in §5.1 requires an owner role). A 4-digit PIN is available in
demo mode only, for a single counter phone in a rush; with real Firebase
configured, PIN sign-in is refused rather than quietly falling back to something
weaker.

### "Payment: pay-at-counter only for v1, or include UPI QR/payment link from day one?"

**Decision: pay-at-counter for v1, as §9 already scopes it.**

UPI deep links need either a PSP integration (a merchant account, a compliance
review, and a per-order reconciliation) or a static UPI QR on the table — and the
static QR is really a _feature request for the printed table card_, not a payment
gateway. That is cheap and worth doing in Phase 2 by printing a UPI block on the
back of the same tent card that `/admin/qr` already produces.

What v1 does include: `paymentMethod` on the order document, `upi` accepted as a
value, so enabling it later is a UI change and not a migration.

## 2. Deciding questions the specs left open

### Demo mode vs. "no app installs"

§2 asks for zero/low infrastructure cost and §3 for no installs, but a Firebase
project is still required to _use_ the product. Rather than shipping a system
nobody can see until they sign up for a cloud account, the app ships with a second
storage backend.

`src/lib/data/` defines the contracts (`MenuRepository`, `OrderRepository`,
`AuthRepository`, `ConfigRepository`) with two implementations:

|               | `demo/`                             | `firestore/`       |
| ------------- | ----------------------------------- | ------------------ |
| backing store | `localStorage` + `BroadcastChannel` | Firestore          |
| live updates  | cross-tab sync                      | `onSnapshot`       |
| auth          | fixed demo accounts                 | Firebase Auth      |
| loaded        | statically                          | dynamic `import()` |

Because the Firestore module is behind a dynamic import and the demo path is the
default, **a demo-mode visitor never downloads the Firebase SDK at all** — the
production first-load bundle is ~103 kB. Switching to Firestore is six env vars
and no code change.

The demo backend is not a stub. It is genuinely live across tabs, so a customer
phone and a staff phone opened side by side on one laptop behave exactly like the
real thing, and `scripts/flow.mjs` uses that property to walk the whole loop in
CI.

### The status machine

§5.3 specifies `preparing` → `completed`, "extendable to `ready`, `served` later",
while §4.1 promises customers `Received → Preparing → Ready/Served`. Those cannot
both be the whole truth, so the app takes the extension and defines one explicit
machine:

```
received → preparing → ready → served → completed
```

in [`src/lib/order-status.ts`](../src/lib/order-status.ts). Transitions are
forward-only and single-step, enforced in three independent places:

1. `transition()` in the app, so the UI cannot offer an illegal move;
2. `firestore.rules`, which enumerates the legal next status explicitly from the
   stored document rather than trusting the client;
3. the test suite, which walks the whole chain and asserts each hop.

`completed` is terminal and immutable. That is what satisfies §5.3's "keeps it in
the database for history — not deleted", and it is why completed orders still
appear in reports after they leave the staff board. It is **not** what satisfies
§5.4's six months; see [Order retention](#order-retention-is-an-operational-practice-not-a-feature)
below — an earlier version of this file claimed it was.

### Order totals: checked in the app, bounded in the rules, and not re-derived

Customers are unauthenticated (§3), so the phone sending the order is untrusted.
Two independent defences:

- **Client**, before writing: `priceCart()` in [`src/lib/money.ts`](../src/lib/money.ts)
  re-prices the basket against the live menu. A sold-out or deleted item is
  rejected outright; a price change is applied and shown, not blocked, because
  stranding a customer mid-checkout over ₹30 is worse than charging the current
  price. Totals are integer rupees — the cafe has no paise, and float sums on a
  menu are a rounding bug waiting to happen.
- **Server**, in `firestore.rules`: the `create` rule pins `status` to
  `preparing`, requires `createdAt == request.time` so a phone cannot backdate an
  order out of a reporting month, restricts the document to an exact field set so
  nothing extra can be injected, and requires `total` to be a bounded integer.

**The gap, stated plainly:** the rules cannot recompute the total. Firestore rules
have no loops, no lambdas and no `reduce`, so there is no way to sum a
variable-length basket in a rule, and an earlier version of this file claimed
otherwise. A customer with devtools can post `total: 1` for a real basket, and the
order will be accepted at that figure. `priceCart()` protects the honest path, not
the adversarial one.

The fix is a trusted backend, not a cleverer rule: a Firestore-triggered function
that rewrites `total` from the stored lines. That needs the Blaze plan, though
Cloud Functions 2nd gen includes 2M invocations/month free, which is far more than
a cafe uses — so it is affordable, just not free to enable. It remains open as
issue #27.

**What the free tier does instead: detection at the counter, not prevention.**
[`src/lib/order-integrity.ts`](../src/lib/order-integrity.ts) re-derives an order
from what is stored, and the staff board runs it on every ticket against the live
menu:

- `total` against the sum of the stored lines. The honest client always writes
  exactly that sum, so a mismatch has no innocent explanation.
- each line's unit price and name against the menu item it points at, and any
  line whose item is not on the menu at all.

A ticket that fails gets a red _"Total doesn't match menu — check before
charging"_ box listing what is wrong, the stored total struck through, and the
basket priced at today's menu — the figure to charge. Nothing is rewritten; the
forged order stays in the database as it was sent.

Why compare against the _current_ menu when lines deliberately store the price at
order time? Because the stored line price is exactly as untrusted as the total:
a forger who lowers both, consistently, passes the first check. The menu is the
only trusted price source the browser has. The cost is a false positive when the
owner edits a price while an order is on the board; that window is minutes, and
the message names both prices so the barista can tell a price change from a
forgery. Blocking or auto-correcting would be wrong for the same reason.

`/admin/reports` already adds revenue up from the line items, not the stored
totals, so a forged `total` alone does not move the figures. It lists any order
in the period whose total disagrees with its own items — the ones the counter may
have charged wrongly — and, as a softer hint, orders whose items differ from
today's menu, which for old orders is usually just a price change since. Until
the Blaze fix, reconcile those against the till.

`scripts/rules-test.mjs` pins the behaviour that _is_ enforceable: 81 assertions
covering the anonymous customer, a signed-out caller, a signed-in barista and a
signed-in owner, including that a barista cannot touch the menu and cannot skip a
status.

### Order volume: a per-customer throttle in the rules, App Check later

Creating an order is the one write the public can make, and until issue #32 it
was unbounded. The create rule stopped forged statuses, injected fields and
backdating, but nothing stopped a loop: a script could fill the staff board with
junk a barista has to clear by hand, bury a real order in it, and burn the
free-tier write quota doing so.

The purpose-built answer is Firebase App Check, and it needs the Blaze plan. So
does anything with Cloud Functions. The constraint here is the free tier.

**Decision: throttle per anonymous uid, in `firestore.rules`, at one order per
30 seconds.**

Every customer already holds an anonymous uid (that is how they read their own
order back), so there is something to hang a limit on. Each order is written in
one batch with `/orderThrottle/{uid}`:

- the order rule requires, via `getAfter()`, that the same commit stamps that
  document with `lastOrderAt == request.time` and `lastOrderId ==` this order's
  id. The id match is what makes one stamp buy exactly one order — a batch cannot
  stamp once and write 499 orders beside it;
- the throttle rule refuses to rewrite the stamp until
  `resource.data.lastOrderAt + duration.value(30, 's')`, and refuses deletes, so
  the clock cannot be reset;
- a first order has no document yet, so it is a create with nothing to wait for.

No loops and no lambdas are needed — it is two document lookups and a timestamp
comparison — so it stays inside what the rules language can actually do (issue
#27 is the reminder of what happens otherwise).

Why 30 seconds: long enough that a loop gets two orders a minute rather than
thousands, short enough that a customer who forgot the sugar is not stuck. The
phone keeps its own note of when it last ordered
([`src/lib/order-throttle.ts`](../src/lib/order-throttle.ts)) and tells the
customer how long to wait _before_ sending, so the honest path never sees the
server's bare "permission-denied". If the server refuses anyway (cleared storage,
a clock that disagrees), the adapter reads the customer's own stamp once to tell a
throttle apart from any other refusal. Demo mode runs the same client-side check.

The client write went from a read-then-write transaction (for the old counter) to
a blind two-document batch. That does not make it free of reads: the `getAfter()`
in the order rule is billed as a document read, so an order costs two writes and
one read — the same read count as before, spent on the limit instead of the
counter. A refused order costs one more read, when the phone checks its own stamp
to word the message.

**The gap, stated plainly:** the limit is per uid, and a script can sign in
anonymously again for every order. Firebase Auth rate-limits new accounts per IP
address, which slows that down, but it is not a per-device limit. App Check is
the fix, when the cafe moves to Blaze; the throttle stays as a second layer and
does not need to change.

### Order numbers are derived from the document id, not counted

The first version allocated `#101, #102, …` from a `/meta/counters` document in a
transaction on the customer's phone. For the phone to bump it, the document had
to be writable by the public, and the rule said so with a comment calling the
blast radius "cosmetic". It was not quite: anyone could reset the counter so two
orders shared a number, push it to 999999, or loop on it to burn the free-tier
write quota. And every order paid a read for a number that is only decorative
(issue #30).

**Decision: derive the number from the order's document id, on read.**

`displayNumberFromId()` in [`src/lib/order-number.ts`](../src/lib/order-number.ts)
is an FNV-1a hash of the id folded into 100–999. Firestore auto ids are random, so
the number is effectively random too, and every device computes the same one
without talking to anybody. Nothing is written, there is no shared state, and
`/meta` is now denied to everyone.

What it gives up is uniqueness. Three digits over a day's orders will repeat. The
alternatives were worse: a sequence needs a shared writable counter, which is the
bug; a longer number (four digits, or letters from the id) is harder to say
across a counter; a server-assigned sequence needs Cloud Functions, which needs
Blaze. So the number is never shown alone — the board and the confirmation screen
both lead with the table, and a clash that matters (same table, both open) is
roughly 1 in 900 per pair. Across the whole board it is much likelier that _some_
two orders share a number — about 19% with 20 orders open — which is exactly why
the table, not the number, is what tells them apart.

Orders placed under the counter keep their stored `orderNumber`, so old receipts
and exported reports do not renumber. The demo store does the same derivation, so
the demo no longer promises sequential numbers the real backend does not give.

### Superseded: daily numbers, assigned by the staff board

The owner asked for "every day the order should start with #0001". The derived
number above cannot do that, and the objection to a counter was never to
counting — it was to **customers** writing the counter. So the counter came
back, with the writer changed.

**Decision: the staff board numbers each order, #0001 upwards per IST day, in a
transaction on a staff-only counter.**

- `dayCounters/{YYYY-MM-DD}` holds `{ next, last }`. Only a staff or owner
  account can read or write it; customers and signed-out callers are refused.
  It can only be created at 2 (the day's first order took 1), only step up by
  one, and never be deleted, so the day's numbers can never be handed out
  twice.
- `last` is the id of the order the bump is for. The first version checked
  each numbered order against the counter on its own, so one commit could
  number **two** orders #5 against a single bump (an independent tester found
  it). Now the order rule requires the counter to name that order, and the
  counter rule requires the named order to be unnumbered before the commit and
  numbered `next - 1` for this day after it. One bump, one order. That also
  means the counter can no longer be bumped by hand to leave a gap: every
  counter write is a numbering.
- The board (`src/lib/day-number.ts`) sees an order with no `dayNumber` and, in
  one transaction, re-reads the order, reads the counter, writes `dayNumber` and
  `dayKey` on the order and `next + 1` on the counter. The rules accept the
  order update only as its own update (never mixed with a status change), only
  when the order has no number yet, only for a whole number 1–9999, and only if
  it equals the counter's `next` before the commit and the counter is `next + 1`
  after it (`get` / `getAfter`). Two boards that race: one commits; the other
  is retried or refused, re-reads the order, finds it numbered and stops.
- The day is the IST date of the order's **own createdAt**, which the rules
  recompute (`createdAt + 5h30m`, read as a UTC date; India has no daylight
  saving). So a board with a wrong clock cannot file an order under another
  day, and an order placed at 23:59:59 is numbered in that day's sequence even
  if the board gets to it after midnight.
- The board does it one order at a time, oldest first, so numbers follow
  arrival; it backs off when a transaction fails and stops (with a note on the
  board) after repeated permission refusals rather than looping on them.

**Why this is safe where `/meta/counters` was not:** nobody on the internet can
touch this counter. The worst a staff account can do is use numbers up
faster than orders arrive (numbering hand-made or rejected orders in a loop),
which can exhaust a day's 9,999 — the cafe keeps working on the older number
until the next day. Staff are trusted with the board; see SECURITY.md.

**What it costs:**

- **A board must be open.** Numbers are handed out by the board, not by the
  customer's phone and not by a server (Cloud Functions need Blaze). An order
  that arrives while no board is open waits for one; the customer's screen says
  "number coming…" and, after 45 seconds, just "the counter has it" — it never
  shows a stand-in number that would later change. If numbering stops on the
  board, the ticket shows the older three-digit number instead.
- **Per order:** one more transaction — two document reads (the order and the
  counter) plus the rules' own read of the counter, and two writes. At the free
  tier's 20,000 writes and 50,000 reads a day that is negligible for a cafe.
- **Gaps.** A rejected order keeps its number. So does an order numbered by a
  board and then deleted by the owner. Gaps are harmless; duplicates would not
  be.
- **9,999 a day.** After that, orders simply stay unnumbered for the day.

Older orders keep what they showed: a stored `orderNumber` from the original
counter, else the derived three-digit number. `orderLabel()` picks, in that
order, day number, stored, derived.

### Order retention is an operational practice, not a feature

§5.4 says "all orders retained (no auto-deletion) — target minimum 6 months,
extendable". Read carefully, that is a **floor**: keep at least six months. The
app meets the floor trivially, because nothing in it ever deletes an order — the
rules only let an owner delete, and no screen does.

What it does not have is a ceiling. Nothing removes old orders, so the collection
grows forever. The automatic way to bound it is a Firestore TTL policy on an
`expiresAt` field, which needs the Blaze plan; a scheduled Cloud Function needs
it too. So, decided explicitly rather than left implied:

- **Retention is an owner's operational practice.** The owner decides when old
  orders go, and does it with a command:

  ```bash
  npm run cleanup:orders                          # dry run: count orders over 6 months old
  npm run cleanup:orders -- --older-than=1y --confirm
  ```

  It is a dry run unless given `--confirm`, and it **refuses any cutoff younger
  than six months**, so it cannot be used to break the floor §5.4 sets. It runs
  as the owner's `firebase login` (the same approach as `seed:staff`, see
  README §3), deletes oldest-first in batches, and counts with an aggregation
  query so a dry run costs about one read per thousand orders.

- **Doing nothing is also fine.** A busy cafe here produces ~36k orders a year,
  which Firestore does not notice, and `/admin/reports` only ever reads a
  bounded date range, so old orders cost storage, not reads. Run the cleanup
  when there is a reason to, not on a schedule.
- **Deleted orders leave the reports too.** Export the months you want to keep
  from `/admin/reports` (CSV) before running it with `--confirm`.

If the project ever moves to Blaze, a TTL policy on `createdAt + N months`
replaces the command: Firestore deletes within about a day of expiry, which is
precise enough for this.

### A hand-written QR encoder

§5.5 needs one static QR per table. A QR library is ~30 kB of JavaScript on the
page whose entire premise is loading fast on cafe wifi (theme doc §6), and the
payload is a ~45-character URL that fits comfortably in a small QR version.

[`src/lib/qr.ts`](../src/lib/qr.ts) implements ISO/IEC 18004 byte mode with
Reed–Solomon error correction and mask selection. Because a subtly wrong QR code
means printing ten cards that nobody can scan, the tests do not snapshot the
matrix — they **round-trip it through a real decoder** (`jsQR`) and assert the
original string comes back, for every table number the cafe is likely to have.

Scope is deliberately narrow and enforced: byte mode, ECC level M, versions 1–10.
Anything outside that throws rather than emitting an unscannable code.

### Reports are computed in the browser

§5.4 wants monthly revenue, order count, average order value, top sellers and
revenue by day. For 6–10 tables and ~100 orders/day, a month is a few hundred
documents — comfortably inside the Firestore free tier fetched once as a bounded
range query. Aggregating server-side (or adding Cloud Functions) would cost money
and buy nothing at this volume, and it would make the report page need its own
cold start. See `docs/decisions.md` §2 note on the free-tier ceiling in the
README.

The bar chart is CSS-only for the same reason the QR encoder is hand-written: no
charting library ships to the customer's phone.

### The mascot is original

Theme doc §4/§7 is explicit that the reference image's character is One Piece IP
and must not be reused. `src/components/Mascot.tsx` is a hand-authored SVG: big
round eyes, rosy cheeks, one ahoge, a terracotta scarf, a roasted-brown apron and
a coffee-bean hair clip. It is generated from the same markup into the PWA icon
set, so there is no binary art to keep in sync and no licence to track.

It is also a functional part of the UI, not decoration: it carries the loading
state, the empty state, the order confirmation and the sign-in gate, which is how
a chibi mascot earns its keep on a menu that must stay fast.

### Keeping the staff view boring

Theme doc §5 asks the staff board to be "more functional/less decorative", and
§7 warns against over-animating it. So the board has exactly one animation — a
three-flash border on a genuinely new order, paired with the chime and vibration
that §5.3 requires — and no mascot animation, no particles, and a small mascot
in the header only. Everything else is a card, a number, and a 44px button.

The wait timer turns amber at 4 minutes and berry red at 8, which is the only
"decoration" there is, and it is the thing a barista actually looks for.

## 3. Decisions made while running it

### The table list lives in Firestore, with the env var as the default

The table count started as `NEXT_PUBLIC_TABLES`, read at build time. Adding a
table meant a rebuild and a deploy, which is not something §2's "simple enough
for a small cafe owner" allows, and the old _/admin/qr_ box only changed the
printout, so a card could be printed for a table the order page did not know.

**Decision: the owner saves the list on _/admin/qr_ to `config/tables`
(`{ tables: [1, 2, …] }`); `NEXT_PUBLIC_TABLES` is only the default until then.**

- The customer's table picker, the check on a scanned `?table=N`, and the QR
  cards all read the same list, live (`useTables()` in
  [`DataProvider.tsx`](../src/components/providers/DataProvider.tsx)), so every
  printed card is a table a customer can order from. `/order` waits for the list
  before judging a scanned number, so a valid card for a table outside the
  default is never flashed as unknown; if the list cannot be read at all, the
  default is used.
- **The rules check its shape as far as the language allows.** Rules cannot
  loop, so they cannot check every entry. They check that `tables` is the only
  field, that it is a list of 1–50 entries, and that the first and last entries
  are whole numbers 1–50. The app always saves the list sorted, so for its own
  writes that bounds every entry. A hand-made write could still hide a bad
  value in the middle; `normalizeTables()` in
  [`src/lib/tables.ts`](../src/lib/tables.ts) drops it on read, and only the
  owner can write the document at all. The broader `config/{docId}` rule
  excludes `tables`, because matching rules are OR-ed and it would otherwise
  bypass these checks. Deleting the document puts the cafe back on the default.
- **50 is the ceiling everywhere** because the order rule has always refused a
  `tableNumber` outside 1–50; a table above that could be printed but never
  ordered from. The env default ignores numbers above 50 for the same reason.
- **The order rule does not check the list.** An order for table 12 in a
  10-table cafe is still accepted if it is in 1–50. Checking it would cost a
  `get()` — a billed read — on every order, to stop something that only a
  customer editing the URL can do and that the barista sees on the ticket.

### A second Hosting site, not a new project

The cafe is TOE Cafe, but Firebase gave the app `toi-cafe.web.app` from the
project id, and a project id can never be changed. A new project would have
meant moving the database, the accounts and the menu.

**Decision: a second Hosting site, `toe-cafe`, in the same `toi-cafe` project,
and the original site kept as a redirect.**

[`firebase.json`](../firebase.json) has two hosting targets, mapped in
`.firebaserc`: `app` (the app, on `toe-cafe`) and `legacy` (on `toi-cafe`), so
`firebase deploy --only hosting` deploys both. The legacy site serves only
redirects: every path, query string included, goes to the same path on
toe-cafe.web.app, so a QR card printed for `toi-cafe.web.app/order?table=3`
still lands on table 3. The redirect is a **302, not a 301**: browsers cache a
301 forever, and this should stay changeable. Same project means the same Firestore, Auth and rules; nothing
moved.

### Pages and router data are revalidated on every load

Firebase Hosting sends `max-age=3600` for anything without its own header,
pages included. Next's router fetches a page's data from `/page.txt` when a link
is tapped, and after a deploy a browser could hold `/admin` from one build and
`/admin.txt` from another for up to an hour. When those disagree, Next falls
back to a full navigation — to the `.txt` address — and the owner was left
looking at raw text on `/admin.txt`.

**Decision: `.html`, `.txt` and extensionless page paths are served
`Cache-Control: no-cache`.** The browser still keeps them, but asks first, and an
unchanged file costs a 304. Hashed files under `/_next/static/` stay cached for a
year, since their names change with their contents, and `sw.js` stays no-store.

### The service worker fetches router data network-first

The service worker had served same-origin assets stale-while-revalidate, `.txt`
included, which right after every deploy meant handing the new page the
previous build's router data — the same mismatch as above, from a different
cache.

**Decision: router data (`*.txt`) is network-first, falling back to the cache
only when offline**, like navigations. Icons and other assets stay
stale-while-revalidate. And any navigation to a `.txt` address is redirected to
its page by the service worker, so a tab already stranded on raw text recovers
on its next load. See [`public/sw.js`](../public/sw.js).

### The owner is sent to the dashboard only right after signing in

The owner signs in on `/staff`, like the baristas, and landed on the order board
without realising the owner screens existed. Two changes: a labelled
**Orders | Owner** switch in the header, shown only to the owner, and a redirect
to _/admin_ after sign-in.

**Decision: redirect only when the owner has just signed in on that screen, not
on every visit to `/staff`.** An owner who is already signed in and opens
`/staff` stays on the board. Redirecting every owner visit would make the order
board unreachable for the owner, including from the switch's _Orders_ side,
which links to `/staff`.

### Table codes in the QR card, not location or wifi

Anyone who had seen `/order?table=2` could order from anywhere. Orders are
pay-at-the-counter, so the harm is pranks and wasted food, not lost money — but
the owner saw it happen.

Rejected alternatives: **geolocation** needs a permission prompt, is easily
faked and fails indoors; **"on the cafe wifi"** cannot be checked from a static
site with no server; **App Check** needs the Blaze plan and stops scripts, not a
person typing a URL.

**Decision: a random code per table in `tableKeys/{n}`, owner-only, printed
into the QR card, and required by the order create rule when the table has
one.** Plus order size caps in the rules, and a staff **Reject** (a terminal
`rejected` status, left out of revenue) for whatever gets through.

- **Transition:** a table with no code document accepts orders without a code,
  so the deploy changes nothing until the owner presses _Create codes_ and puts
  out the new cards. Codes are then added automatically for new tables, but
  never switched on by a table-list save alone, since that would silently break
  the cards already on the tables.
- **Limits:** a photographed card works from anywhere until its code is renewed
  (_New code_). The code is sent on the order, because the rules can only check
  what is in the request, and it stays on the order document, readable by
  staff; that is accepted, since staff stand next to the cards anyway. The
  phone cannot know which tables have codes, so a refused order is reported as
  an expired link once the throttle and size caps are ruled out. One extra
  document read per order.
- **Expiry (added later):** the phone keeps a scanned code for 3 hours
  (`TABLE_CODE_TTL_MS`) and `/order` removes `k` from the address at once, so
  a past visit, a bookmark or a shared link no longer orders from home. A photo
  of the card still works until _New code_; for that, staff can confirm new
  guests: see
  [Staff confirm new guests](#staff-confirm-new-guests-open-tables-not-location)
  below.
- **Caps** (20 lines, 20 of each, ₹10,000) check the first and last line only:
  the rules cannot loop. The total cap, the board's re-derived totals and
  Reject cover a doctored middle line.

### Staff confirm new guests: open tables, not location

Table codes stop a typed-in address, but not someone who visited once or
photographed a card: the link works from home. Nothing a static site on the
free plan can check tells "at table 4" from "has table 4's link". A person at
the counter can, by looking.

**Decision: when the owner turns it on, a table's first order waits
(`pending`) until staff accept it.
Accept opens the table (`tableSessions/{n} = { openUntil }`); the rules take a
`preparing` order only while `openUntil > request.time`.** `pending` is always
allowed, with every other check (code, caps, throttle). The phone reads the
table's own session (a `get`, open to anyone) and the setting, and picks the
status the rules will take; if `preparing` is refused because the table
closed a moment earlier, it retries once as `pending`. The phone compares the
server's `openUntil` with its own clock, so it treats a table as open until 5
minutes after `openUntil` (`looksOpen`): a wrong guess of "open" costs one
refused write and the retry, while a wrong guess of "closed" would make a
seated group wait for an Accept.

- **Who can see which tables are open:** anyone may `get` one table's
  session, which is all the phone needs, but only staff may `list` them (the
  board's "Open tables"). Open to all, the list would tell someone with a
  leaked link exactly when an order skips the check.
- **Only as strong as the table codes.** The rules check a table's code only
  once it has one (`tableKeyOk` passes for a table with no `tableKeys` doc).
  Until the owner presses _Create codes_, anyone can type any table number,
  so approval then only guards tables nobody is sitting at; the two are meant
  to be used together.
- **Two phones at one table** both ordering before Accept: Accept takes every
  waiting order from that table in the same commit as opening it, so no guest
  is left on "Waiting for the counter" at a table that is already open. If
  that commit is refused (another board rejected one of them a moment
  earlier), the tapped order is accepted on its own. The board then numbers
  each of them, oldest first.

- **Cost:** one tap per new group, and extra document reads per order: one
  (`config/ordering`) while approval is off, two (that and the table's session)
  while it is on. The board listens to `tableSessions`, at most one small
  document per table.
- **Closing:** by time, with no writes: `openUntil` passes. Accept sets it to
  now + 3h. Staff moving an open table's order to preparing, ready or served
  push it to now + 3h in the same commit — so a table closes 3 hours after the
  last thing staff did for it. Completing or rejecting does not extend it
  (completing is usually the group paying), and nothing reopens a table that
  has closed, so **Close** (`openUntil = request.time`) sticks. The rules
  allow staff to set `openUntil` anywhere in `[request.time, request.time +
4h]` and nothing else: the extra hour covers a tablet with a fast clock, and
  the ceiling bounds how long a leaked link can skip the check without a
  person doing something. Staff-set times use the tablet's clock (only Close
  uses the server's), so a tablet more than an hour fast cannot open tables.
  Moving an open table's order on while also keeping the table open is then
  refused as one commit, so the board retries the order's step on its own:
  _Mark ready_ still works, and the table is simply not extended.
- **Close asks first**, like Reject: a mis-tap would make a seated group's
  next order wait for the counter.
- **Not a sale:** `pending` is on the board but not kitchen work, and reports
  leave it out of revenue like `rejected`. It has one way on (Accept →
  `preparing`) and can be rejected; nothing goes back to it.
- **Switch:** "Approve new tables" on the owner's dashboard (`/admin`),
  stored as `config/ordering { confirmNewGuests }`, owner-only,
  shape-checked. **A missing document (or field, or anything but `true`)
  means OFF**: every order goes straight to the kitchen, exactly as before
  this existed. It was first built ON by default, so the protection would be
  the default; the owner chose auto-accept instead and turns approval on when
  the staff are ready for it. So the deploy that introduces it changes
  nothing for the cafe.
- **Deploying it:** with approval off, the new rules take `preparing` from
  anyone, so an **old page** still open on a phone (it always sends
  `preparing`) keeps working, and rules and Hosting can go out in either
  order. The new page, if it cannot read the setting, sends `preparing` too
  and falls back to `pending` if refused; against the old rules (which only
  know `preparing`) a refused `pending` is retried once as `preparing`. Once
  the owner turns approval **on**, an old page is refused on a closed table and
  says the link has expired; there is no way to let it through without
  reopening the hole, so reload the counter tablet before turning it on (a
  board from before the deploy cannot Accept), and customers rescanning get
  the new page anyway (pages are served `no-cache`).
- **Day numbers wait for Accept.** The board numbers every order it sees
  except a `pending` one, and the rules refuse to number an order while it is
  `pending`. So a waiting order has no number, and gets the next one the
  moment staff accept it (numbering stays its own update, after the Accept).
  Numbering it on arrival was the alternative; it was rejected because the
  orders turned away here are mostly strangers', and each would leave a gap
  in the day's list — and a link passed around outside could burn through
  the day's 9,999. The cost: a new guest's number follows orders that were
  accepted before it, not the minute it was placed, and the waiting screen
  shows no number (it never shows a stand-in either). Reject a waiting order
  and it simply never gets one.
- **Limits:** while a table is open (a group is sitting there), a leaked link
  for it also goes straight to the kitchen; staff Close the table when the
  group leaves to shorten that window.
