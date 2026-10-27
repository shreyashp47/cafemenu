# Super admin and maintenance mode: requirements

Status: **draft for review**, 2026-10-25; built in #78 with the provisional
decisions of section 8. Builds on the platform admin page
(#30), the backend (#28, running on GitHub Actions per #77) and the plan
([PLAN.md](../PLAN.md)).

## 1. Purpose

As the person running CafeMenu, you need to see every registered owner and
cafe, act on any of them, and take a cafe's public website into maintenance
when needed, without ever touching an owner's data beyond what they agreed to.

## 2. Roles

| Role            | Who                                             | Where they sign in                           |
| --------------- | ----------------------------------------------- | -------------------------------------------- |
| **Super admin** | You (the maintainer); later, anyone you appoint | CafeMenu console, `/admin`                   |
| **Owner**       | A cafe owner who registered                     | CafeMenu console; their cafe's own dashboard |
| **Staff**       | Baristas invited by an owner                    | Their cafe's site, `/staff`                  |
| **Customer**    | Anyone with a table's QR code                   | Their cafe's site, no login                  |

## 3. What the super admin can do

### 3.1 Owners and cafes directory

- A list of every registered owner and cafe, with: owner name and email, sign-up
  date, last console sign-in, cafe name, web address, connected Firebase project,
  status (section 3.2), maintenance (section 3.4), plan, release version and
  channel, last deploy and its health.
- Search by email, cafe name, web address or project ID. Filter by status,
  maintenance, plan, channel, health.
- Open one cafe for its full history: requests, deploys, status changes,
  maintenance windows, emails sent.
- Export the list as CSV.
- Read-only on everything an owner owns: the admin **cannot** see a cafe's
  orders, customers or staff list (that data stays in the owner's project).

### 3.2 Owner account status

```
            suspend                     delete
  active ───────────► suspended ───────────────► deleted
     ▲                    │
     └──── reactivate ────┘
```

| Status        | Owner's console login | Their requests (deploy, branding, rollback) | Rollouts and patches | Emails to them                               | Their cafe's site                                     |
| ------------- | --------------------- | ------------------------------------------- | -------------------- | -------------------------------------------- | ----------------------------------------------------- |
| **active**    | works                 | processed                                   | applied              | sent                                         | unchanged                                             |
| **suspended** | disabled              | refused, with the reason shown              | skipped              | only the suspension and reactivation notices | unchanged, unless maintenance is also turned on (3.4) |
| **deleted**   | removed               | none                                        | none                 | one "account deleted" notice                 | unchanged; CafeMenu stops managing it                 |

- **Suspend** and **reactivate** require a reason (picked from a list plus free
  text) and email the owner automatically, with the reason.
- **Delete** removes the owner's CafeMenu login and their record from the
  CafeMenu database (keeping only the admin log entries about it). It never
  deletes anything in the owner's own Firebase project. Before deleting, the
  admin sees a reminder to remove CafeMenu's deploy account from their project,
  or to ask the owner to.
- Every action is undoable except delete, which asks for the cafe's web address
  to be typed in to confirm.

### 3.3 Admin action log

- Every super-admin action (suspend, reactivate, delete, maintenance on/off,
  publish a release, start/pause a rollout, appointing an admin) is written to
  an append-only log: who, what, which cafe, when, reason.
- Nobody can edit or delete entries, the admin included.
- Visible on the admin page, filterable, exportable.

### 3.4 Maintenance mode for a cafe's website

**What customers see:** instead of the menu, a page with the cafe's name and
logo, a message, and (if set) when it's expected back. No ordering. QR codes
keep pointing at the same address, so nothing needs reprinting.

**What staff and the owner see:**

| Screen                                  | In maintenance                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Customer menu, cart, ordering           | Replaced by the maintenance page                                                                          |
| An order already placed (status screen) | Still shows its live status                                                                               |
| Staff order board                       | Works, so orders already placed can be finished                                                           |
| Owner dashboard                         | Works, so the owner can fix the menu or settings, with a banner saying the site is in maintenance and why |

**Who can turn it on:**

| Who                                  | Why                                                                                                            | Can the owner turn it off? |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------- | -------------------------- |
| **Super admin**                      | Platform reasons: a migration (e.g. #21's money move), a security problem, abuse, non-payment once plans exist | No, only the admin         |
| **The owner** (from their dashboard) | Their own reasons: closed for renovation, holiday, menu change                                                 | Yes                        |

**Options when turning it on:**

- **Message:** a default ("We'll be back soon") or custom, in the cafe's
  language.
- **Expected back:** optional date and time, shown in the cafe's time zone.
- **Schedule:** start now or at a set time, end manually or at a set time.
- **Several cafes at once**, e.g. every cafe on a release that needs a migration
  (admin only).

**Behaviour:**

- **Takes effect within a minute, without a redeploy.** It's a setting the site
  reads live.
- **Enforced by the database rules, not just hidden in the page.** New orders
  are refused while it's on, so nobody can order through a saved link or a
  modified page.
- **The owner is emailed** when an admin turns it on or off, with the reason.
- **It survives updates:** deploys and rollouts keep it as it is.

### 3.5 Appointing admins

- The first super admin is set once with a command (an `admin` flag on your
  CafeMenu account), documented in the console README.
- From then on, an admin can appoint or remove another admin from the admin
  page. The last admin can't remove themselves.
- Admin accounts must use a strong password; two-step sign-in is recommended
  where Firebase supports it.

## 4. Limits, so this stays fair to owners

- **CafeMenu manages; it doesn't own.** Every cafe's orders, customers, staff
  and menu stay in the owner's Firebase project. No admin power reads or
  exports them.
- **An owner can always leave.** Removing CafeMenu's deploy account from their
  project ends every power in this document over their site. Because no browser
  can write the cafe's settings document, an admin-set maintenance mode would
  then stay on until the owner clears it in their own Firebase console. Their
  dashboard links to how.
- **The terms must say when admin actions happen.** Suspension and admin
  maintenance only for the reasons the terms list, with notice where
  reasonable. Add these to
  [docs/legal/terms-of-service.md](./legal/terms-of-service.md) before the
  first outside cafe signs up.

## 5. Non-functional requirements

- **Security:**
  - Only accounts with the `admin` flag reach `/admin` or can create admin
    requests; the rules enforce it, not just the page.
  - Owners can't see each other, or the admin log.
  - The deploy account's key never leaves the GitHub secret.
- **Speed:**
  - Maintenance on or off reaches a cafe's customers within 1 minute.
  - Suspend or reactivate takes effect at the backend's next run (within 5
    minutes on GitHub Actions).
- **Cost:** everything runs on the free plans (Spark plus GitHub Actions). No
  Blaze needed.
- **Reliability:** every action is safe to retry; a half-finished action
  (e.g. a bulk maintenance cut off midway) can be resumed or reverted.

## 6. Data model

**All data lives in Firebase.** There is no other database or server. Data is
in Cloud Firestore, logins in Firebase Authentication, and websites on Firebase
Hosting. CafeMenu's own data is in the `getcafemenu` project, in the `(default)`
Firestore database, region `asia-south1` (Mumbai), on the free Spark plan. Each
cafe's data is in that owner's own Firebase project. GitHub only runs the
backend job and keeps the release packages; it stores no owner or cafe data.

**CafeMenu database (`getcafemenu`):**

- `cafes/{id}`:
  - `status`: `active` | `suspended` | `deleted`;
  - `statusReason`, `statusChangedAt`, `statusChangedBy`;
  - `maintenance`: `{ on, by: "admin" | "owner", message, until, startsAt, reason }`.
- `adminLog/{id}`: `{ at, by, action, cafeId, reason, details }`. Create-only;
  no updates or deletes, by anyone.
- `requests/{id}` (from #77) gains admin kinds: `suspend`, `reactivate`,
  `delete-owner`, `maintenance-on`, `maintenance-off`, `appoint-admin`.

**Each cafe's own project:**

- `config/site.maintenance`: `{ on, by, message, until }`. Written by CafeMenu's
  deploy account only. Read live by the cafe site.
- `config/ownerMaintenance`: the same shape, for maintenance the owner turns on
  from their dashboard. Writable by the owner, so an owner can't clear an
  admin's maintenance.
- `firestore.rules`: order creation is refused while either maintenance flag is
  on; everything else is unchanged.

## 7. Acceptance criteria

- [ ] The admin sees every owner and cafe, with search, filters and CSV export,
      and cannot read any cafe's orders.
- [ ] Suspend: the owner can't sign in to the console, their requests are
      refused with the reason, rollouts skip them, and they get an email.
      Reactivate undoes all of it.
- [ ] Delete removes the owner's CafeMenu login and record, keeps the log, and
      leaves their Firebase project untouched.
- [ ] Admin maintenance on: within 1 minute the cafe's menu shows the
      maintenance page, an order request is refused by the rules (tested with a
      modified client), the staff board and owner dashboard still work, and the
      owner gets an email. Off: ordering works again within 1 minute.
- [ ] Owner maintenance: the owner turns it on and off from their dashboard,
      and can't turn off an admin's.
- [ ] Scheduled maintenance starts and ends on time in the cafe's time zone.
- [ ] Bulk maintenance on several cafes, resumable if cut off.
- [ ] Every admin action appears in the admin log, and the log can't be edited.
- [ ] Rules tests cover: a non-admin making admin requests; an owner clearing
      an admin's maintenance; ordering during maintenance; reading the admin
      log as an owner.

## 8. Decisions: provisional, used in the build

These were open questions. The build (#78) needed an answer to each, so it
uses the suggested one, **provisionally**: confirm or change them before the
first outside cafe signs up. Each lives in one place,
[`packages/shared/src/admin-policy.mjs`](../packages/shared/src/admin-policy.mjs),
which the console, the backend and the rules tests all read; changing one is a
change there (and, for the reason lists, in `apps/console/firestore.rules`,
which a test keeps in step).

1. **Reasons** that justify suspension or admin maintenance. _Provisional,
   used in the build:_ abuse, security, legal request, non-payment, owner's
   request (`SUSPENSION_REASONS`). Admin maintenance also allows a platform
   migration (`MAINTENANCE_REASONS`). Reactivation takes its own: resolved,
   payment received, made in error, owner's request.
2. **Notice period.** _Provisional, used in the build:_ none for security or
   abuse (or any reason but one); 7 days for non-payment (`NOTICE_DAYS`). A
   suspension with notice is emailed at once and waits, queued, for its date;
   reactivating first calls it off. Admin maintenance for non-payment needs
   the same notice.
3. **Suspension and the site.** _Provisional, used in the build:_ separate.
   Suspending does **not** turn maintenance on; the admin chooses
   (`SUSPEND_TURNS_ON_MAINTENANCE = false`).
4. **Staff board during maintenance.** _Provisional, used in the build:_ fully
   working (`STAFF_BOARD_IN_MAINTENANCE = "full"`): the rules refuse only new
   orders.
5. **Delete.** _Provisional, used in the build:_ remove everything except the
   admin log (`DELETE_KEEPS = ["adminLog"]`): the login, the directory entry,
   the cafes with their setup documents and emails, the deployments and the
   requests. Nothing in the owner's own project is touched.
6. **More admins.** _Provisional, used in the build:_ only the first admin for
   now (`APPOINT_OTHER_ADMINS = false`). Appointing is built in (the console's
   Admins panel and the backend's `appoint-admin`), and both refuse it while
   the policy says so; removing an admin works, never the last one.

## 9. Where it fits and how long

- **When:** after the backend on GitHub Actions (#77), because suspension
  and admin maintenance go through the backend.
- **Pieces:** cafe app (maintenance page, owner toggle, rules), console
  (directory, actions, log), backend (the new request kinds, emails).
- **Estimate:** 3–4 working days, plus a terms update (section 4).
