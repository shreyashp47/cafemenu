/**
 * Order status machine (docs/requirements.md §5.3, §4.2 step 6).
 *
 * The spec's baseline is `preparing` -> `completed`, explicitly "extendable to
 * `ready`, `served` later". This app takes that extension, because staff
 * benefit from a real "ready for pickup" hand-off and customers get a much
 * clearer promise from §4.1's `Received -> Preparing -> Ready/Served`:
 *
 *   received -> preparing -> ready -> served -> completed
 *
 * `completed` is terminal. It is never deleted from storage (§5.3: "keeps it in
 * the database for history — not deleted"), it only leaves the staff's active
 * board.
 *
 * `rejected` is the other way out. Ordering is pay-at-the-counter from a QR code,
 * so a prank or duplicate order costs nothing to place and would otherwise sit on
 * the board until someone "completed" it — and then count as takings. Staff can
 * reject an order that is still `preparing` or `ready`, optionally with a short
 * reason the customer sees. It is terminal, like `completed`, and it is left out
 * of the reports' revenue. firestore.rules allows exactly the same hops.
 *
 * `pending` comes before all of it, and only for a table staff have not
 * confirmed yet (src/lib/table-open.ts). Anyone who once had the QR link —
 * a past visit, a photo of the card — could otherwise order from home. So an
 * order from a closed table waits, off the kitchen's list, in its own "New
 * guests — check the table" section of the board, until staff look at the
 * table and tap Accept (pending -> preparing, and the table opens) or Reject.
 * It is not a sale until then, and a rejected one never becomes one.
 */

export const ORDER_STATUSES = [
  "pending",
  "received",
  "preparing",
  "ready",
  "served",
  "completed",
  "rejected",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

/**
 * Statuses that show up on the staff board. Everything else is history.
 * `pending` is here because the board has to see it to accept it, but it is
 * not kitchen work: the board lists it in its own section (see
 * isAwaitingCounter), and reports do not count it as a sale.
 */
export const ACTIVE_STATUSES = [
  "pending",
  "received",
  "preparing",
  "ready",
  "served",
] as const satisfies readonly OrderStatus[];

export type ActiveStatus = (typeof ACTIVE_STATUSES)[number];

/** Canonical forward path, index-aligned with ORDER_STATUSES. */
const NEXT: Record<OrderStatus, OrderStatus | null> = {
  pending: "preparing",
  received: "preparing",
  preparing: "ready",
  ready: "served",
  served: "completed",
  completed: null,
  rejected: null,
};

/**
 * Statuses an order can be rejected from. Not `served`: once it is on the table
 * the counter settles it in person. `pending` is: turning away an order from
 * a table with nobody at it is what the waiting step is for. Must match the
 * `rejected` branch of the order update rule in firestore.rules.
 */
export const REJECTABLE_STATUSES = [
  "pending",
  "preparing",
  "ready",
] as const satisfies readonly OrderStatus[];

/** Longest reject reason firestore.rules accepts. */
export const MAX_REJECT_REASON = 80;

/** One-tap reasons on the staff board. Free text is not offered on purpose. */
export const REJECT_REASONS = [
  "No one at this table",
  "Item unavailable",
  "Duplicate order",
] as const;

export function canReject(from: OrderStatus): boolean {
  return (REJECTABLE_STATUSES as readonly OrderStatus[]).includes(from);
}

/** Terminal: nothing more can happen to the order. */
export function isClosedStatus(status: OrderStatus): boolean {
  return status === "completed" || status === "rejected";
}

export const DEFAULT_STATUS: OrderStatus = "preparing";

/**
 * The two statuses a customer's phone may create an order in. firestore.rules
 * allows `pending` always, and `preparing` unless the owner has switched
 * "Approve new tables" on, in which case only on an open table.
 */
export type NewOrderStatus = "pending" | "preparing";

/** Waiting for staff to confirm the table: not kitchen work yet. */
export function isAwaitingCounter(status: OrderStatus): boolean {
  return status === "pending";
}

/** The reason the board suggests first when turning a new guest away. */
export const PENDING_REJECT_REASON = REJECT_REASONS[0];

export function isOrderStatus(value: unknown): value is OrderStatus {
  return (
    typeof value === "string" &&
    (ORDER_STATUSES as readonly string[]).includes(value)
  );
}

export function isActiveStatus(value: unknown): value is ActiveStatus {
  return (
    typeof value === "string" &&
    (ACTIVE_STATUSES as readonly string[]).includes(value)
  );
}

/** The status a given status moves to, or `null` if it is terminal. */
export function nextStatus(status: OrderStatus): OrderStatus | null {
  return NEXT[status];
}

export function canAdvance(from: OrderStatus, to: OrderStatus): boolean {
  return NEXT[from] === to;
}

/** Guards every status write. Returns the accepted status, or `null`. */
export function transition(
  from: OrderStatus,
  to: OrderStatus,
): OrderStatus | null {
  if (to === "rejected") return canReject(from) ? to : null;
  return canAdvance(from, to) ? to : null;
}

export interface StatusAction {
  to: OrderStatus;
  label: string;
  variant: "primary" | "secondary" | "highlight";
  /** Primary action is rendered larger/emphasised in the staff board. */
  primary: boolean;
}

/**
 * Buttons the staff board should render for a given status. Kept here (rather
 * than in the view) so the rules are unit-testable in isolation.
 */
export function actionsFor(status: OrderStatus): StatusAction[] {
  switch (status) {
    case "pending":
      // Accept only. Reject is its own two-step action on the ticket.
      return [
        { to: "preparing", label: "Accept", variant: "primary", primary: true },
      ];
    case "received":
      return [
        {
          to: "preparing",
          label: "Start preparing",
          variant: "primary",
          primary: true,
        },
      ];
    case "preparing":
      return [
        { to: "ready", label: "Mark ready", variant: "primary", primary: true },
      ];
    case "ready":
      // No "Complete" shortcut here. There used to be one, but ready ->
      // completed is not a legal hop — not in NEXT above, and not in
      // firestore.rules — so the tap was refused and silently did nothing.
      // Offering only buttons the machine accepts is pinned by a test.
      return [
        {
          to: "served",
          label: "Mark served",
          variant: "primary",
          primary: true,
        },
      ];
    case "served":
      return [
        {
          to: "completed",
          label: "Complete",
          variant: "primary",
          primary: true,
        },
      ];
    case "completed":
    case "rejected":
      return [];
  }
}

/** Customer-facing step list (§4.1 step 6). */
export const CUSTOMER_STEPS = [
  "received",
  "preparing",
  "ready",
  "served",
] as const satisfies readonly OrderStatus[];

export function stepIndex(status: OrderStatus): number {
  const i = (CUSTOMER_STEPS as readonly OrderStatus[]).indexOf(status);
  // `completed` means every customer-visible step happened. `rejected` and
  // `pending` never reach the timeline: the confirmation screen shows its own
  // notice for each.
  return i === -1 ? CUSTOMER_STEPS.length - 1 : i;
}

export function isFinalForCustomer(status: OrderStatus): boolean {
  return status === "served" || status === "completed";
}
