# Cafe QR Ordering System — Requirements Document

## 1. Overview

A minimal-infrastructure web-based ordering system for a small cafe (6–10 tables). Customers scan a QR code at their table to view the menu and place orders directly from their phone browser (no app install). Cafe employees receive live order notifications on their mobile phone via a staff web app and manage order status. The system also stores order history for monthly reporting.

## 2. Goals

- Zero/low infrastructure cost (free tiers only, minimal or free domain)
- No app installs required for customers or staff (mobile web / PWA)
- Live order notifications to staff with minimal delay
- 6+ months of order history retained for reporting
- Simple enough for a small cafe owner to operate without technical staff

## 3. Users & Roles

| Role           | Access                       | Device                         |
| -------------- | ---------------------------- | ------------------------------ |
| Customer       | Public, no login             | Own mobile phone (via QR scan) |
| Employee/Staff | Authenticated (simple login) | Cafe mobile phone(s)           |
| Owner          | Authenticated (admin)        | Mobile or desktop              |

## 4. User Flows

### 4.1 Customer Flow

1. Scans QR code fixed at their table
2. QR encodes a URL with table number, e.g. `yourcafe.web.app/order?table=4`
3. Browses digital menu (categories, items, prices, availability)
4. Adds items to cart, adjusts quantity
5. Places order (no login required)
6. Sees order confirmation and live status: **Received → Preparing → Ready/Served**
7. Pays at counter (Phase 1) or via UPI/payment link (Phase 2, optional)

### 4.2 Employee Flow

1. Opens staff web app on phone (installed as PWA / bookmarked)
2. Logs in (simple email+password or PIN)
3. Sees list of **active orders only** (status = "preparing"), grouped/sorted by table and time
4. Gets notified (sound/vibration/push) when a new order arrives
5. Taps an order to view details (table, items, quantity, notes)
6. Updates order status: Preparing → Ready → Completed
7. Completed orders disappear from the active view automatically

### 4.3 Owner Flow (Phase 2, optional for v1)

1. Logs into admin/dashboard view
2. Manages menu (add/edit/remove items, prices, availability)
3. Views daily order summary
4. Views/generates monthly reports (revenue, order count, top items)

## 5. Functional Requirements

### 5.1 Menu Management

- Menu items with: name, description (optional), price, category, availability toggle
- Owner can edit menu without a developer (simple admin UI)

### 5.2 Ordering

- Cart-based ordering per table session
- Order includes: table number, item list with quantities, total amount, timestamp, status
- No customer login/signup required
- Order confirmation shown immediately after placement

### 5.3 Order Status & Notifications

- Order status values: `preparing`, `completed` (extendable to `ready`, `served` later)
- Staff view listens live for orders with `status == "preparing"` — updates automatically without manual refresh
- Audible/vibration alert on staff device when a new order arrives
- Marking an order "completed" removes it from the active staff view (but keeps it in the database for history — not deleted)

### 5.4 Data Retention & Reporting

- All orders retained (no auto-deletion) — target minimum 6 months, extendable
- Owner can query/view a monthly report: total revenue, total orders, average order value, top-selling items, revenue by day
- Reports generated on-demand via date-range query (Phase 1); optionally automated/scheduled later (Phase 2)

### 5.5 QR Codes

- One static QR code per table, encoding table number in the URL
- Generated once, printed, placed on table — no dynamic regeneration needed

> **As built:** the owner sets which tables exist on `/admin/qr` (saved in
> Firestore, `config/tables`), and the cards, the customer's table picker and the
> check on a scanned number all follow that list — no rebuild to add a table. See
> [decisions](./decisions.md#the-table-list-lives-in-firestore-with-the-env-var-as-the-default).

## 6. Non-Functional Requirements

- **Cost:** Free tier hosting, database, and domain (subdomain); only optional cost is a custom domain (~₹500–800/year)
- **Performance:** Order should appear on staff device within a few seconds of placement
- **Availability:** No dedicated server to maintain; relies on managed free-tier services
- **Scale:** Designed for low volume (6–10 tables, tens to ~100 orders/day) — well within free tier limits
- **Security:** Staff/owner routes protected by authentication; customers can only create orders, not read/modify others' orders or menu data
- **Device support:** Must work on standard Android/iOS mobile browsers without installation

## 7. Tech Stack

| Layer              | Choice                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------- |
| Frontend           | React / Next.js (single app, two views: `/order`, `/staff`) as a PWA                                          |
| Backend & Database | Firebase (Firestore)                                                                                          |
| Live updates       | Firestore `onSnapshot` listeners (filtered by `status == "preparing"`) — no separate realtime database needed |
| Hosting            | Firebase Hosting (or Vercel)                                                                                  |
| Domain             | Free subdomain (`yourcafe.web.app`) initially; optional custom domain later                                   |
| Notifications      | In-app sound/vibration via listener; Web Push/FCM for background push (Phase 2)                               |
| QR Codes           | Any free QR generator, encoding `/order?table=N`                                                              |
| Auth (staff/owner) | Firebase Authentication (email/password)                                                                      |

## 8. Data Model (Firestore)

```
/orders/{orderId}
  - tableNumber: number
  - items: [{ name, qty, price }]
  - total: number
  - status: "preparing" | "completed"
  - createdAt: timestamp
  - completedAt: timestamp (optional)
  - paymentMethod: string (optional)

/menu/{itemId}
  - name: string
  - description: string (optional)
  - price: number
  - category: string
  - available: boolean

/staff/{userId}   (Phase 2, if role-based access needed)
  - name, role
```

> **As built:** `/staff/{userId}` was needed from v1 (owner vs. staff). The
> status field follows `received → preparing → ready → served → completed`.
> Two collections were added: `/config/{docId}` (today's special, and
> `config/tables`, the table list) and `/orderThrottle/{uid}` (the per-customer
> order limit). See [decisions](./decisions.md).

## 9. Out of Scope (v1)

- Online payment gateway integration (pay-at-counter assumed for v1)
- Customer accounts / order history for customers
- Inventory management
- Multi-cafe / multi-branch support
- Native mobile apps

## 10. Phased Rollout

**Phase 1 (MVP)**

- Customer menu browsing + ordering via QR
- Staff live order view with status updates
- Manual on-demand monthly report query
- Free subdomain hosting

**Phase 2 (Enhancements)**

- Background push notifications (screen-off alerts)
- Owner admin dashboard for menu management
- Automated scheduled monthly reports (email/PDF)
- Online payment integration
- Custom domain

## 11. Open Questions

- Should customers see live order status updates on their own screen, or just a confirmation?
- Single staff login shared across employees, or individual accounts?
- Payment: pay-at-counter only for v1, or include UPI QR/payment link from day one?
